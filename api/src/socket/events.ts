import type { Server } from 'socket.io';
import type { AuthUser } from '../types/express.js';

export type SocketData = { user: AuthUser };

export let io: Server<any, any, any, SocketData>;

export const setIo = (server: Server<any, any, any, SocketData>) => {
  io = server;
};

export const auctionRoom = (auctionId: string) => `auction:${auctionId}`;

export type AuctionStatusEvent = {
  id: string;
  status: string;
  endsAt: Date;
  winnerId: string | null;
  finalPriceCents: number | null;
};

export type AuctionStateEvent = {
  auctionId: string;
  status: string;
  title: string;
  startsAt: string;
  originalEndsAt: string;
  endsAt: string;
  currentPriceCents: number;
  minimumBidCents: number;
  leaderId: string | null;
  bidCount: number;
  participants: number;
  spectators: number;
  recentBids: Array<{
    bidId: string;
    userId: string;
    amountCents: number;
    at: string;
  }>;
  serverTime: string;
};

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

export const emitAuctionState = (state: AuctionStateEvent) => {
  io?.to(auctionRoom(state.auctionId)).emit('auction:state', state);
};
