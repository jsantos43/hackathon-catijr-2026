import type { Prisma } from '../generated/prisma/client.js';
import { shortName } from '../utils/names.js';

export const bidSelect = {
  id: true,
  auctionId: true,
  bidderId: true,
  amountCents: true,
  createdAt: true,
  bidder: { select: { name: true } },
} as const satisfies Prisma.BidSelect;

type BidRow = Prisma.BidGetPayload<{ select: typeof bidSelect }>;

/** Lance como aparece na sala: o nome de quem deu fica abreviado ("Marina T."). */
export const serializeBid = ({ bidder, ...bid }: BidRow) => ({
  ...bid,
  bidderName: shortName(bidder.name),
});

export type BidView = ReturnType<typeof serializeBid>;
