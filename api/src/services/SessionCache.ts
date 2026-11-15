import { redis } from '../redis/client.js';
import { RedisKeys } from '../redis/keys.js';
import { db } from '../prisma/db.js';

const TTL_SECONDS = 24 * 60 * 60;
/** Versão que nunca bate: conta excluída. */
const REVOKED = '-1';

/**
 * Cada lance reconfere a sessão (quem fez logout ou excluiu a conta não dá lance por um
 * socket que ficou aberto). Para isso não precisar do PostgreSQL durante a disputa, a
 * sessionVersion válida de cada usuário fica no Redis (session:<userId>).
 *
 *  - leitura: GET; se não houver, busca no banco UMA vez e guarda com SET NX;
 *  - logout/exclusão: depois do COMMIT, SET (sem NX) com a versão nova.
 *
 * O NX na leitura e o SET simples na invalidação garantem que um valor antigo lido do banco
 * nunca sobrescreve uma invalidação mais nova.
 */
class SessionCache {
  static async isValid(userId: string, sessionVersion: number) {
    const cached = await redis.get(RedisKeys.session(userId));
    if (cached !== null) return cached === String(sessionVersion);

    const active = await db.user.findFirst({
      where: { id: userId, sessionVersion, deletedAt: null },
      select: { id: true },
    });
    if (active) await redis.set(RedisKeys.session(userId), String(sessionVersion), 'EX', TTL_SECONDS, 'NX');
    return !!active;
  }

  /**
   * No handshake do socket a sessão acabou de ser conferida no banco: já deixa guardada, assim
   * os lances seguintes só consultam o Redis.
   */
  static async warm(userId: string, sessionVersion: number) {
    await redis.set(RedisKeys.session(userId), String(sessionVersion), 'EX', TTL_SECONDS, 'NX');
  }

  /** A sessão mudou de versão (logout). */
  static async setVersion(userId: string, sessionVersion: number) {
    await redis.set(RedisKeys.session(userId), String(sessionVersion), 'EX', TTL_SECONDS);
  }

  /** Conta excluída: nenhuma versão vale mais. */
  static async revoke(userId: string) {
    await redis.set(RedisKeys.session(userId), REVOKED, 'EX', TTL_SECONDS);
  }
}

export default SessionCache;
