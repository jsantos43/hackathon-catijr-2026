/**
 * Todas as chaves que a API usa no Redis, num lugar só. Assim fica fácil saber o que existe
 * (e apagar tudo de uma sala) sem caçar strings pelo código.
 *
 * Chaves de uma sala Em andamento. O trecho `{<auctionId>}` é uma *hash tag*: num Redis Cluster
 * todas as chaves de uma mesma sala caem no mesmo nó, o que permite que um script Lua toque
 * várias delas de forma atômica (ver services/RoomState.ts).
 *
 *   room:{<id>}:state      HASH   estado da sala: status, preço, líder, término, contagem…
 *   room:{<id>}:bids       LIST   TODOS os lances aceitos, em ordem (JSON). Vai para o Postgres no fim
 *   room:{<id>}:idem       HASH   "<userId>:<chave>" -> resultado do lance (idempotência / duplo clique)
 *   room:{<id>}:bidders    HASH   userId -> maior lance dessa pessoa (participações, RF27)
 *   room:{<id>}:settling   STRING trava curta de quem está gravando a sala no Postgres
 *   room:{<id>}:presence   HASH   socketId -> "userId|role" de quem está na sala agora
 *
 * Índices globais:
 *   rooms:deadlines        ZSET   auctionId com score = término (ms). O job fecha o que venceu
 *   user:<id>:rooms        SET    salas abertas em que a pessoa deu lance
 *   session:<userId>       STRING sessionVersion válida (evita ir ao banco a cada lance)
 *   bid:throttle:<userId>  STRING existe por BID_THROTTLE_MS depois de cada lance
 *   ratelimit:<scope>:<ip> STRING contador de requisições na janela atual
 */
const room = (auctionId: string) => `room:{${auctionId}}`;

export const RedisKeys = {
  roomState: (auctionId: string) => `${room(auctionId)}:state`,
  roomBids: (auctionId: string) => `${room(auctionId)}:bids`,
  roomIdempotency: (auctionId: string) => `${room(auctionId)}:idem`,
  roomBidders: (auctionId: string) => `${room(auctionId)}:bidders`,
  roomSettling: (auctionId: string) => `${room(auctionId)}:settling`,
  roomPresence: (auctionId: string) => `${room(auctionId)}:presence`,
  /** Padrão para achar todas as chaves de presença (usado na subida da API). */
  allPresence: 'room:*:presence',
  roomDeadlines: 'rooms:deadlines',
  userRooms: (userId: string) => `user:${userId}:rooms`,
  session: (userId: string) => `session:${userId}`,
  bidThrottle: (userId: string) => `bid:throttle:${userId}`,
  rateLimit: (scope: string, id: string) => `ratelimit:${scope}:${id}`,
} as const;
