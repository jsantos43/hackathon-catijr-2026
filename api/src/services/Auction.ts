import { env } from '../config/env.js';
import { Forbidden, NotFound, Unprocessable } from '../errors/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AuctionStatus } from '../generated/prisma/enums.js';
import { db } from '../prisma/db.js';
import {
  AUCTION_DESCRIPTION_MAX,
  type CreateAuctionData,
  type AuctionSort,
  type ListAuctionsQuery,
  type MyAuctionsQuery,
  type UpdateAuctionData,
} from '../schemas/Auction.js';
import RoomEmitter from '../socket/RoomEmitter.js';
import {
  auctionSelect,
  OPEN_STATUSES,
  serializeAuction,
  type AuctionRow,
} from '../views/auction.js';
import { lockOwnItems } from './Item.js';
import RoomState from './RoomState.js';

type Tx = Prisma.TransactionClient;

const secondsFromNow = (seconds: number) => new Date(Date.now() + seconds * 1000);

/** RF05/RF06: antecedência mínima e máxima do início, configuráveis no .env. */
const assertStartWindow = (startsAt: Date) => {
  if (startsAt < secondsFromNow(env.AUCTION_MIN_LEAD_SECONDS)) {
    throw new Unprocessable(
      `startsAt must be at least ${env.AUCTION_MIN_LEAD_SECONDS} seconds from now`,
    );
  }
  if (startsAt > secondsFromNow(env.AUCTION_MAX_LEAD_SECONDS)) {
    throw new Unprocessable(
      `startsAt must be at most ${env.AUCTION_MAX_LEAD_SECONDS} seconds from now`,
    );
  }
};

/**
 * Trava os itens do lote e confere se todos podem entrar num leilão novo (RF28): nenhum pode
 * estar em outro leilão Agendado/Em andamento, nem já ter sido vendido.
 * `exceptAuctionId` ignora o próprio leilão quando ele está sendo editado.
 */
const lockAvailableItems = async (
  tx: Tx,
  itemIds: string[],
  userId: string,
  exceptAuctionId?: string,
) => {
  await lockOwnItems(tx, itemIds, userId);

  const conflicts = await tx.auctionItem.findMany({
    where: {
      itemId: { in: itemIds },
      auction: {
        status: { in: [...OPEN_STATUSES, AuctionStatus.SOLD] },
        ...(exceptAuctionId && { id: { not: exceptAuctionId } }),
      },
    },
    select: { item: { select: { name: true } }, auction: { select: { status: true } } },
  });

  if (conflicts.length) {
    throw new Unprocessable(
      conflicts.map(({ item, auction }) =>
        auction.status === AuctionStatus.SOLD
          ? `"${item.name}" was already sold`
          : `"${item.name}" is already in a scheduled or running auction`,
      ),
    );
  }
};

/**
 * Trava a linha do leilão até o fim da transação. Quem grava lance deve travar a mesma linha
 * (SELECT ... FOR UPDATE), assim edição/cancelamento nunca acontecem no meio de um lance.
 */
const lockOwnAuction = async (tx: Tx, id: string, userId: string) => {
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Auction" WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new NotFound('Auction not found');

  const auction = await tx.auction.findUniqueOrThrow({ where: { id } });
  if (auction.ownerId !== userId) throw new Forbidden('This auction belongs to another user');

  return auction;
};

const lotItems = (itemIds: string[]) => itemIds.map((itemId, position) => ({ itemId, position }));

const buildWhere = (
  query: Pick<ListAuctionsQuery, 'q' | 'category' | 'status'>,
): Prisma.AuctionWhereInput => ({
  status: { in: query.status },
  // Categoria: o lote aparece se tiver pelo menos um item dela.
  ...(query.category && {
    items: { some: { item: { category: { in: query.category } } } },
  }),
  // Busca pelo título do leilão ou pelo nome de qualquer item do lote.
  ...(query.q && {
    OR: [
      { title: { contains: query.q, mode: 'insensitive' } },
      { items: { some: { item: { name: { contains: query.q, mode: 'insensitive' } } } } },
    ],
  }),
});

