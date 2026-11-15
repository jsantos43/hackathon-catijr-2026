import { z } from 'zod';
import { env } from '../config/env.js';
import { AuctionStatus, Category } from '../generated/prisma/enums.js';

export const MAX_PRICE_CENTS = 1_000_000_000;

const startingPriceCents = z
  .number('O preço inicial precisa ser um número (em centavos)')
  .int('O preço inicial precisa ser um número inteiro de centavos')
  .min(100, 'O preço inicial precisa ser de pelo menos R$ 1,00')
  .max(MAX_PRICE_CENTS);

// ISO 8601 com fuso (ex.: "2026-11-14T18:00:00Z" ou "...-03:00")
const startsAt = z.iso.datetime({ offset: true, error: 'O início precisa ser uma data ISO com fuso horário' }).transform((v) => new Date(v));

const durationSeconds = z
  .number()
  .int()
  .min(env.AUCTION_MIN_DURATION_SECONDS, `A duração precisa ser de pelo menos ${env.AUCTION_MIN_DURATION_SECONDS} segundos`)
  .max(env.AUCTION_MAX_DURATION_SECONDS, `A duração pode ser de no máximo ${env.AUCTION_MAX_DURATION_SECONDS} segundos`);

export const AUCTION_TITLE_MAX = 100;
export const AUCTION_DESCRIPTION_MAX = 3000;

const title = z.string().trim().min(3, 'O título precisa ter pelo menos 3 caracteres').max(AUCTION_TITLE_MAX);
const description = z.string().trim().max(AUCTION_DESCRIPTION_MAX).default('');

const itemIds = z
  .array(z.uuid('itemIds precisa ter ids válidos'))
  .min(1, 'Escolha pelo menos um item')
  .max(env.AUCTION_MAX_ITEMS, `Um leilão pode ter no máximo ${env.AUCTION_MAX_ITEMS} itens`)
  .refine((ids) => new Set(ids).size === ids.length, 'O mesmo item não pode aparecer duas vezes');

export const createAuctionSchema = z.object({
  title,
  description,
  itemIds,
  startingPriceCents,
  startsAt,
  durationSeconds,
});

export type CreateAuctionData = z.infer<typeof createAuctionSchema>;

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
  .refine((data) => Object.keys(data).length > 0, 'Envie pelo menos um campo para alterar');

export type UpdateAuctionData = z.infer<typeof updateAuctionSchema>;

export const auctionIdSchema = z.object({
  id: z.uuid('Id inválido (UUID)'),
});

export type AuctionIdParams = z.infer<typeof auctionIdSchema>;

const csvOf = <T extends z.ZodType<unknown, string>>(schema: T) =>
  z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(schema).min(1));

export const AUCTION_SORTS = ['live', 'ends', 'starts', 'price', 'bids'] as const;
export type AuctionSort = (typeof AUCTION_SORTS)[number];

// RF20/RF21: listagem pública com filtros combináveis.
export const listAuctionsSchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  category: csvOf(z.enum(Category)).optional(),
  // Por padrão só mostra o que ainda está aberto (agendados e em andamento).
  status: csvOf(z.enum(AuctionStatus)).default([AuctionStatus.RUNNING, AuctionStatus.SCHEDULED]),
  ownerId: z.uuid().optional(),
  // live: em andamento (termina primeiro) e depois agendados (começa primeiro) · ends: termina primeiro · starts: começa primeiro · price: menor preço atual · bids: mais lances
  sort: z.enum(AUCTION_SORTS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListAuctionsQuery = z.infer<typeof listAuctionsSchema>;

export const myAuctionsSchema = listAuctionsSchema.omit({ ownerId: true }).extend({
  // Nas minhas listas mostra tudo por padrão, inclusive os encerrados.
  status: csvOf(z.enum(AuctionStatus)).default(Object.values(AuctionStatus)),
});

export type MyAuctionsQuery = z.infer<typeof myAuctionsSchema>;
