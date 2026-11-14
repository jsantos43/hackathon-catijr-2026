import type { Prisma } from '../generated/prisma/client.js';
import { publicUrl } from '../utils/storage.js';

export const itemSelect = {
  id: true,
  ownerId: true,
  name: true,
  description: true,
  category: true,
  images: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ItemSelect;

/** Troca as chaves do bucket pelas URLs públicas que o navegador usa. */
export const serializeItem = <T extends { images: string[] }>(item: T) => ({
  ...item,
  images: item.images.map(publicUrl),
});

// Item do próprio usuário + os leilões (lotes) de que ele já participou, do mais recente
// para o mais antigo.
export const ownItemSelect = {
  ...itemSelect,
  auctions: {
    select: {
      auction: {
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
          finalPriceCents: true,
        },
      },
    },
    orderBy: { auction: { createdAt: 'desc' } },
  },
} as const satisfies Prisma.ItemSelect;

type OwnItemRow = Prisma.ItemGetPayload<{ select: typeof ownItemSelect }>;

export const serializeOwnItem = ({ auctions, ...item }: OwnItemRow) => ({
  ...serializeItem(item),
  auctions: auctions.map((a) => a.auction),
});
