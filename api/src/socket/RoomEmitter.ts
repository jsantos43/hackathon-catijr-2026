import type { AuctionStatus } from '../generated/prisma/enums.js';
import type { BidAccepted } from '../services/Bid.js';
import Presence from '../services/Presence.js';
import { roomName } from './contract.js';
import type { IoServer } from './types.js';

const serverTime = () => new Date().toISOString();

/**
 * Único ponto que envia eventos para as salas. Services e jobs chamam estes métodos sem
 * precisar conhecer o Socket.IO. Antes de o servidor de socket existir (ou nos testes de
 * REST), os envios simplesmente não acontecem.
 *
 * Com o adapter do Redis, `io.to(room).emit` chega a quem está na sala em QUALQUER instância
 * da API, não só nesta.
 */
class RoomEmitter {
  private static io: IoServer | null = null;

  static attach(io: IoServer) {
    RoomEmitter.io = io;
  }

  static detach() {
    RoomEmitter.io = null;
  }

  /** O leilão mudou de estado (abriu, vendeu, encerrou sem lances, foi cancelado). */
  static status(auction: {
    id: string;
    status: AuctionStatus;
    endsAt: Date;
    winnerId: string | null;
    finalPriceCents: number | null;
  }) {
    RoomEmitter.io?.to(roomName(auction.id)).emit('auction:status', {
      auctionId: auction.id,
      status: auction.status,
      endsAt: auction.endsAt,
      winnerId: auction.winnerId,
      finalPriceCents: auction.finalPriceCents,
      serverTime: serverTime(),
    });
  }

  /** Um lance foi gravado: todos na sala recebem o novo preço, líder, mínimo e término. */
  static bid(auctionId: string, outcome: BidAccepted) {
    RoomEmitter.io?.to(roomName(auctionId)).emit('auction:bid', {
      auctionId,
      bid: outcome.bid,
      priceCents: outcome.auction.finalPriceCents,
      minimumBidCents: outcome.auction.minimumBidCents,
      leaderId: outcome.auction.winnerId,
      bidCount: outcome.auction.bidCount,
      endsAt: outcome.auction.endsAt,
      extended: outcome.extended,
      serverTime: serverTime(),
    });
  }

  /** Recalcula a presença no Redis e envia a contagem nova para a sala. */
  static async presence(auctionId: string) {
    if (!RoomEmitter.io) return;
    const count = await Presence.count(auctionId);
    RoomEmitter.io.to(roomName(auctionId)).emit('auction:presence', { auctionId, ...count });
  }
}

export default RoomEmitter;
