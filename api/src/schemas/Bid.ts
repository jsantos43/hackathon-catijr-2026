import { z } from 'zod';
import { MAX_PRICE_CENTS } from './Auction.js';

// Payloads que chegam pelo socket. O navegador pode mandar qualquer coisa, então tudo passa
// pelo zod antes de chegar ao service.

export const roomSchema = z.object({
  auctionId: z.uuid(),
});

export type RoomPayload = z.infer<typeof roomSchema>;

export const roleSchema = roomSchema.extend({
  role: z.enum(['participant', 'spectator']),
});

export type RolePayload = z.infer<typeof roleSchema>;

export const placeBidSchema = roomSchema.extend({
  amountCents: z.number().int().positive().max(MAX_PRICE_CENTS),
  // Gerada pelo navegador a cada tentativa (normalmente um UUID).
  idempotencyKey: z.string().trim().min(8).max(100),
});

export type PlaceBidPayload = z.infer<typeof placeBidSchema>;

// GET /auction/:id/bids?limit=20
export const listBidsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListBidsQuery = z.infer<typeof listBidsSchema>;
