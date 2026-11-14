/**
 * Contrato dos eventos Socket.IO da sala ao vivo. O front (app/src/services/socket.ts) usa
 * exatamente estes nomes e formatos. Se mudar algo aqui, mude lá e no AGENTS.md (seção 6).
 *
 *  cliente -> servidor (todos com ack opcional)
 *   auction:join  { auctionId, role? }                    -> JoinAck (com snapshot da sala)
 *   auction:leave { auctionId }                           -> { ok }
 *   auction:role  { auctionId, role }                     -> { ok }
 *   auction:bid   { auctionId, amountCents, idempotencyKey } -> BidOutcome
 *
 *  servidor -> sala
 *   auction:status   mudou o estado do leilão (abriu, vendeu, encerrou sem lances, cancelou)
 *   auction:bid      um lance foi gravado (sempre DEPOIS do COMMIT no banco)
 *   auction:presence mudou a contagem de participantes/espectadores
 */
import type { AuctionStatus } from '../generated/prisma/enums.js';
import type { BidOutcome, BidPayload } from '../services/Bid.js';
import type { PresenceRole } from '../services/Presence.js';
import type { AuthUser } from '../types/express.js';
import type { AuctionView } from '../views/auction.js';
import type { BidView } from '../views/bid.js';

/** Nome da room do Socket.IO de um leilão. */
export const roomName = (auctionId: string) => `auction:${auctionId}`;

/** Lê o id do leilão a partir do nome da room (ou null se não for room de leilão). */
export const auctionIdFromRoom = (room: string) =>
  room.startsWith('auction:') ? room.slice('auction:'.length) : null;

export type StatusEvent = {
  auctionId: string;
  status: AuctionStatus;
  endsAt: Date;
  winnerId: string | null;
  finalPriceCents: number | null;
  serverTime: string;
};

export type BidEvent = {
  auctionId: string;
  bid: BidPayload;
  priceCents: number;
  minimumBidCents: number;
  leaderId: string;
  bidCount: number;
  endsAt: string;
  extended: boolean;
  serverTime: string;
};

export type PresenceEvent = {
  auctionId: string;
  participants: number;
  spectators: number;
};

export type RoomSnapshot = {
  auction: AuctionView;
  /** Últimos lances, do mais recente para o mais antigo. */
  bids: BidView[];
  presence: PresenceEvent;
};

export type JoinAck =
  | { ok: true; serverTime: string; role: PresenceRole; snapshot: RoomSnapshot }
  | { ok: false; serverTime: string; error: string; message: string };

export type SimpleAck = { ok: boolean; error?: string };

type Ack<T> = (response: T) => void;

// Os payloads chegam como `unknown`: quem garante o formato é o zod dentro de cada handler.
export interface ClientToServerEvents {
  'auction:join': (payload: unknown, ack?: Ack<JoinAck>) => void;
  'auction:leave': (payload: unknown, ack?: Ack<SimpleAck>) => void;
  'auction:role': (payload: unknown, ack?: Ack<SimpleAck>) => void;
  'auction:bid': (payload: unknown, ack?: Ack<BidOutcome>) => void;
}

export interface ServerToClientEvents {
  'auction:status': (event: StatusEvent) => void;
  'auction:bid': (event: BidEvent) => void;
  'auction:presence': (event: PresenceEvent) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterServerEvents {}

/** O que fica guardado em cada conexão depois do handshake. */
export type SocketData = {
  user: AuthUser;
  sessionVersion: number;
};
