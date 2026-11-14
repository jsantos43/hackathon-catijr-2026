import { z } from 'zod';
import { NotFound } from '../../errors/index.js';
import { roleSchema, roomSchema } from '../../schemas/Bid.js';
import Auction from '../../services/Auction.js';
import Bid from '../../services/Bid.js';
import Presence, { type PresenceRole } from '../../services/Presence.js';
import { auctionIdFromRoom, roomName, type JoinAck, type SimpleAck } from '../contract.js';
import RoomEmitter from '../RoomEmitter.js';
import type { IoSocket } from '../types.js';

const joinSchema = roomSchema.extend({
  role: z.enum(['participant', 'spectator']).optional(),
});

const serverTime = () => new Date().toISOString();

/**
 * Entrar, sair e trocar de papel numa sala (RF09, RF24).
 *
 * Qualquer pessoa logada pode entrar na sala de qualquer leilão (agendado, ao vivo ou
 * encerrado) para acompanhar. Ao entrar, recebe no ack um snapshot com o leilão, os últimos
 * lances e a presença: o front não precisa de outra chamada para desenhar a sala, e ao
 * reconectar basta entrar de novo para ficar em dia.
 */
class RoomHandler {
  static register(socket: IoSocket) {
    socket.on('auction:join', (payload, ack) => void RoomHandler.join(socket, payload, ack));
    socket.on('auction:leave', (payload, ack) => void RoomHandler.leave(socket, payload, ack));
    socket.on('auction:role', (payload, ack) => void RoomHandler.role(socket, payload, ack));
    // "disconnecting" (e não "disconnect"): ainda dá para ler em quais salas o socket estava.
    socket.on('disconnecting', () => void RoomHandler.disconnecting(socket));
  }

  static async join(socket: IoSocket, payload: unknown, ack?: (res: JoinAck) => void) {
    const parsed = joinSchema.safeParse(payload);
    if (!parsed.success) {
      return ack?.({
        ok: false,
        serverTime: serverTime(),
        error: 'INVALID_PAYLOAD',
        message: 'Leilão inválido.',
      });
    }

    const { auctionId } = parsed.data;
    try {
      const auction = await Auction.readById(auctionId);
      await socket.join(roomName(auctionId));

      // Comitente sempre conta como espectador: ele não pode dar lance no próprio leilão.
      const isOwner = auction.ownerId === socket.data.user.id;
      const role: PresenceRole = isOwner ? 'spectator' : (parsed.data.role ?? 'participant');
      await Presence.set(auctionId, socket.id, socket.data.user.id, role);

      const [bids, presence] = await Promise.all([
        Bid.listRecent(auctionId),
        Presence.count(auctionId),
      ]);

      ack?.({
        ok: true,
        serverTime: serverTime(),
        role,
        snapshot: { auction, bids, presence: { auctionId, ...presence } },
      });

      await RoomEmitter.presence(auctionId);
    } catch (err) {
      if (err instanceof NotFound) {
        return ack?.({
          ok: false,
          serverTime: serverTime(),
          error: 'NOT_FOUND',
          message: 'Leilão não encontrado.',
        });
      }
      console.error(`Erro ao entrar na sala ${auctionId}`, err);
      ack?.({
        ok: false,
        serverTime: serverTime(),
        error: 'INTERNAL',
        message: 'Não foi possível entrar na sala.',
      });
    }
  }

  static async leave(socket: IoSocket, payload: unknown, ack?: (res: SimpleAck) => void) {
    const parsed = roomSchema.safeParse(payload);
    if (!parsed.success) return ack?.({ ok: false, error: 'INVALID_PAYLOAD' });

    const { auctionId } = parsed.data;
    try {
      await socket.leave(roomName(auctionId));
      await Presence.remove(auctionId, socket.id);
      await RoomEmitter.presence(auctionId);
      ack?.({ ok: true });
    } catch (err) {
      console.error(`Erro ao sair da sala ${auctionId}`, err);
      ack?.({ ok: false, error: 'INTERNAL' });
    }
  }

  /** Alterna entre participar da disputa e só assistir, sem sair da sala. */
  static async role(socket: IoSocket, payload: unknown, ack?: (res: SimpleAck) => void) {
    const parsed = roleSchema.safeParse(payload);
    if (!parsed.success) return ack?.({ ok: false, error: 'INVALID_PAYLOAD' });

    const { auctionId, role } = parsed.data;
    if (!socket.rooms.has(roomName(auctionId))) return ack?.({ ok: false, error: 'NOT_IN_ROOM' });

    try {
      await Presence.set(auctionId, socket.id, socket.data.user.id, role);
      await RoomEmitter.presence(auctionId);
      ack?.({ ok: true });
    } catch (err) {
      console.error(`Erro ao trocar de papel na sala ${auctionId}`, err);
      ack?.({ ok: false, error: 'INTERNAL' });
    }
  }

  /** A conexão caiu ou a aba fechou: some da presença de todas as salas em que estava. */
  static async disconnecting(socket: IoSocket) {
    const auctionIds = [...socket.rooms]
      .map(auctionIdFromRoom)
      .filter((id): id is string => id !== null);

    for (const auctionId of auctionIds) {
      try {
        await Presence.remove(auctionId, socket.id);
        await RoomEmitter.presence(auctionId);
      } catch (err) {
        console.error(`Erro ao remover presença da sala ${auctionId}`, err);
      }
    }
  }
}

export default RoomHandler;
