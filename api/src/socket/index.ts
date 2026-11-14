import type { Server as HttpServer } from 'node:http';
import { parseCookie } from 'cookie';
import { Server } from 'socket.io';
import { z } from 'zod';
import { env } from '../config/env.js';
import { db } from '../prisma/db.js';
import AuctionRoom from '../services/AuctionRoom.js';
import Auth from '../services/Auth.js';
import {
  auctionRoom,
  emitAuctionState,
  setIo,
  type SocketData,
} from './events.js';

const joinSchema = z.object({ auctionId: z.uuid() });

const bidSchema = z.object({
  auctionId: z.uuid(),
  amountCents: z.number().int().positive(),
  requestId: z.uuid(),
});

const roomIdFromName = (name: string) =>
  name.startsWith('auction:') ? name.slice('auction:'.length) : null;

export function setupSocket(server: HttpServer) {
  const io = new Server<any, any, any, SocketData>(server, {
    cors: { origin: env.CORS_ORIGIN.split(','), credentials: true },
  });

  setIo(io);

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

      const auction = await db.auction.findUnique({
        where: { id: parsed.data.auctionId },
        select: { status: true },
      });
      if (!auction) return ack?.({ ok: false, error: 'NOT_FOUND' });

      await socket.join(auctionRoom(parsed.data.auctionId));

      const room = AuctionRoom.get(parsed.data.auctionId);
      if (!room) {
        return ack?.({
          ok: true,
          snapshot: null,
          status: auction.status,
          serverTime: new Date().toISOString(),
        });
      }

      room.addConnection(socket.data.user.id, socket.id);
      ack?.({
        ok: true,
        snapshot: await room.snapshot(),
        serverTime: new Date().toISOString(),
      });
    });

    socket.on('auction:leave', async (payload: unknown) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return;

      const room = AuctionRoom.get(parsed.data.auctionId);
      room?.removeConnection(socket.data.user.id, socket.id);
      await socket.leave(auctionRoom(parsed.data.auctionId));
    });

    socket.on('bid:place', async (payload: unknown, ack?: (res: unknown) => void) => {
      const parsed = bidSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, code: 'INVALID_PAYLOAD' });

      const { auctionId, amountCents, requestId } = parsed.data;
      if (!socket.rooms.has(auctionRoom(auctionId))) {
        return ack?.({ ok: false, code: 'NOT_IN_ROOM' });
      }

      const room = AuctionRoom.get(auctionId);
      if (!room) return ack?.({ ok: false, code: 'NOT_RUNNING' });

      try {
        const result = await room.placeBid({
          userId: socket.data.user.id,
          amountCents,
          requestId,
        });

        if (!result.ok) return ack?.(result);

        emitAuctionState(await room.snapshot());
        ack?.(result);
      } catch (err) {
        console.error(`Erro ao processar lance no leilão ${auctionId}`, err);
        ack?.({ ok: false, code: 'INTERNAL' });
      }
    });

    socket.on('disconnect', () => {
      for (const name of socket.rooms) {
        const auctionId = roomIdFromName(name);
        if (!auctionId) continue;
        AuctionRoom.get(auctionId)?.removeConnection(socket.data.user.id, socket.id);
      }
    });
  });

  return io;
}
