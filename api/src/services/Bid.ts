import { env } from '../config/env.js';
import { NotFound } from '../errors/index.js';
import { AuctionStatus } from '../generated/prisma/enums.js';
import { db } from '../prisma/db.js';
import { redis } from '../redis/client.js';
import { RedisKeys } from '../redis/keys.js';
import { uniqueViolationField } from '../utils/dbErrors.js';
import { extendEndsAt } from '../utils/extension.js';
import { minimumBidCents } from '../utils/money.js';
import { auctionSelect, serializeAuction, type AuctionView } from '../views/auction.js';
import { bidSelect, serializeBid, type BidView } from '../views/bid.js';
import RoomState, { type AuctionForRoom } from './RoomState.js';

// ---------------------------------------------------------------------------------------------
// Tipos do resultado de um lance (é exatamente o que vai no ack do socket `auction:bid`).
// ---------------------------------------------------------------------------------------------

export type BidRejectCode =
  | 'BID_TOO_LOW'
  | 'AUCTION_NOT_RUNNING'
  | 'IS_OWNER'
  | 'ALREADY_LEADER'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INVALID_PAYLOAD'
  | 'NOT_IN_ROOM'
  | 'INTERNAL';

export const BID_REJECT_MESSAGES: Record<BidRejectCode, string> = {
  BID_TOO_LOW: 'Valor abaixo do lance mínimo atual.',
  AUCTION_NOT_RUNNING: 'O leilão não está aberto a lances.',
  IS_OWNER: 'Você não pode dar lance no próprio leilão.',
  ALREADY_LEADER: 'Você já é o líder deste leilão.',
  RATE_LIMITED: 'Aguarde um instante entre um lance e outro.',
  UNAUTHORIZED: 'Sua sessão expirou. Entre de novo para dar lances.',
  INVALID_PAYLOAD: 'Lance inválido.',
  NOT_IN_ROOM: 'Entre na sala antes de dar lances.',
  INTERNAL: 'Não foi possível processar o lance. Tente de novo.',
};

/** Lance no formato do socket (datas já como texto ISO, igual ao que vai pela rede). */
export type BidPayload = Omit<BidView, 'createdAt'> & { createdAt: string };

export type BidAccepted = {
  ok: true;
  bid: BidPayload;
  auction: {
    finalPriceCents: number;
    minimumBidCents: number;
    bidCount: number;
    endsAt: string;
    winnerId: string;
  };
  /** O término foi prorrogado por este lance (RF15). */
  extended: boolean;
  /** true quando é o reenvio de um lance já processado (mesma chave de idempotência). */
  duplicate?: boolean;
};

export type BidRejected = {
  ok: false;
  error: BidRejectCode;
  message: string;
  /** Sempre que possível, o mínimo vigente, para o front atualizar o campo. */
  minimumBidCents: number | null;
};

export type BidOutcome = BidAccepted | BidRejected;

export type PlaceBidInput = {
  auctionId: string;
  userId: string;
  amountCents: number;
  idempotencyKey: string;
};

export const reject = (
  error: BidRejectCode,
  minimum: number | null = null,
  message = BID_REJECT_MESSAGES[error],
): BidRejected => ({ ok: false, error, message, minimumBidCents: minimum });

// ---------------------------------------------------------------------------------------------
// Situação de quem participou (RF27).
// ---------------------------------------------------------------------------------------------

export type ParticipationSituation = 'LEADING' | 'OUTBID' | 'WON' | 'LOST';

export const participationSituation = (
  auction: { status: AuctionStatus; winnerId: string | null },
  userId: string,
): ParticipationSituation => {
  const isLeader = auction.winnerId === userId;
  if (auction.status === AuctionStatus.RUNNING) return isLeader ? 'LEADING' : 'OUTBID';
  if (auction.status === AuctionStatus.SOLD) return isLeader ? 'WON' : 'LOST';
  // Cancelado (ex.: queda do serviço durante a disputa) ou outro estado final.
  return 'LOST';
};

// ---------------------------------------------------------------------------------------------
// Auxiliares internos
// ---------------------------------------------------------------------------------------------

/** Linha do leilão lida com SELECT ... FOR UPDATE. */
type LockedAuction = AuctionForRoom & {
  status: AuctionStatus;
  originalEndsAt: Date;
};

const toPayload = (bid: BidView): BidPayload => ({ ...bid, createdAt: bid.createdAt.toISOString() });

