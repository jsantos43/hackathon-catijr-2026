import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { env } from "../config/env.js";
import { verifyToken, type TokenPayload } from "../lib/jwt.js";

export type SocketData = { user: TokenPayload };

export let io: Server<any, any, any, SocketData>;

export const auctionRoom = (auctionId: string) => `auction:${auctionId}`;

const joinSchema = z.object({ auctionId: z.uuid() });

export function setupSocket(server: HttpServer) {
  io = new Server<any, any, any, SocketData>(server, {
    cors: { origin: env.CORS_ORIGIN.split(","), credentials: true },
  });

  // Entrar numa sala exige login (RF04): o token vai em `auth.token` no handshake.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string") return next(new Error("UNAUTHORIZED"));

    try {
      socket.data.user = verifyToken(token);
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("auction:join", async (payload: unknown, ack?: (res: unknown) => void) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      await socket.join(auctionRoom(parsed.data.auctionId));
      // TODO: responder com o snapshot atual do leilão (preço, lance mínimo, líder, término...).
      ack?.({ ok: true, serverTime: new Date().toISOString() });
    });

    socket.on("auction:leave", async (payload: unknown) => {
      const parsed = joinSchema.safeParse(payload);
      if (parsed.success) await socket.leave(auctionRoom(parsed.data.auctionId));
    });
  });

  return io;
}
