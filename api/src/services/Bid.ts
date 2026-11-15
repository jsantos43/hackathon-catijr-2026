import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { NotFound } from '../errors/index.js';
import { AuctionStatus } from '../generated/prisma/enums.js';
import { db } from '../prisma/db.js';
import { redis } from '../redis/client.js';
import { RedisKeys } from '../redis/keys.js';
import { minimumBidCents } from '../utils/money.js';
import { shortName } from '../utils/names.js';
import { auctionSelect, serializeAuction, type AuctionView } from '../views/auction.js';
import { bidSelect, serializeBid, type BidView } from '../views/bid.js';
import RoomState, { type StoredBid } from './RoomState.js';

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
  /** Quem dá o lance (vem da sessão do socket: o nome vai abreviado na lista da sala). */
  bidder: { id: string; name: string; createdAt: Date };
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

const toPayload = (bid: BidView): BidPayload => ({ ...bid, createdAt: bid.createdAt.toISOString() });

/** Lance da lista do Redis no formato da API (sem a chave de idempotência). */
const fromStored = ({ idempotencyKey: _key, createdAt, ...bid }: StoredBid): BidView => ({
  ...bid,
  createdAt: new Date(createdAt),
});

/**
 * Converte o registro devolvido pelo script de lance (o mesmo guardado na idempotência):
 * "<bidCount>|<endsAt>|<lanceMínimoSeguinte>|<prorrogou>|<lance JSON>".
 */
const fromRecord = (record: string, duplicate = false): BidAccepted => {
  const [count, endsAt, minimum, extended, ...rest] = record.split('|');
  const bid = JSON.parse(rest.join('|')) as StoredBid;
  return {
    ok: true,
    bid: toPayload(fromStored(bid)),
    auction: {
      finalPriceCents: bid.amountCents,
      minimumBidCents: Number(minimum),
      bidCount: Number(count),
      endsAt: new Date(Number(endsAt)).toISOString(),
      winnerId: bid.bidderId,
    },
    extended: extended === '1',
    ...(duplicate && { duplicate: true }),
  };
};

/**
 * Reenvio de um lance de um leilão que já foi gravado no PostgreSQL (a sala não está mais no
 * Redis). Só leitura: o leilão já acabou.
 */
const replayFromDatabase = async (userId: string, idempotencyKey: string): Promise<BidAccepted | null> => {
  const existing = await db.bid.findUnique({
    where: { bidderId_idempotencyKey: { bidderId: userId, idempotencyKey } },
    select: { ...bidSelect, auction: { select: auctionSelect } },
  });
  if (!existing) return null;

  const { auction, ...bid } = existing;
  return {
    ok: true,
    bid: toPayload(serializeBid(bid)),
    auction: {
      finalPriceCents: auction.finalPriceCents ?? bid.amountCents,
      minimumBidCents: minimumBidCents(auction),
      bidCount: auction.bidCount,
      endsAt: auction.endsAt.toISOString(),
      winnerId: auction.winnerId ?? bid.bidderId,
    },
    extended: false,
    duplicate: true,
  };
};

// ---------------------------------------------------------------------------------------------
// Serviço
// ---------------------------------------------------------------------------------------------

class Bid {
  /**
   * Processa um lance (RF10–RF15) usando SÓ o Redis. Etapas:
   *
   *  1. Idempotência (caminho rápido): a mesma chave devolve o resultado original. Resolve o
   *     duplo clique e o reenvio depois de a conexão cair antes do ack.
   *  2. Anti-rajada: no máximo um lance a cada BID_THROTTLE_MS por usuário (SET NX PX).
   *  3. Script Lua atômico na sala: confere de novo a idempotência, status, término (relógio
   *     do servidor), comitente, líder e mínimo; aplica prorrogação; grava estado, lance e
   *     resultado. Dois lances simultâneos são executados um depois do outro pelo Redis.
   *  4. Índices globais (prazo de fechamento e "minhas participações").
   *
   * O PostgreSQL só recebe os lances quando o leilão termina (services/Settlement.ts).
   * Quem chama (o handler do socket) transmite o lance para a sala quando `ok` for true e não
   * for `duplicate`.
   */
  static async place(input: PlaceBidInput): Promise<BidOutcome> {
    const { auctionId, bidder, amountCents, idempotencyKey } = input;

    // 1. Idempotência
    const cached = await RoomState.findIdempotent(auctionId, bidder.id, idempotencyKey);
    if (cached) return fromRecord(cached, true);

    // Sala fora do Redis: ou o leilão não está aberto, ou já foi gravado no banco e isto é o
    // reenvio de um lance de lá (só leitura; o leilão acabou).
    if (!(await RoomState.exists(auctionId))) {
      return (await replayFromDatabase(bidder.id, idempotencyKey)) ?? reject('AUCTION_NOT_RUNNING');
    }

    // 2. Anti-rajada (reenvio com a mesma chave já voltou acima, então não conta aqui).
    if (env.BID_THROTTLE_MS > 0) {
      const first = await redis.set(RedisKeys.bidThrottle(bidder.id), '1', 'PX', env.BID_THROTTLE_MS, 'NX');
      if (!first) return reject('RATE_LIMITED');
    }

    // 3. Decisão atômica no Redis. O horário que vale é o do servidor, agora.
    const now = Date.now();
    const result = await RoomState.placeBid({
      bid: {
        id: randomUUID(),
        auctionId,
        bidderId: bidder.id,
        bidderName: shortName(bidder.name),
        amountCents,
        idempotencyKey,
        createdAt: new Date(now).toISOString(),
      },
      bidderFullName: bidder.name,
      bidderSince: bidder.createdAt,
      now,
    });

    if (result.kind === 'duplicate') return fromRecord(result.record, true);
    if (result.kind === 'rejected') {
      // Sem sala no Redis: pode ser o reenvio de um lance de um leilão que já terminou.
      if (result.error === 'AUCTION_NOT_RUNNING' && result.minimumBidCents === null) {
        const replay = await replayFromDatabase(bidder.id, idempotencyKey);
        if (replay) return replay;
      }
      return reject(result.error, result.minimumBidCents);
    }

    // 4. Índices fora da sala.
    const outcome = fromRecord(result.record);
    await RoomState.afterAccepted(auctionId, bidder.id, Date.parse(outcome.auction.endsAt));
    return outcome;
  }

  /** Últimos lances de um leilão, do mais recente para o mais antigo (RF09). */
  static async listRecent(auctionId: string, limit = env.AUCTION_RECENT_BIDS_LIMIT): Promise<BidView[]> {
    // Em andamento: os lances estão só no Redis.
    const live = await RoomState.recentBids(auctionId, limit);
    if (live) return live.map(fromStored);

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
    // Leilões encerrados: lances no PostgreSQL. Em andamento: só no Redis.
    const [mine, liveBids] = await Promise.all([
      db.bid.groupBy({
        by: ['auctionId'],
        where: { bidderId: userId },
        _max: { amountCents: true },
      }),
      RoomState.participationsOf(userId),
    ]);

    const myHighest = new Map(mine.map((g) => [g.auctionId, g._max.amountCents ?? 0]));
    for (const [auctionId, amount] of liveBids) {
      myHighest.set(auctionId, Math.max(amount, myHighest.get(auctionId) ?? 0));
    }
    if (!myHighest.size) return [];

    const rows = await db.auction.findMany({
      where: { id: { in: [...myHighest.keys()] } },
      select: auctionSelect,
    });
    const auctions = await RoomState.withLive(rows);

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
