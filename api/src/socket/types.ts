import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './contract.js';

/** Servidor e socket já tipados com o contrato, para o TypeScript conferir cada emit. */
export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
