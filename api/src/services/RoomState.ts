import { env } from '../config/env.js';
import { AuctionStatus } from '../generated/prisma/enums.js';
import { redis } from '../redis/client.js';
import { RedisKeys } from '../redis/keys.js';
import { bidIncrementCents, INCREMENTS } from '../utils/money.js';

/**
 * Sala de um leilão Em andamento — vive INTEIRA no Redis.
 *
 * Enquanto o leilão corre, nenhum lance toca o PostgreSQL. O Redis guarda:
 *   - o estado (HASH room:{id}:state): status, preço, líder, lance mínimo, término…
 *   - todos os lances aceitos (LIST room:{id}:bids), na ordem em que foram aceitos;
 *   - o resultado de cada chave de idempotência (HASH room:{id}:idem);
 *   - o maior lance de cada participante (HASH room:{id}:bidders).
 * No fim, services/Settlement.ts copia tudo para o PostgreSQL de uma vez e apaga a sala.
 *
 * Toda decisão (aceitar lance, fechar, cancelar) é um script Lua. O Redis executa um comando
 * por vez, e um script inteiro é um comando: ninguém enxerga a sala "no meio" de um lance. É
 * isso que elimina a condição de corrida — dois lances simultâneos viram dois scripts em fila,
 * e o segundo já vê o preço deixado pelo primeiro. Os scripts tocam só chaves da mesma sala
 * (mesma hash tag), então funcionam também num Redis Cluster.
 *
 * Status dentro do Redis:
 *   RUNNING   aceitando lances;
 *   CLOSING   o término passou e o job reivindicou a sala: não aceita mais nada, falta gravar;
 *   CANCELLED cancelada (comitente sem lances, ou regra de queda): falta gravar.
 */
export type RoomStatus = 'RUNNING' | 'CLOSING' | 'CANCELLED';

export type RoomStateData = {
  auctionId: string;
  ownerId: string;
  status: RoomStatus;
  startingPriceCents: number;
  /** Preço atual: maior lance aceito (null se ainda não houve lance). */
  priceCents: number | null;
  leaderId: string | null;
  leaderName: string | null;
  /** createdAt da conta do líder (o front mostra o perfil público dele). */
  leaderSince: Date | null;
  minimumBidCents: number;
  bidCount: number;
  endsAt: Date;
  originalEndsAt: Date;
};

/** Lance como fica guardado na lista da sala (e depois na tabela Bid). */
export type StoredBid = {
  id: string;
  auctionId: string;
  bidderId: string;
  bidderName: string;
  amountCents: number;
  idempotencyKey: string;
  /** ISO 8601 — horário do servidor no momento em que o lance foi aceito. */
  createdAt: string;
};

/** O que é preciso do leilão para abrir a sala. */
export type AuctionForRoom = {
  id: string;
  ownerId: string;
  startingPriceCents: number;
  endsAt: Date;
  originalEndsAt: Date;
};

export type PlaceBidResult =
  | { kind: 'accepted'; record: string }
  | { kind: 'duplicate'; record: string }
  | { kind: 'rejected'; error: BidRuleRejection; minimumBidCents: number | null };

export type BidRuleRejection = 'AUCTION_NOT_RUNNING' | 'IS_OWNER' | 'ALREADY_LEADER' | 'BID_TOO_LOW';

// ---------------------------------------------------------------------------------------------
// Scripts Lua
// ---------------------------------------------------------------------------------------------

/** Tabela de incremento (utils/money.ts) traduzida para Lua: uma fonte só para as duas. */
const INCREMENT_LUA = `
local function increment(p)
${INCREMENTS.map(([upTo, inc]) => `  if p <= ${upTo} then return ${inc} end`).join('\n')}
  return ${bidIncrementCents(Number.MAX_SAFE_INTEGER)}
end`;

