import { env } from '../config/env.js';
import { redis } from '../redis/client.js';
import { RedisKeys } from '../redis/keys.js';
import { minimumBidCents } from '../utils/money.js';

/**
 * Estado "quente" de uma sala Em andamento, guardado no Redis (HASH room:<id>:state).
 *
 * Para que serve: responder rápido, sem ir ao PostgreSQL, a pergunta "esse lance tem chance
 * de ser aceito?". Lances que com certeza seriam recusados (valor abaixo do mínimo, comitente
 * tentando dar lance) param aqui. Os demais seguem para o PostgreSQL, que dá a palavra final
 * com a linha do leilão travada (ver services/Bid.ts).
 *
 * Ciclo de vida:
 *   - open():   quando o leilão passa para Em andamento (jobs/AuctionLifecycle.ts);
 *   - update(): depois de cada lance gravado no banco;
 *   - clear():  quando o leilão encerra ou é cancelado.
 */
export type RoomStateData = {
  auctionId: string;
  ownerId: string;
  /** Preço atual: maior lance aceito (null se ainda não houve lance). */
  priceCents: number | null;
  leaderId: string | null;
  minimumBidCents: number;
  bidCount: number;
  endsAt: Date;
};

/** Os campos do leilão (como estão no banco) de onde o estado da sala é calculado. */
export type AuctionForRoom = {
  id: string;
  ownerId: string;
  startingPriceCents: number;
  bidCount: number;
  finalPriceCents: number | null;
  winnerId: string | null;
  endsAt: Date;
};

export type PrecheckRejection = 'IS_OWNER' | 'BID_TOO_LOW';

const toHash = (auction: AuctionForRoom): Record<string, string> => ({
  auctionId: auction.id,
  ownerId: auction.ownerId,
  priceCents: auction.bidCount > 0 && auction.finalPriceCents !== null ? String(auction.finalPriceCents) : '',
  leaderId: auction.bidCount > 0 && auction.winnerId ? auction.winnerId : '',
  minimumBidCents: String(minimumBidCents(auction)),
  bidCount: String(auction.bidCount),
  endsAt: String(auction.endsAt.getTime()),
});

/**
 * Atualiza o HASH só se a sala ainda existe e se o estado novo não é mais antigo que o
 * guardado. Dois lances gravados quase juntos podem chegar aqui fora de ordem; comparar o
 * bidCount garante que o Redis nunca "volta no tempo". Lua roda de forma atômica no Redis.
 */
const UPDATE_IF_NEWER = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local stored = tonumber(redis.call('HGET', KEYS[1], 'bidCount') or '-1')
if stored > tonumber(ARGV[2]) then return 0 end
redis.call('HSET', KEYS[1], unpack(ARGV, 3))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
return 1
`;

class RoomState {
  /** Cria (ou recria) o estado da sala a partir do leilão do banco. */
  static async open(auction: AuctionForRoom) {
    const key = RedisKeys.roomState(auction.id);
    await redis
      .multi()
      .del(key)
      .hset(key, toHash(auction))
      .expire(key, env.REDIS_ROOM_TTL_SECONDS)
      .exec();
  }

  /** Reflete no Redis um lance que acabou de ser gravado no banco. */
  static async update(auction: AuctionForRoom) {
    const fields = Object.entries(toHash(auction)).flat();
    await redis.eval(
      UPDATE_IF_NEWER,
      1,
      RedisKeys.roomState(auction.id),
      String(env.REDIS_ROOM_TTL_SECONDS),
      String(auction.bidCount),
      ...fields,
    );
  }

  static async get(auctionId: string): Promise<RoomStateData | null> {
    const raw = await redis.hgetall(RedisKeys.roomState(auctionId));
    if (!raw.auctionId) return null;

    return {
      auctionId: raw.auctionId,
      ownerId: raw.ownerId ?? '',
      priceCents: raw.priceCents ? Number(raw.priceCents) : null,
      leaderId: raw.leaderId || null,
      minimumBidCents: Number(raw.minimumBidCents),
      bidCount: Number(raw.bidCount),
      endsAt: new Date(Number(raw.endsAt)),
    };
  }

  static async clear(auctionId: string) {
    await redis.del(RedisKeys.roomState(auctionId));
  }

  /**
   * Pré-validação pelo Redis. Só recusa o que é recusa CERTA mesmo se o Redis estiver um
   * pouquinho atrasado em relação ao banco:
   *   - o comitente nunca muda;
   *   - o lance mínimo só sobe, então abaixo de um mínimo antigo também é abaixo do atual.
   * "Já é o líder" e "leilão encerrado" mudam nos dois sentidos, então quem decide é o banco.
   */
  static precheck(
    state: RoomStateData,
    { userId, amountCents }: { userId: string; amountCents: number },
  ): PrecheckRejection | null {
    if (state.ownerId === userId) return 'IS_OWNER';
    if (amountCents < state.minimumBidCents) return 'BID_TOO_LOW';
    return null;
  }
}

export default RoomState;
