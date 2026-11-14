import { redis } from '../redis/client.js';
import { RedisKeys } from '../redis/keys.js';

export type PresenceRole = 'participant' | 'spectator';

export type PresenceCount = { participants: number; spectators: number };

/**
 * RF09 — quem está na sala agora, separado em participantes (podem dar lance) e espectadores.
 *
 * Fica no Redis (HASH room:<id>:presence, campo = socketId, valor = "userId|role") para que
 * várias instâncias da API enxerguem a mesma contagem. A contagem é por pessoa, não por aba:
 * quem abriu a sala em duas abas conta uma vez, como participante se for participante em
 * qualquer uma delas.
 */
class Presence {
  static async set(auctionId: string, socketId: string, userId: string, role: PresenceRole) {
    await redis.hset(RedisKeys.roomPresence(auctionId), socketId, `${userId}|${role}`);
  }

  static async remove(auctionId: string, socketId: string) {
    await redis.hdel(RedisKeys.roomPresence(auctionId), socketId);
  }

  static async count(auctionId: string): Promise<PresenceCount> {
    const entries = await redis.hvals(RedisKeys.roomPresence(auctionId));

    const roleByUser = new Map<string, PresenceRole>();
    for (const entry of entries) {
      const [userId, role] = entry.split('|') as [string, PresenceRole];
      if (roleByUser.get(userId) !== 'participant') roleByUser.set(userId, role);
    }

    let participants = 0;
    for (const role of roleByUser.values()) if (role === 'participant') participants += 1;

    return { participants, spectators: roleByUser.size - participants };
  }

  /**
   * Na subida da API nenhum socket está conectado, então qualquer presença guardada é lixo de
   * uma execução anterior.
   */
  static async clearAll() {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', RedisKeys.allPresence, 'COUNT', 100);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }
}

export default Presence;