/**
 * Lance. Valida TUDO e grava atomicamente.
 * KEYS: 1 state, 2 bids, 3 idem, 4 bidders
 * ARGV: 1 userId, 2 campo de idempotência, 3 valor, 4 agora (ms), 5 lance em JSON,
 *       6 nome do líder, 7 createdAt do líder (ms), 8 janela de prorrogação (ms),
 *       9 prorrogação (ms), 10 prorrogação máxima (ms)
 *
 * Resultado aceito (também guardado na idempotência):
 *   "<bidCount>|<endsAt>|<lanceMínimoSeguinte>|<prorrogou 0/1>|<lance JSON>"
 */
const PLACE_BID = `${INCREMENT_LUA}
local previous = redis.call('HGET', KEYS[3], ARGV[2])
if previous then return {'DUP', previous} end

if redis.call('EXISTS', KEYS[1]) == 0 then return {'REJECT', 'AUCTION_NOT_RUNNING', ''} end

local s = redis.call('HMGET', KEYS[1], 'status', 'ownerId', 'leaderId', 'bidCount', 'priceCents',
  'startingPriceCents', 'endsAt', 'originalEndsAt')
local bidCount = tonumber(s[4])
local price = tonumber(s[5])
local minimum
if bidCount == 0 or price == nil then minimum = tonumber(s[6]) else minimum = price + increment(price) end

local now = tonumber(ARGV[4])
local endsAt = tonumber(s[7])
if s[1] ~= 'RUNNING' or now >= endsAt then return {'REJECT', 'AUCTION_NOT_RUNNING', tostring(minimum)} end
if s[2] == ARGV[1] then return {'REJECT', 'IS_OWNER', tostring(minimum)} end
if bidCount > 0 and s[3] == ARGV[1] then return {'REJECT', 'ALREADY_LEADER', tostring(minimum)} end

local amount = tonumber(ARGV[3])
if amount < minimum then return {'REJECT', 'BID_TOO_LOW', tostring(minimum)} end

-- RF15: lance com menos que a janela para o fim leva o término para "agora + prorrogação",
-- limitado a término original + prorrogação máxima.
local newEndsAt = endsAt
local extended = '0'
if endsAt - now < tonumber(ARGV[8]) then
  local proposed = math.min(now + tonumber(ARGV[9]), tonumber(s[8]) + tonumber(ARGV[10]))
  if proposed > endsAt then
    newEndsAt = proposed
    extended = '1'
  end
end

bidCount = bidCount + 1
local nextMinimum = amount + increment(amount)
redis.call('HSET', KEYS[1], 'priceCents', amount, 'leaderId', ARGV[1], 'leaderName', ARGV[6],
  'leaderSince', ARGV[7], 'bidCount', bidCount, 'endsAt', newEndsAt, 'minimumBidCents', nextMinimum)
redis.call('RPUSH', KEYS[2], ARGV[5])
redis.call('HSET', KEYS[4], ARGV[1], amount)

local record = tostring(bidCount) .. '|' .. tostring(newEndsAt) .. '|' .. tostring(nextMinimum) .. '|' .. extended .. '|' .. ARGV[5]
redis.call('HSET', KEYS[3], ARGV[2], record)
return {'OK', record}
`;

/**
 * O job reivindica uma sala para fechar. Só passa de RUNNING para CLOSING se o término (já com
 * as prorrogações) chegou. Depois disso, o script de lance recusa tudo.
 * KEYS: 1 state · ARGV: 1 agora (ms)
 */
const CLAIM_CLOSE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {'GONE'} end
local s = redis.call('HMGET', KEYS[1], 'status', 'endsAt')
if s[1] == 'RUNNING' then
  if tonumber(ARGV[1]) < tonumber(s[2]) then return {'NOT_DUE', s[2]} end
  redis.call('HSET', KEYS[1], 'status', 'CLOSING')
