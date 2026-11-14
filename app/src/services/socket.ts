/**
 * Socket.IO da sala ao vivo. A autenticação é o mesmo cookie httpOnly `accessToken` da API,
 * então basta `withCredentials: true`.
 *
 * Contrato dos eventos (espelho de api/src/socket/contract.ts):
 *
 *  cliente -> servidor (todos com ack)
 *   - auction:join  { auctionId, role? }   -> { ok, serverTime, role, snapshot: { auction, bids, presence } }
 *   - auction:leave { auctionId }          -> { ok }
 *   - auction:role  { auctionId, role }    -> { ok }
 *   - auction:bid   { auctionId, amountCents, idempotencyKey }
 *       -> { ok: true, bid, auction, extended, duplicate? } | { ok: false, error, message, minimumBidCents }
 *
 *  servidor -> sala
 *   - auction:status   { auctionId, status, endsAt, winnerId, finalPriceCents, serverTime }
 *   - auction:bid      { auctionId, bid, priceCents, minimumBidCents, leaderId, bidCount, endsAt, extended, serverTime }
 *   - auction:presence { auctionId, participants, spectators }
 */
import { io, type Socket } from 'socket.io-client';
import { API_URL } from '../config';
import { syncServerTime } from '../lib/serverClock';
import type { Auction, AuctionStatus, Bid } from '../types';
import { refreshSession } from './api';

export type Role = 'participant' | 'spectator';

export interface StatusEvent {
  auctionId: string;
  status: AuctionStatus;
  endsAt: string;
  winnerId: string | null;
  finalPriceCents: number | null;
  serverTime: string;
}

export interface BidEvent {
  auctionId: string;
  bid: Bid;
  priceCents: number;
  minimumBidCents: number;
  leaderId: string;
  bidCount: number;
  endsAt: string;
  extended: boolean;
  serverTime: string;
}

export interface PresenceEvent {
  auctionId: string;
  participants: number;
  spectators: number;
}

export type BidRejectCode =
  | 'BID_TOO_LOW'
  | 'AUCTION_NOT_RUNNING'
  | 'IS_OWNER'
  | 'ALREADY_LEADER'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INVALID_PAYLOAD'
  | 'NOT_IN_ROOM'
  | 'INTERNAL'
  | 'DISCONNECTED';

export type BidAck =
  | {
      ok: true;
      bid: Bid;
      auction: {
        finalPriceCents: number;
        minimumBidCents: number;
        bidCount: number;
        endsAt: string;
        winnerId: string;
      };
      extended: boolean;
      /** Reenvio de um lance que o servidor já tinha processado. */
      duplicate?: boolean;
    }
  | { ok: false; error: BidRejectCode | string; message?: string; minimumBidCents?: number | null };

export type JoinAck =
  | {
      ok: true;
      serverTime: string;
      role: Role;
      snapshot: { auction: Auction; bids: Bid[]; presence: PresenceEvent };
    }
  | { ok: false; serverTime?: string; error: string; message?: string };

let socket: Socket | null = null;
let refreshedOnce = false;

export const getSocket = () => {
  if (socket) return socket;

  socket = io(API_URL, {
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });

  // Handshake recusado por token expirado: renova a sessão uma vez e tenta de novo.
  socket.on('connect_error', async (err) => {
    if (err.message === 'UNAUTHORIZED' && !refreshedOnce) {
      refreshedOnce = true;
      try {
        await refreshSession();
        socket?.connect();
      } catch {
        window.dispatchEvent(new Event('auth:expired'));
      }
    }
  });
  socket.on('connect', () => {
    refreshedOnce = false;
  });

  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};

/** Entra na sala. O ack já traz o snapshot (leilão, últimos lances, presença). */
export const joinAuction = async (s: Socket, auctionId: string, role?: Role): Promise<JoinAck> => {
  const ack = (await s.timeout(5000).emitWithAck('auction:join', { auctionId, role })) as JoinAck;
  syncServerTime(ack.serverTime);
  return ack;
};

export const setRole = (s: Socket, auctionId: string, role: Role) =>
  s.timeout(5000).emitWithAck('auction:role', { auctionId, role }) as Promise<{ ok: boolean }>;

/**
 * Envia um lance com uma chave única por tentativa. Se a conexão cair antes do ack e o lance
 * for reenviado com a mesma chave, o servidor devolve o resultado original (não duplica).
 */
export const placeBid = async (
  s: Socket,
  payload: { auctionId: string; amountCents: number; idempotencyKey: string },
): Promise<BidAck> => {
  if (!s.connected) return { ok: false, error: 'DISCONNECTED', message: 'Sem conexão com a sala.' };
  return (await s.timeout(8000).emitWithAck('auction:bid', payload)) as BidAck;
};
