import type { Prisma } from '../generated/prisma/client.js';
import { AuctionStatus } from '../generated/prisma/enums.js';
import { minimumBidCents } from '../utils/money.js';
import { itemSelect, serializeItem } from './item.js';
import { publicUserSelect } from './user.js';

/** Estados em que o leilão ainda está "aberto" (dá ou vai dar para dar lance). */
export const OPEN_STATUSES: AuctionStatus[] = [AuctionStatus.SCHEDULED, AuctionStatus.RUNNING];

export const auctionSelect = {
  id: true,
  ownerId: true,
  title: true,
  description: true,
  status: true,
  startingPriceCents: true,
  bidCount: true,
  startsAt: true,
  originalEndsAt: true,
  endsAt: true,
  winnerId: true,
  finalPriceCents: true,
  createdAt: true,
  updatedAt: true,
  items: { select: { item: { select: itemSelect } }, orderBy: { position: 'asc' } },
  // Perfis públicos: sem e-mail.
  owner: { select: publicUserSelect },
  // Em andamento: líder atual. Depois: vencedor. Null se ninguém deu lance.
  winner: { select: publicUserSelect },
} as const satisfies Prisma.AuctionSelect;

export type AuctionRow = Prisma.AuctionGetPayload<{ select: typeof auctionSelect }>;

/** Formato de leilão que a API devolve em todas as rotas e no snapshot da sala. */
export const serializeAuction = ({ items, ...auction }: AuctionRow) => ({
  ...auction,
  items: items.map(({ item }) => serializeItem(item)),
  // Só faz sentido enquanto ainda dá para dar lance.
  minimumBidCents: OPEN_STATUSES.includes(auction.status) ? minimumBidCents(auction) : null,
});

export type AuctionView = ReturnType<typeof serializeAuction>;
