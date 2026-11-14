import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { createRedisConnection } from '../redis/client.js';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './contract.js';
import BidHandler from './handlers/BidHandler.js';
import RoomHandler from './handlers/RoomHandler.js';
import SocketAuth from './middlewares/SocketAuth.js';
import RoomEmitter from './RoomEmitter.js';
import type { IoServer } from './types.js';

/**
 * Monta o servidor Socket.IO em cima do servidor HTTP da API.
 *
 *  1. CORS com credenciais (o navegador manda o cookie de sessão no handshake).
 *  2. Adapter do Redis: com mais de uma instância da API, um emit numa sala chega a quem
 *     está conectado em qualquer instância.
 *  3. SocketAuth: só entra quem tem sessão válida.
 *  4. Handlers de sala e de lance.
 */
export const createSocketServer = (httpServer: HttpServer) => {
  const io: IoServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: { origin: env.CORS_ORIGIN.split(','), credentials: true },
  });

  const pub = createRedisConnection();
  const sub = createRedisConnection();
  io.adapter(createAdapter(pub, sub));

  io.use((socket, next) => void SocketAuth.handshake(socket, next));

  io.on('connection', (socket) => {
    RoomHandler.register(socket);
    BidHandler.register(socket);
  });

  RoomEmitter.attach(io);

  const close = async () => {
    RoomEmitter.detach();
    await io.close();
    await Promise.allSettled([pub.quit(), sub.quit()]);
  };

  return { io, close };
};