end
return {'CLOSE', ''}
`;

/**
 * Cancelamento. Normal (comitente): só RUNNING, antes do término e sem lances. Forçado (regra de
 * queda): qualquer sala ainda RUNNING; uma sala que já fechou (CLOSING) mantém a decisão.
 * KEYS: 1 state · ARGV: 1 agora (ms), 2 forçado ('1' ou '0')
 */
const CANCEL = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'GONE' end
local s = redis.call('HMGET', KEYS[1], 'status', 'endsAt', 'bidCount')
if s[1] ~= 'RUNNING' then return 'DECIDED' end
if ARGV[2] ~= '1' then
  if tonumber(ARGV[1]) >= tonumber(s[2]) then return 'NOT_OPEN' end
  if tonumber(s[3]) > 0 then return 'HAS_BIDS' end
end
redis.call('HSET', KEYS[1], 'status', 'CANCELLED')
return 'OK'
`;

/** Libera a trava só se ela ainda for de quem a pegou. */
const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

type ScriptArg = string | number;
type ScriptFn = (...args: ScriptArg[]) => Promise<unknown>;

/** Registra o script no ioredis (EVALSHA com reenvio automático se o Redis não o conhecer). */
const defineScript = (name: string, numberOfKeys: number, lua: string): ScriptFn => {
  redis.defineCommand(name, { numberOfKeys, lua });
  return (...args) => (redis as unknown as Record<string, ScriptFn>)[name]!(...args);
};

const placeBidScript = defineScript('roomPlaceBid', 4, PLACE_BID);
const claimCloseScript = defineScript('roomClaimClose', 1, CLAIM_CLOSE);
const cancelScript = defineScript('roomCancel', 1, CANCEL);
const releaseLockScript = defineScript('roomReleaseLock', 1, RELEASE_LOCK);

// ---------------------------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------------------------

const toNumberOrNull = (v: string | undefined) => (v ? Number(v) : null);

const parseState = (raw: Record<string, string>): RoomStateData | null => {
  if (!raw['auctionId']) return null;
  return {
    auctionId: raw['auctionId'],
    ownerId: raw['ownerId'] ?? '',
    status: (raw['status'] ?? 'RUNNING') as RoomStatus,
    startingPriceCents: Number(raw['startingPriceCents']),
    priceCents: toNumberOrNull(raw['priceCents']),
    leaderId: raw['leaderId'] || null,
    leaderName: raw['leaderName'] || null,
    leaderSince: raw['leaderSince'] ? new Date(Number(raw['leaderSince'])) : null,
    minimumBidCents: Number(raw['minimumBidCents']),
    bidCount: Number(raw['bidCount']),
    endsAt: new Date(Number(raw['endsAt'])),
    originalEndsAt: new Date(Number(raw['originalEndsAt'])),
  };
};

/** Campos de leilão que mudam durante a disputa (o resto vem do PostgreSQL). */
type LiveFields = {
  id: string;
  status: AuctionStatus;
  bidCount: number;
  finalPriceCents: number | null;
  winnerId: string | null;
  endsAt: Date;
  winner?: { id: string; name: string; createdAt: Date } | null;
};

class RoomState {
  /** Cria a sala quando o leilão passa para Em andamento (jobs/AuctionLifecycle.ts). */
  static async open(auction: AuctionForRoom) {
    const id = auction.id;
    await redis
      .multi()
      .del(
        RedisKeys.roomState(id),
        RedisKeys.roomBids(id),
        RedisKeys.roomIdempotency(id),
        RedisKeys.roomBidders(id),
      )
      .hset(RedisKeys.roomState(id), {
        auctionId: id,
        ownerId: auction.ownerId,
        status: 'RUNNING',
        startingPriceCents: String(auction.startingPriceCents),
        priceCents: '',
        leaderId: '',
        leaderName: '',
        leaderSince: '',
        minimumBidCents: String(auction.startingPriceCents),
        bidCount: '0',
        endsAt: String(auction.endsAt.getTime()),
        originalEndsAt: String(auction.originalEndsAt.getTime()),
      })
      .zadd(RedisKeys.roomDeadlines, auction.endsAt.getTime(), id)
      .exec();
  }

  static async get(auctionId: string): Promise<RoomStateData | null> {
    return parseState(await redis.hgetall(RedisKeys.roomState(auctionId)));
  }

