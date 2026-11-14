import { z } from 'zod';
import { env } from '../config/env.js';
import { AuctionStatus, Category } from '../generated/prisma/enums.js';

const MAX_PRICE_CENTS = 1_000_000_000;

const startingPriceCents = z
  .number('startingPriceCents must be a number of cents')
  .int('startingPriceCents must be an integer number of cents')
  .min(100, 'Starting price must be at least R$ 1,00')
  .max(MAX_PRICE_CENTS);

// ISO 8601 com fuso (ex.: "2026-11-14T18:00:00Z" ou "...-03:00"): o instante é o mesmo
// para todo mundo, qualquer que seja o fuso de quem enviou (RF19).
const startsAt = z.iso.datetime({ offset: true, error: 'startsAt must be an ISO date with timezone' }).transform((v) => new Date(v));

const durationSeconds = z
  .number()
  .int()
  .min(env.AUCTION_MIN_DURATION_SECONDS, `Duration must be at least ${env.AUCTION_MIN_DURATION_SECONDS} seconds`)
  .max(env.AUCTION_MAX_DURATION_SECONDS, `Duration must be at most ${env.AUCTION_MAX_DURATION_SECONDS} seconds`);

export const AUCTION_TITLE_MAX = 100;
export const AUCTION_DESCRIPTION_MAX = 3000;

const title = z.string().trim().min(3, 'Title must be at least 3 characters').max(AUCTION_TITLE_MAX);
const description = z.string().trim().max(AUCTION_DESCRIPTION_MAX).default('');

// O lote: um ou mais itens do próprio usuário, na ordem em que aparecem no leilão.
const itemIds = z
  .array(z.uuid('itemIds must contain valid UUIDs'))
  .min(1, 'Send at least one item')
  .max(env.AUCTION_MAX_ITEMS, `An auction can have at most ${env.AUCTION_MAX_ITEMS} items`)
  .refine((ids) => new Set(ids).size === ids.length, 'itemIds must not repeat items');

export const createAuctionSchema = z.object({
  title,
  description,
  itemIds,
  startingPriceCents,
  startsAt,
  durationSeconds,
});

export type CreateAuctionData = z.infer<typeof createAuctionSchema>;

// RF23: o que pode mudar depende do estado (ver services/Auction.ts).
// - Agendado com mais de 30 min: todos os campos, inclusive os itens do lote.
// - Em andamento: só acrescentar texto à descrição do leilão.
export const updateAuctionSchema = z
  .object({
    title: title.exactOptional(),
    description: z.string().trim().max(AUCTION_DESCRIPTION_MAX).exactOptional(),
    itemIds: itemIds.exactOptional(),
    startingPriceCents: startingPriceCents.exactOptional(),
    startsAt: startsAt.exactOptional(),
    durationSeconds: durationSeconds.exactOptional(),
    appendDescription: z.string().trim().min(1).max(500).exactOptional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Send at least one field to update');

export type UpdateAuctionData = z.infer<typeof updateAuctionSchema>;

export const auctionIdSchema = z.object({
  id: z.uuid('Id must be a valid UUID'),
});

export type AuctionIdParams = z.infer<typeof auctionIdSchema>;

const csvOf = <T extends z.ZodType<unknown, string>>(schema: T) =>
  z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(schema).min(1));

// RF20/RF21: listagem pública com filtros combináveis.
export const listAuctionsSchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  category: csvOf(z.enum(Category)).optional(),
  // Por padrão só mostra o que ainda está aberto (agendados e em andamento).
  status: csvOf(z.enum(AuctionStatus)).default([AuctionStatus.RUNNING, AuctionStatus.SCHEDULED]),
  ownerId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListAuctionsQuery = z.infer<typeof listAuctionsSchema>;

export const myAuctionsSchema = listAuctionsSchema.omit({ ownerId: true }).extend({
  // Nas minhas listas mostra tudo por padrão, inclusive os encerrados.
  status: csvOf(z.enum(AuctionStatus)).default(Object.values(AuctionStatus)),
});

export type MyAuctionsQuery = z.infer<typeof myAuctionsSchema>;