const accepted = (
  bid: BidView,
  auction: AuctionForRoom,
  extended: boolean,
  duplicate = false,
): BidAccepted => ({
  ok: true,
  bid: toPayload(bid),
  auction: {
    finalPriceCents: auction.finalPriceCents ?? bid.amountCents,
    minimumBidCents: minimumBidCents(auction),
    bidCount: auction.bidCount,
    endsAt: auction.endsAt.toISOString(),
    winnerId: auction.winnerId ?? bid.bidderId,
  },
  extended,
  ...(duplicate && { duplicate: true }),
});

/** Monta a resposta de um lance que já existe no banco (reenvio com a mesma chave). */
const replayExisting = async (userId: string, idempotencyKey: string) => {
  const existing = await db.bid.findUnique({
    where: { bidderId_idempotencyKey: { bidderId: userId, idempotencyKey } },
    select: { ...bidSelect, auction: { select: auctionSelect } },
  });
  if (!existing) return null;

  const { auction, ...bid } = existing;
  return accepted(serializeBid(bid), auction, false, true);
};

const remember = (input: PlaceBidInput, outcome: BidOutcome) =>
  redis.set(
    RedisKeys.bidIdempotency(input.userId, input.idempotencyKey),
    JSON.stringify(outcome),
    'EX',
    env.BID_IDEMPOTENCY_TTL_SECONDS,
  );

/**
 * A parte que decide, dentro de uma transação do PostgreSQL. A linha do leilão fica travada
 * (FOR UPDATE) do começo ao fim: dois lances no mesmo leilão são processados um depois do
 * outro, e o segundo já enxerga o preço, o líder e o término deixados pelo primeiro. O mesmo
 * vale para o cancelamento e para o fechamento do leilão, que travam a mesma linha.
 */
const placeInTransaction = (
  input: PlaceBidInput,
): Promise<{ outcome: BidOutcome; room?: AuctionForRoom }> =>
  db.$transaction(async (tx) => {
    const [auction] = await tx.$queryRaw<LockedAuction[]>`
      SELECT id, "ownerId", status::text AS status, "startingPriceCents", "bidCount", "finalPriceCents",
             "winnerId", "endsAt", "originalEndsAt"
        FROM "Auction"
       WHERE id = ${input.auctionId}::uuid
         FOR UPDATE`;

    // O horário que vale é o do servidor, no momento em que o lance é processado.
    const now = new Date();

    if (!auction || auction.status !== AuctionStatus.RUNNING || now >= auction.endsAt) {
      return { outcome: reject('AUCTION_NOT_RUNNING', auction ? minimumBidCents(auction) : null) };
    }

    const minimum = minimumBidCents(auction);
    if (auction.ownerId === input.userId) return { outcome: reject('IS_OWNER', minimum) };
    if (auction.bidCount > 0 && auction.winnerId === input.userId) {
      return { outcome: reject('ALREADY_LEADER', minimum) };
    }
    if (input.amountCents < minimum) return { outcome: reject('BID_TOO_LOW', minimum) };

    const extension = extendEndsAt({
      bidAt: now,
      endsAt: auction.endsAt,
      originalEndsAt: auction.originalEndsAt,
    });

    const bid = await tx.bid.create({
      data: {
        auctionId: auction.id,
        bidderId: input.userId,
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      },
      select: bidSelect,
    });

    // Durante a disputa, winnerId/finalPriceCents são o líder e o preço atuais.
    const updated: AuctionForRoom = {
      ...auction,
      bidCount: auction.bidCount + 1,
      finalPriceCents: input.amountCents,
      winnerId: input.userId,
      endsAt: extension.endsAt,
    };

    await tx.auction.update({
      where: { id: auction.id },
      data: {
        bidCount: updated.bidCount,
        finalPriceCents: updated.finalPriceCents,
        winnerId: updated.winnerId,
        endsAt: updated.endsAt,
      },
    });

    return { outcome: accepted(serializeBid(bid), updated, extension.extended), room: updated };
  });

// ---------------------------------------------------------------------------------------------
// Serviço
// ---------------------------------------------------------------------------------------------