  static async exists(auctionId: string) {
    return (await redis.exists(RedisKeys.roomState(auctionId))) === 1;
  }

  /**
   * Últimos lances da sala, do mais recente para o mais antigo. `null` se a sala não está no
   * Redis (leilão não começou ou já foi gravado no PostgreSQL). EXISTS + LRANGE numa transação:
   * a sala não pode sumir entre um e outro.
   */
  static async recentBids(auctionId: string, limit: number): Promise<StoredBid[] | null> {
    const res = await redis
      .multi()
      .exists(RedisKeys.roomState(auctionId))
      .lrange(RedisKeys.roomBids(auctionId), -limit, -1)
      .exec();
    if (!res || res[0]![1] !== 1) return null;
    return (res[1]![1] as string[]).map((b) => JSON.parse(b) as StoredBid).reverse();
  }

  /** Todos os lances, do primeiro ao último (para gravar no PostgreSQL). */
  static async allBids(auctionId: string): Promise<StoredBid[]> {
    const raw = await redis.lrange(RedisKeys.roomBids(auctionId), 0, -1);
    return raw.map((b) => JSON.parse(b) as StoredBid);
  }

  /** Resultado guardado de uma chave de idempotência (caminho rápido do duplo clique). */
  static async findIdempotent(auctionId: string, userId: string, key: string) {
    return redis.hget(RedisKeys.roomIdempotency(auctionId), `${userId}:${key}`);
  }

  /** Aplica um lance de forma atômica (ver PLACE_BID). */
  static async placeBid(input: {
    bid: StoredBid;
    /** Nome completo e createdAt da conta (o leilão mostra o líder como perfil público). */
    bidderFullName: string;
    bidderSince: Date;
    now: number;
  }): Promise<PlaceBidResult> {
    const { bid } = input;
    const id = bid.auctionId;
    const [kind, a, b] = (await placeBidScript(
      RedisKeys.roomState(id),
      RedisKeys.roomBids(id),
      RedisKeys.roomIdempotency(id),
      RedisKeys.roomBidders(id),
      bid.bidderId,
      `${bid.bidderId}:${bid.idempotencyKey}`,
      bid.amountCents,
      input.now,
      JSON.stringify(bid),
      input.bidderFullName,
      input.bidderSince.getTime(),
      env.AUCTION_EXTENSION_WINDOW_SECONDS * 1000,
      env.AUCTION_EXTENSION_SECONDS * 1000,
      env.AUCTION_MAX_EXTENSION_SECONDS * 1000,
    )) as [string, string, string?];

    if (kind === 'OK') return { kind: 'accepted', record: a };
    if (kind === 'DUP') return { kind: 'duplicate', record: a };
    return { kind: 'rejected', error: a as BidRuleRejection, minimumBidCents: b ? Number(b) : null };
  }

  /** Depois de um lance aceito: índices fora da hash tag da sala (prazo e participações). */
  static async afterAccepted(auctionId: string, userId: string, endsAt: number) {
    await redis
      .multi()
      // GT: só aumenta. Dois lances processados fora de ordem não "encurtam" o prazo.
      .zadd(RedisKeys.roomDeadlines, 'GT', String(endsAt), auctionId)
      .sadd(RedisKeys.userRooms(userId), auctionId)
      .exec();
  }

  /** Salas cujo prazo registrado já passou (candidatas a fechar). */
  static async dueRooms(now: number) {
    return redis.zrangebyscore(RedisKeys.roomDeadlines, '-inf', now);
  }

  static async allRoomIds() {
    return redis.zrange(RedisKeys.roomDeadlines, '0', '-1');
  }

  static async claimClose(auctionId: string, now: number) {
    const [kind, endsAt] = (await claimCloseScript(RedisKeys.roomState(auctionId), now)) as [
      'GONE' | 'NOT_DUE' | 'CLOSE',
      string,
    ];
    if (kind === 'NOT_DUE') {
      // O prazo foi prorrogado: corrige o índice e espera.
      await redis.zadd(RedisKeys.roomDeadlines, endsAt, auctionId);
    }
    if (kind === 'GONE') await redis.zrem(RedisKeys.roomDeadlines, auctionId);
    return kind;
  }