const paginate = async (
  where: Prisma.AuctionWhereInput,
  { page, pageSize }: { page: number; pageSize: number },
  orderBy: Prisma.AuctionOrderByWithRelationInput[],
) => {
  const [auctions, total] = await db.$transaction([
    db.auction.findMany({
      where,
      select: auctionSelect,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.auction.count({ where }),
  ]);

  return { auctions: auctions.map(serializeAuction), page, pageSize, total };
};

/** Preço que aparece no card: o maior lance, ou o preço inicial se ainda não houve lance. */
const currentPrice = (a: { bidCount: number; finalPriceCents: number | null; startingPriceCents: number }) =>
  a.bidCount > 0 && a.finalPriceCents !== null ? a.finalPriceCents : a.startingPriceCents;

/**
 * Ordenar por preço atual precisa de COALESCE(finalPriceCents, startingPriceCents), que o
 * Prisma não faz no orderBy. Busca só id + preços dos que passam no filtro, ordena aqui e
 * depois carrega a página. Serve bem enquanto a listagem tem algumas centenas de leilões.
 */
const paginateByPrice = async (
  where: Prisma.AuctionWhereInput,
  { page, pageSize }: { page: number; pageSize: number },
) => {
  const rows = await db.auction.findMany({
    where,
    select: { id: true, bidCount: true, finalPriceCents: true, startingPriceCents: true },
  });
  const ids = rows
    .sort((a, b) => currentPrice(a) - currentPrice(b) || a.id.localeCompare(b.id))
    .slice((page - 1) * pageSize, page * pageSize)
    .map((r) => r.id);

  const found = await db.auction.findMany({ where: { id: { in: ids } }, select: auctionSelect });
  const byId = new Map(found.map((a) => [a.id, a]));
  const auctions = ids.map((id) => byId.get(id)).filter((a): a is AuctionRow => !!a);

  return { auctions: auctions.map(serializeAuction), page, pageSize, total: rows.length };
};

/**
 * Ordem "ao vivo primeiro": Em andamento (termina primeiro), depois Agendados (começa primeiro)
 * e, se pedidos, os encerrados (mais recentes primeiro). Cada grupo usa seu próprio índice;
 * a página é recortada somando os grupos em sequência.
 */
const LIVE_GROUPS: { status: AuctionStatus[]; orderBy: Prisma.AuctionOrderByWithRelationInput[] }[] = [
  { status: [AuctionStatus.RUNNING], orderBy: [{ endsAt: 'asc' }, { id: 'asc' }] },
  { status: [AuctionStatus.SCHEDULED], orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] },
  {
    status: [AuctionStatus.SOLD, AuctionStatus.ENDED_NO_BIDS, AuctionStatus.CANCELLED],
    orderBy: [{ endsAt: 'desc' }, { id: 'asc' }],
  },
];

const paginateLiveFirst = async (
  where: Prisma.AuctionWhereInput,
  statuses: AuctionStatus[],
  { page, pageSize }: { page: number; pageSize: number },
) => {
  const groups = LIVE_GROUPS.map((g) => ({
    ...g,
    where: { ...where, status: { in: g.status.filter((s) => statuses.includes(s)) } },
  })).filter((g) => g.where.status.in.length > 0);

  const counts = await db.$transaction(groups.map((g) => db.auction.count({ where: g.where })));
  const total = counts.reduce((a, b) => a + b, 0);

  let skip = (page - 1) * pageSize;
  let take = pageSize;
  const rows: AuctionRow[] = [];
  for (const [i, g] of groups.entries()) {
    if (take === 0) break;
    if (skip >= counts[i]) {
      skip -= counts[i];
      continue;
    }
    const found = await db.auction.findMany({
      where: g.where,
      select: auctionSelect,
      orderBy: g.orderBy,
      skip,
      take,
    });
    rows.push(...found);
    take -= found.length;
    skip = 0;
  }

  return { auctions: rows.map(serializeAuction), page, pageSize, total };
};

const SORT_ORDER: Record<Exclude<AuctionSort, 'price' | 'live'>, Prisma.AuctionOrderByWithRelationInput[]> = {
  ends: [{ endsAt: 'asc' }, { id: 'asc' }],
  starts: [{ startsAt: 'asc' }, { id: 'asc' }],
  bids: [{ bidCount: 'desc' }, { endsAt: 'asc' }, { id: 'asc' }],
};

class Auction {
  /**
   * RF20/RF21: listagem pública. `sort`: live (em andamento e depois agendados), ends (termina
   * primeiro, padrão), starts, price, bids.
   * Sem `sort`, se a lista incluir encerrados, os mais recentes vêm primeiro.
   */
  static async list(query: ListAuctionsQuery) {
    const where: Prisma.AuctionWhereInput = {
      ...buildWhere(query),
      ...(query.ownerId && { ownerId: query.ownerId }),
    };

    if (query.sort === 'price') return paginateByPrice(where, query);
    if (query.sort === 'live') return paginateLiveFirst(where, query.status, query);
    if (query.sort) return paginate(where, query, SORT_ORDER[query.sort]);

    const onlyOpen = query.status.every((s) => OPEN_STATUSES.includes(s));
    return paginate(where, query, [{ endsAt: onlyOpen ? 'asc' : 'desc' }, { id: 'asc' }]);
  }

  /** Leilões que o usuário criou (como comitente), em qualquer estado. */
  static async listOwn(userId: string, query: MyAuctionsQuery) {
    return paginate({ ...buildWhere(query), ownerId: userId }, query, [
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  }

  /**
   * Leilões que o usuário venceu (histórico de compras). Só os Vendidos: enquanto a disputa
   * corre, winnerId é apenas o líder atual.
   */
  static async listWon(userId: string, query: MyAuctionsQuery) {
    return paginate({ ...buildWhere(query), status: AuctionStatus.SOLD, winnerId: userId }, query, [
      { endsAt: 'desc' },
      { id: 'asc' },
    ]);
  }

  static async readById(id: string) {
    const auction = await db.auction.findUnique({ where: { id }, select: auctionSelect });

    if (!auction) throw new NotFound('Auction not found');

    return serializeAuction(auction);
  }

  /** Cria um lote. Também é a relistagem (RF28): os itens não vendidos podem ir para outro lote. */
  static async create(userId: string, data: CreateAuctionData) {
    assertStartWindow(data.startsAt);

    const endsAt = new Date(data.startsAt.getTime() + data.durationSeconds * 1000);

    const { id } = await db.$transaction(async (tx) => {
      // Com os itens travados, dois pedidos simultâneos não colocam o mesmo item em dois
      // leilões abertos.
      await lockAvailableItems(tx, data.itemIds, userId);

      return tx.auction.create({
        data: {
          ownerId: userId,
          title: data.title,
          description: data.description,
          startingPriceCents: data.startingPriceCents,
          startsAt: data.startsAt,
          originalEndsAt: endsAt,
          endsAt,
          items: { create: lotItems(data.itemIds) },
        },
        select: { id: true },
      });
    });

    return Auction.readById(id);
  }

  /**
   * RF23, quanto mais perto do início e quanto mais lances, menos se pode mudar:
   * - Agendado, faltando mais que AUCTION_EDIT_LOCK_SECONDS: todos os campos, inclusive os
   *   itens do lote (e os próprios itens podem ser editados pela rota de item).
   * - Agendado, faltando menos: nada.
   * - Em andamento (com ou sem lances): só acrescentar texto à descrição.
   * - Finalizado: nada.
   */
  static async update(id: string, userId: string, data: UpdateAuctionData) {
    const { appendDescription, ...fields } = data;
    const changesFields = Object.keys(fields).length > 0;

    await db.$transaction(async (tx) => {
      const auction = await lockOwnAuction(tx, id, userId);
      const now = new Date();
      const editableUntil = new Date(
        auction.startsAt.getTime() - env.AUCTION_EDIT_LOCK_SECONDS * 1000,
      );
      const fullyEditable = auction.status === AuctionStatus.SCHEDULED && now < editableUntil;

      if (changesFields) {
        if (!fullyEditable) {
          throw new Unprocessable(
            `Only text can be appended now: other fields can change only while the auction is scheduled more than ${Math.round(env.AUCTION_EDIT_LOCK_SECONDS / 60)} minutes ahead`,
          );
        }

        const startsAt = fields.startsAt ?? auction.startsAt;
        const durationMs =
          fields.durationSeconds !== undefined
            ? fields.durationSeconds * 1000
            : auction.originalEndsAt.getTime() - auction.startsAt.getTime();
        const endsAt = new Date(startsAt.getTime() + durationMs);

        if (fields.startsAt) assertStartWindow(startsAt);

        if (fields.itemIds) {
          await lockAvailableItems(tx, fields.itemIds, userId, id);
          await tx.auctionItem.deleteMany({ where: { auctionId: id } });
          await tx.auctionItem.createMany({
            data: lotItems(fields.itemIds).map((i) => ({ ...i, auctionId: id })),
          });
        }

        await tx.auction.update({
          where: { id },
          data: {
            ...(fields.title !== undefined && { title: fields.title }),
            ...(fields.description !== undefined && { description: fields.description }),
            ...(fields.startingPriceCents !== undefined && {
              startingPriceCents: fields.startingPriceCents,
            }),
            startsAt,
            originalEndsAt: endsAt,
            endsAt,
          },
        });
      }

      if (appendDescription !== undefined) {
        const canAppend =
          fullyEditable || (auction.status === AuctionStatus.RUNNING && now < auction.endsAt);
        if (!canAppend) {
          throw new Unprocessable('Text can only be appended while the auction is running');
        }

        // Só acrescenta: o que já estava escrito quando alguém deu lance continua lá.
        const current = fields.description ?? auction.description;
        const description = current ? `${current}\n\n${appendDescription}` : appendDescription;
        if (description.length > AUCTION_DESCRIPTION_MAX) {
          throw new Unprocessable(`Description would exceed ${AUCTION_DESCRIPTION_MAX} characters`);
        }

        await tx.auction.update({ where: { id }, data: { description } });
      }
    });

    return Auction.readById(id);
  }

  /**
   * RF08: cancela enquanto Agendado ou Em andamento sem lances. Nada é apagado, e os itens
   * ficam livres para entrar em outro lote.
   * Com a linha travada, um lance simultâneo ou é gravado antes (e o cancelamento é
   * recusado) ou depois (e encontra o leilão já cancelado).
   */
  static async cancel(id: string, userId: string) {
    await db.$transaction(async (tx) => {
      const auction = await lockOwnAuction(tx, id, userId);
      const now = new Date();

      if (!OPEN_STATUSES.includes(auction.status) || auction.endsAt <= now) {
        throw new Unprocessable('Only scheduled or running auctions can be cancelled');
      }
      if (auction.bidCount > 0) {
        throw new Unprocessable('Auctions with bids cannot be cancelled');
      }

      await tx.auction.update({ where: { id }, data: { status: AuctionStatus.CANCELLED } });
    });

    // Fora da transação: a sala some do Redis e quem está nela é avisado.
    await RoomState.clear(id);
    const auction = await Auction.readById(id);
    RoomEmitter.status(auction);

    return auction;
  }
}

export default Auction;
