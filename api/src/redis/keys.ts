/**
 * Todas as chaves que a API usa no Redis, num lugar só. Assim fica fácil saber o que existe
 * (e apagar tudo de uma sala) sem caçar strings pelo código.
 *
 *   room:<auctionId>:state       HASH   estado quente da sala enquanto o leilão está Em andamento
 *   room:<auctionId>:presence    HASH   socketId -> "userId|role" de quem está na sala agora
 *   bid:idem:<userId>:<key>      STRING resultado (JSON) do lance enviado com essa chave
 *   bid:throttle:<userId>        STRING existe por BID_THROTTLE_MS depois de cada lance
 *   ratelimit:<scope>:<ip>       STRING contador de requisições na janela atual
 */
export const RedisKeys = {
  roomState: (auctionId: string) => `room:${auctionId}:state`,
  roomPresence: (auctionId: string) => `room:${auctionId}:presence`,
  /** Padrão para achar todas as chaves de presença (usado na subida da API). */
  allPresence: 'room:*:presence',
  bidIdempotency: (userId: string, key: string) => `bid:idem:${userId}:${key}`,
  bidThrottle: (userId: string) => `bid:throttle:${userId}`,
  rateLimit: (scope: string, id: string) => `ratelimit:${scope}:${id}`,
} as const;
