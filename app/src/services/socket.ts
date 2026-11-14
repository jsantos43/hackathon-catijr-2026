/**
 * Socket.IO da sala ao vivo. A autenticação é o mesmo cookie httpOnly `accessToken` da API,
 * então basta `withCredentials: true`.
 *
 * Contrato dos eventos (o que já existe na API está marcado; o resto é PENDENTE e está
 * descrito no AGENTS.md):
 *
 *  cliente -> servidor
 *   - auction:join  { auctionId }                      ✔ existe (ack { ok, serverTime }; snapshot PENDENTE)
 *   - auction:leave { auctionId }                      ✔ existe
 *   - auction:bid   { auctionId, amountCents, idempotencyKey }   PENDENTE
 *       ack { ok: true, bid, auction } | { ok: false, error, message, minimumBidCents }
 *   - auction:role  { auctionId, role: 'participant' | 'spectator' }  PENDENTE (presença)
 *
 *  servidor -> cliente
 *   - auction:status  { auctionId, status, endsAt, winnerId, finalPriceCents, serverTime }  ✔ existe
 *   - auction:bid     { auctionId, bid, priceCents, minimumBidCents, leaderId, bidCount,
 *                       endsAt, extended, serverTime }                                    PENDENTE
 *   - auction:presence { auctionId, participants, spectators }                            PENDENTE
 */
import { io, type Socket } from 'socket.io-client';
import { API_URL, PENDING_FALLBACK } from '../config';
import { serverNow, syncServerTime } from '../lib/serverClock';
import { uuid } from '../lib/format';
import type { Auction, AuctionStatus, Bid } from '../types';
import { refreshSession } from './api';

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
  | 'INVALID_PAYLOAD';

export type BidAck =
  | { ok: true; bid: Bid; auction?: Partial<Auction>; mocked?: boolean }
  | { ok: false; error: BidRejectCode | string; message?: string; minimumBidCents?: number };

export interface JoinAck {
  ok: boolean;
  serverTime?: string;
  error?: string;
  /** PENDENTE: a API ainda não manda o snapshot no join. */
  snapshot?: { auction: Auction; bids: Bid[]; presence?: PresenceEvent };
}

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

export const joinAuction = async (s: Socket, auctionId: string): Promise<JoinAck> => {
  const ack = (await s.timeout(5000).emitWithAck('auction:join', { auctionId })) as JoinAck;
  syncServerTime(ack.serverTime);
  return ack;
};

export const setRole = (s: Socket, auctionId: string, role: 'participant' | 'spectator') => {
  // PENDENTE na API: sem handler, o evento é só ignorado.
  s.emit('auction:role', { auctionId, role });
};

/**
 * Envia um lance com uma chave única por tentativa (reenvio com a mesma chave não duplica).
 * Se a API não responder (evento `auction:bid` ainda não implementado), devolve uma resposta
 * genérica de "aceito" para a interface poder ser testada.
 */
export const placeBid = async (
  s: Socket,
  payload: { auctionId: string; amountCents: number; idempotencyKey: string },
  me: { id: string; name: string },
): Promise<BidAck> => {
  if (!s.connected) return { ok: false, error: 'DISCONNECTED', message: 'Sem conexão com a sala.' };

  try {
    return (await s.timeout(5000).emitWithAck('auction:bid', payload)) as BidAck;
  } catch (err) {
    if (!PENDING_FALLBACK) throw err;
    console.info('[pendente] auction:bid sem resposta da API, usando resposta genérica.');
    return {
      ok: true,
      mocked: true,
      bid: {
        id: uuid(),
        auctionId: payload.auctionId,
        bidderId: me.id,
        bidderName: me.name,
        amountCents: payload.amountCents,
        createdAt: new Date(serverNow()).toISOString(),
      },
    };
  }
};