class Bid {
  /**
   * Processa um lance (RF10–RF15). Ordem das etapas, da mais barata para a mais cara:
   *
   *  1. Idempotência (Redis, depois banco): a mesma chave devolve o resultado original.
   *  2. Anti-rajada (Redis): no máximo um lance a cada BID_THROTTLE_MS por usuário.
   *  3. Pré-validação (Redis): recusa na hora o que com certeza seria recusado.
   *  4. Transação no PostgreSQL: valida tudo de novo com a linha travada e grava.
   *  5. Atualiza o estado quente da sala no Redis e guarda o resultado pela chave.
   *
   * Quem chama (o handler do socket) transmite o lance para a sala quando `ok` for true e
   * não for `duplicate`.
   */
  static async place(input: PlaceBidInput): Promise<BidOutcome> {
    // 1. Idempotência
    const cached = await redis.get(RedisKeys.bidIdempotency(input.userId, input.idempotencyKey));
    if (cached) {
      const outcome = JSON.parse(cached) as BidOutcome;
      return outcome.ok ? { ...outcome, duplicate: true } : outcome;
    }
    const replay = await replayExisting(input.userId, input.idempotencyKey);
    if (replay) return replay;

    const state = await RoomState.get(input.auctionId);

    // 2. Anti-rajada: SET NX PX só funciona para o primeiro lance dentro da janela.
    if (env.BID_THROTTLE_MS > 0) {
      const first = await redis.set(
        RedisKeys.bidThrottle(input.userId),
        '1',
        'PX',
        env.BID_THROTTLE_MS,
        'NX',
      );
      // Não guarda pela chave: depois da janela, o mesmo lance pode ser reenviado.
      if (!first) return reject('RATE_LIMITED', state?.minimumBidCents ?? null);
    }

    // 3. Pré-validação pelo Redis (se a sala não estiver lá, o banco decide sozinho).
    if (state) {
      const rejection = RoomState.precheck(state, input);
      if (rejection) {
        const outcome = reject(rejection, state.minimumBidCents);
        await remember(input, outcome);
        return outcome;
      }
    }

    // 4. Decisão final no PostgreSQL.
    let result: Awaited<ReturnType<typeof placeInTransaction>>;
    try {
      result = await placeInTransaction(input);
    } catch (err) {
      // Duas tentativas com a mesma chave ao mesmo tempo: a segunda bate no índice único.
      if (uniqueViolationField(err) !== undefined) {
        const again = await replayExisting(input.userId, input.idempotencyKey);
        if (again) return again;
      }
      throw err;
    }

    // 5. Redis acompanha o banco (só depois do COMMIT).
    if (result.room) await RoomState.update(result.room);
    await remember(input, result.outcome);

    return result.outcome;
  }

  /** Últimos lances de um leilão, do mais recente para o mais antigo (RF09). */
  static async listRecent(auctionId: string, limit = env.AUCTION_RECENT_BIDS_LIMIT) {
    const bids = await db.bid.findMany({
      where: { auctionId },
      select: bidSelect,
      orderBy: [{ createdAt: 'desc' }, { amountCents: 'desc' }],
      take: limit,
    });

    return bids.map(serializeBid);
  }

  /** Igual a listRecent, mas responde 404 se o leilão não existir (rota REST). */
  static async listByAuction(auctionId: string, limit: number) {
    const exists = await db.auction.count({ where: { id: auctionId } });
    if (!exists) throw new NotFound('Leilão não encontrado');

    return Bid.listRecent(auctionId, limit);
  }

  /**
   * RF27: leilões em que o usuário deu pelo menos um lance, com o maior lance dele e a
   * situação (Líder, Superado, Vencedor, Não venceu). Os ao vivo vêm primeiro.
   */
  static async listParticipations(userId: string) {
    const mine = await db.bid.groupBy({
      by: ['auctionId'],
      where: { bidderId: userId },
      _max: { amountCents: true },
    });
    if (!mine.length) return [];

    const myHighest = new Map(mine.map((g) => [g.auctionId, g._max.amountCents ?? 0]));
    const auctions = await db.auction.findMany({
      where: { id: { in: [...myHighest.keys()] } },
      select: auctionSelect,
    });

    const participations = auctions.map((row) => ({
      auction: serializeAuction(row) as AuctionView,
      myHighestBidCents: myHighest.get(row.id) ?? 0,
      situation: participationSituation(row, userId),
    }));

    const live = (p: (typeof participations)[number]) => p.auction.status === AuctionStatus.RUNNING;
    return participations.sort((a, b) => {
      if (live(a) !== live(b)) return live(a) ? -1 : 1;
      // Ao vivo: o que termina primeiro em cima. Encerrados: o mais recente em cima.
      const diff = a.auction.endsAt.getTime() - b.auction.endsAt.getTime();
      return live(a) ? diff : -diff;
    });
  }
}

export default Bid;
