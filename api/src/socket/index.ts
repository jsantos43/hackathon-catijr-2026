import type { Server as HttpServer } from 'node:http';
import { parseCookie } from 'cookie';
import { Server } from 'socket.io';
import { z } from 'zod';
import { env } from '../config/env.js';
import Auth from '../services/Auth.js';
import type { AuthUser } from '../types/express.js';

export type SocketData = { user: AuthUser };

export let io: Server<any, any, any, SocketData>;

export const auctionRoom = (auctionId: string) => `auction:${auctionId}`;

export type AuctionStatusEvent = {
  id: string;
  status: string;
  endsAt: Date;
  winnerId: string | null;
  finalPriceCents: number | null;
};

/**
 * Avisa a sala que o leilão mudou de estado (abriu, foi vendido, encerrou sem lances ou foi
 * cancelado). Só é chamado depois que a mudança foi gravada no banco.
 */
export const emitAuctionStatus = (auction: AuctionStatusEvent) => {
  io?.to(auctionRoom(auction.id)).emit('auction:status', {
    auctionId: auction.id,
    status: auction.status,
    endsAt: auction.endsAt,
    winnerId: auction.winnerId,
    finalPriceCents: auction.finalPriceCents,
    serverTime: new Date().toISOString(),
  });
};

const joinSchema = z.object({ auctionId: z.uuid() });

export function setupSocket(server: HttpServer) {
  io = new Server<any, any, any, SocketData>(server, {
    cors: { origin: env.CORS_ORIGIN.split(','), credentials: true },
  });

  // Entrar numa sala exige login (RF04). Usa o mesmo cookie httpOnly `accessToken` da API,
  // então o front só precisa conectar com `withCredentials: true`.
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const { user } = await Auth.authenticate(cookies['accessToken']);
      socket.data.user = user;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('auction:join', async (payload: unknown, ack?: (res: unknown) => void) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: 'INVALID_PAYLOAD' });

      await socket.join(auctionRoom(parsed.data.auctionId));
      // TODO: responder com o snapshot atual do leilão (preço, lance mínimo, líder, término...).
      ack?.({ ok: true, serverTime: new Date().toISOString() });
    });

    socket.on('auction:leave', async (payload: unknown) => {
      const parsed = joinSchema.safeParse(payload);
      if (parsed.success) await socket.leave(auctionRoom(parsed.data.auctionId));
    });
  });

  return io;
}
