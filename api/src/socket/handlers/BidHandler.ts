import { placeBidSchema } from '../../schemas/Bid.js';
import Bid, { reject, type BidOutcome } from '../../services/Bid.js';
import { roomName } from '../contract.js';
import SocketAuth from '../middlewares/SocketAuth.js';
import RoomEmitter from '../RoomEmitter.js';
import type { IoSocket } from '../types.js';

/**
 * Evento `auction:bid` (cliente -> servidor). Este handler só cuida do que é do socket:
 * formato do payload, sessão, estar na sala e transmitir o resultado. As regras do lance
 * ficam em services/Bid.ts.
 */
class BidHandler {
  static register(socket: IoSocket) {
    socket.on('auction:bid', (payload, ack) => void BidHandler.place(socket, payload, ack));
  }

  static async place(socket: IoSocket, payload: unknown, ack?: (res: BidOutcome) => void) {
    const parsed = placeBidSchema.safeParse(payload);
    if (!parsed.success) return ack?.(reject('INVALID_PAYLOAD'));

    const { auctionId, amountCents, idempotencyKey } = parsed.data;

    try {
      if (!socket.rooms.has(roomName(auctionId))) return ack?.(reject('NOT_IN_ROOM'));
      if (!(await SocketAuth.isSessionValid(socket))) return ack?.(reject('UNAUTHORIZED'));

      const outcome = await Bid.place({
        auctionId,
        bidder: socket.data.user,
        amountCents,
        idempotencyKey,
      });

      // Reenvio (duplicate) não é transmitido de novo: a sala já recebeu esse lance.
      if (outcome.ok && !outcome.duplicate) RoomEmitter.bid(auctionId, outcome);

      ack?.(outcome);
    } catch (err) {
      console.error(`Erro ao processar lance no leilão ${auctionId}`, err);
      ack?.(reject('INTERNAL'));
    }
  }
}

export default BidHandler;