  static async cancel(auctionId: string, now: number, force = false) {
    return (await cancelScript(RedisKeys.roomState(auctionId), now, force ? '1' : '0')) as
      | 'GONE'
      | 'DECIDED'
      | 'NOT_OPEN'
      | 'HAS_BIDS'
      | 'OK';
  }

  /** Trava curta para que só uma instância grave a sala no PostgreSQL por vez. */
  static async lockSettle(auctionId: string, token: string) {
    return (await redis.set(RedisKeys.roomSettling(auctionId), token, 'PX', 30_000, 'NX')) === 'OK';
  }

  static async unlockSettle(auctionId: string, token: string) {
    await releaseLockScript(RedisKeys.roomSettling(auctionId), token);
  }

  /** Apaga a sala inteira (depois de gravada no PostgreSQL). */
  static async destroy(auctionId: string) {
    const bidders = await redis.hkeys(RedisKeys.roomBidders(auctionId));
    const tx = redis
      .multi()
      .del(
        RedisKeys.roomState(auctionId),
        RedisKeys.roomBids(auctionId),
        RedisKeys.roomIdempotency(auctionId),
        RedisKeys.roomBidders(auctionId),
      )
      .zrem(RedisKeys.roomDeadlines, auctionId);
    for (const userId of bidders) tx.srem(RedisKeys.userRooms(userId), auctionId);
    await tx.exec();
  }

  /** Salas abertas em que a pessoa deu lance, com o maior lance dela em cada uma. */
  static async participationsOf(userId: string): Promise<Map<string, number>> {
    const ids = await redis.smembers(RedisKeys.userRooms(userId));
    if (!ids.length) return new Map();

    const pipe = redis.pipeline();
    for (const id of ids) pipe.hget(RedisKeys.roomBidders(id), userId);
    const res = (await pipe.exec()) ?? [];

    const result = new Map<string, number>();
    ids.forEach((id, i) => {
      const value = res[i]?.[1] as string | null;
      if (value) result.set(id, Number(value));
    });
    return result;
  }

  /** A pessoa lidera alguma disputa aberta? (excluir conta não pode deixar leilão sem vencedor) */
  static async isLeadingAny(userId: string) {
    const ids = await redis.smembers(RedisKeys.userRooms(userId));
    for (const id of ids) {
      const state = await RoomState.get(id);
      if (state?.status === 'RUNNING' && state.leaderId === userId) return true;
    }
    return false;
  }

  /**
   * Substitui, nos leilões Em andamento, os campos que mudam com os lances (preço, líder,
   * contagem, término) pelos valores do Redis. O PostgreSQL só os recebe no fechamento.
   */
  static async withLive<T extends LiveFields>(rows: T[]): Promise<T[]> {
    const running = rows.filter((r) => r.status === AuctionStatus.RUNNING);
    if (!running.length) return rows;

    const pipe = redis.pipeline();
    for (const r of running) pipe.hgetall(RedisKeys.roomState(r.id));
    const res = (await pipe.exec()) ?? [];
    const states = new Map<string, RoomStateData>();
    running.forEach((r, i) => {
      const state = parseState((res[i]?.[1] ?? {}) as Record<string, string>);
      if (state) states.set(r.id, state);
    });

    return rows.map((row) => {
      const s = states.get(row.id);
      if (!s) return row;
      const live: T = {
        ...row,
        bidCount: s.bidCount,
        finalPriceCents: s.priceCents,
        winnerId: s.leaderId,
        endsAt: s.endsAt,
      };
      if ('winner' in row) {
        live.winner =
          s.leaderId && s.leaderName
            ? { id: s.leaderId, name: s.leaderName, createdAt: s.leaderSince ?? new Date(0) }
            : null;
      }
      return live;
    });
  }
}

export default RoomState;
