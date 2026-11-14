import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/**
 * Conexão principal com o Redis. Guarda o estado "quente" das salas (ver RoomState), as chaves
 * de idempotência e de anti-rajada dos lances, a presença e os contadores de rate limit.
 *
 * O Redis é um acelerador: se ele perder os dados, nada permanente se perde, porque o
 * PostgreSQL é a fonte da verdade.
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('error', (err: Error) => {
  console.error('Erro no Redis:', err.message);
});

/**
 * Conexões extras para o adapter do Socket.IO (pub/sub). Uma conexão em modo "subscribe" não
 * pode executar outros comandos, por isso cada uma é separada.
 */
export const createRedisConnection = () => redis.duplicate();

export const closeRedis = async () => {
  if (redis.status !== 'end') await redis.quit();
};
