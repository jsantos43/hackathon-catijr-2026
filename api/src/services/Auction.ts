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
import Settlement from './Settlement.js';
import { containsPattern } from '../utils/search.js';

type Tx = Prisma.TransactionClient;

const secondsFromNow = (seconds: number) => new Date(Date.now() + seconds * 1000);

/** RF05/RF06: antecedência mínima e máxima do início, configuráveis no .env. */
const assertStartWindow = (startsAt: Date) => {
  if (startsAt < secondsFromNow(env.AUCTION_MIN_LEAD_SECONDS)) {
    throw new Unprocessable(
      `O início precisa ser pelo menos ${env.AUCTION_MIN_LEAD_SECONDS} segundos à frente`,
    );
  }
  if (startsAt > secondsFromNow(env.AUCTION_MAX_LEAD_SECONDS)) {
    throw new Unprocessable(
      `O início pode ser no máximo ${Math.round(env.AUCTION_MAX_LEAD_SECONDS / 86400)} dias à frente`,
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
          ? `"${item.name}" já foi vendido`
          : `"${item.name}" já está em outro leilão agendado ou em andamento`,
      ),
    );
  }
};

/**
 * Trava a linha do leilão até o fim da transação (SELECT ... FOR UPDATE): edição, cancelamento
 * e abertura pelo job (UPDATE condicional) nunca se atropelam. Lances não passam por aqui:
 * durante a disputa eles só existem no Redis (ver RoomState).
 */
const lockOwnAuction = async (tx: Tx, id: string, userId: string) => {
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Auction" WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new NotFound('Leilão não encontrado');

  const auction = await tx.auction.findUniqueOrThrow({ where: { id } });
  if (auction.ownerId !== userId) throw new Forbidden('Esse leilão é de outra pessoa');

  return auction;
};

const lotItems = (itemIds: string[]) => itemIds.map((itemId, position) => ({ itemId, position }));

/**
 * Ids dos leilões cujo título, ou o nome de algum item do lote, contém o texto buscado.
 * Ignora maiúsculas e acentos (unaccent), então "camera" acha "Câmera" (RF21: grafia diferente).
 */
const auctionIdsMatching = async (q: string) => {
  const pattern = containsPattern(q);
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Auction" a
     WHERE unaccent(a.title) ILIKE unaccent(${pattern})
    UNION
    SELECT ai."auctionId" FROM "AuctionItem" ai
      JOIN "Item" i ON i.id = ai."itemId"
     WHERE unaccent(i.name) ILIKE unaccent(${pattern})`;
  return rows.map((r) => r.id);
};

const buildWhere = async (
  query: Pick<ListAuctionsQuery, 'q' | 'category' | 'status'>,
): Promise<Prisma.AuctionWhereInput> => ({
  status: { in: query.status },
  // Categoria: o lote aparece se tiver pelo menos um item dela.
  ...(query.category && {
    items: { some: { item: { category: { in: query.category } } } },
  }),
  // Busca pelo título do leilão ou pelo nome de qualquer item do lote.
  ...(query.q && { id: { in: await auctionIdsMatching(query.q) } }),
});

/** Serializa aplicando o estado ao vivo (Redis) nos leilões Em andamento. */
const serializeLive = async (rows: AuctionRow[]) =>
  (await RoomState.withLive(rows)).map(serializeAuction);

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

  return { auctions: await serializeLive(auctions), page, pageSize, total };
};

/** Preço que aparece no card: o maior lance, ou o preço inicial se ainda não houve lance. */
const currentPrice = (a: { bidCount: number; finalPriceCents: number | null; startingPriceCents: number }) =>
  a.bidCount > 0 && a.finalPriceCents !== null ? a.finalPriceCents : a.startingPriceCents;

type SortRow = {
  id: string;
  status: AuctionStatus;
  bidCount: number;
  finalPriceCents: number | null;
  startingPriceCents: number;
  winnerId: string | null;
  endsAt: Date;
};

const IN_MEMORY_SORT: Record<'price' | 'bids', (a: SortRow, b: SortRow) => number> = {
  price: (a, b) => currentPrice(a) - currentPrice(b) || a.id.localeCompare(b.id),
  bids: (a, b) =>
    b.bidCount - a.bidCount || a.endsAt.getTime() - b.endsAt.getTime() || a.id.localeCompare(b.id),
};

/**
 * Ordenar por preço atual ou número de lances. Durante a disputa esses valores só existem no
 * Redis (o PostgreSQL recebe no fechamento), então a ordenação é feita aqui: busca só os campos
 * de ordenação dos que passam no filtro, aplica o estado ao vivo, ordena e carrega a página.
 * Serve bem enquanto a listagem tem algumas centenas de leilões.
 */
const paginateInMemory = async (
  where: Prisma.AuctionWhereInput,
  sort: 'price' | 'bids',
  { page, pageSize }: { page: number; pageSize: number },
) => {
  const rows = await RoomState.withLive(
    await db.auction.findMany({
      where,
      select: {
        id: true,
        status: true,
        bidCount: true,
        finalPriceCents: true,
        startingPriceCents: true,
        winnerId: true,
        endsAt: true,
      },
    }),
  );
  const ids = rows
    .sort(IN_MEMORY_SORT[sort])
    .slice((page - 1) * pageSize, page * pageSize)
    .map((r) => r.id);

  const found = await db.auction.findMany({ where: { id: { in: ids } }, select: auctionSelect });
  const byId = new Map(found.map((a) => [a.id, a]));
  const auctions = ids.map((id) => byId.get(id)).filter((a): a is AuctionRow => !!a);

  return { auctions: await serializeLive(auctions), page, pageSize, total: rows.length };
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

  return { auctions: await serializeLive(rows), page, pageSize, total };
};

const SORT_ORDER: Record<Exclude<AuctionSort, 'price' | 'bids' | 'live'>, Prisma.AuctionOrderByWithRelationInput[]> = {
  // Em andamento, o endsAt do PostgreSQL ainda não tem as prorrogações (estão no Redis);
  // a diferença é de no máximo alguns minutos na ordem.
  ends: [{ endsAt: 'asc' }, { id: 'asc' }],
  starts: [{ startsAt: 'asc' }, { id: 'asc' }],
};

class Auction {
  /**
   * RF20/RF21: listagem pública. `sort`: live (em andamento e depois agendados), ends (termina
   * primeiro, padrão), starts, price, bids.
   * Sem `sort`, se a lista incluir encerrados, os mais recentes vêm primeiro.
   */
  static async list(query: ListAuctionsQuery) {
    const where: Prisma.AuctionWhereInput = {
      ...(await buildWhere(query)),
      ...(query.ownerId && { ownerId: query.ownerId }),
    };

    if (query.sort === 'price' || query.sort === 'bids') return paginateInMemory(where, query.sort, query);
    if (query.sort === 'live') return paginateLiveFirst(where, query.status, query);
    if (query.sort) return paginate(where, query, SORT_ORDER[query.sort]);

    const onlyOpen = query.status.every((s) => OPEN_STATUSES.includes(s));
    return paginate(where, query, [{ endsAt: onlyOpen ? 'asc' : 'desc' }, { id: 'asc' }]);
  }

  /** Leilões que o usuário criou (como comitente), em qualquer estado. */
  static async listOwn(userId: string, query: MyAuctionsQuery) {
    return paginate({ ...(await buildWhere(query)), ownerId: userId }, query, [
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  }

  /**
   * Leilões que o usuário venceu (histórico de compras). Só os Vendidos: enquanto a disputa
   * corre, winnerId é apenas o líder atual.
   */
  static async listWon(userId: string, query: MyAuctionsQuery) {
    return paginate({ ...(await buildWhere(query)), status: AuctionStatus.SOLD, winnerId: userId }, query, [
      { endsAt: 'desc' },
      { id: 'asc' },
    ]);
  }

  static async readById(id: string) {
    const auction = await db.auction.findUnique({ where: { id }, select: auctionSelect });

    if (!auction) throw new NotFound('Leilão não encontrado');

    const [live] = await RoomState.withLive([auction]);
    return serializeAuction(live!);
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
            `Agora só é possível acrescentar texto à descrição: os outros campos só mudam enquanto faltar mais de ${Math.round(env.AUCTION_EDIT_LOCK_SECONDS / 60)} minutos para o início`,
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
        // Em andamento, o término que vale (com prorrogações) está na sala, no Redis.
        const room = auction.status === AuctionStatus.RUNNING ? await RoomState.get(id) : null;
        const canAppend =
          fullyEditable || (room?.status === 'RUNNING' && now < room.endsAt);
        if (!canAppend) {
          throw new Unprocessable('Só é possível acrescentar texto enquanto o leilão está em andamento');
        }

        // Só acrescenta: o que já estava escrito quando alguém deu lance continua lá.
        const current = fields.description ?? auction.description;
        const description = current ? `${current}\n\n${appendDescription}` : appendDescription;
        if (description.length > AUCTION_DESCRIPTION_MAX) {
          throw new Unprocessable(`A descrição passaria de ${AUCTION_DESCRIPTION_MAX} caracteres`);
        }

        await tx.auction.update({ where: { id }, data: { description } });
      }
    });

    return Auction.readById(id);
  }

  /**
   * RF08: cancela enquanto Agendado ou Em andamento sem lances. Nada é apagado, e os itens
   * ficam livres para entrar em outro lote.
   *
   * - Agendado: só existe no PostgreSQL. Com a linha travada, a abertura pelo job (UPDATE
   *   condicional WHERE status = 'SCHEDULED') ou acontece antes ou encontra o leilão cancelado.
   * - Em andamento: os lances estão no Redis, então quem decide é um script atômico na sala
   *   ("sem lances e antes do término" -> CANCELLED). Um lance simultâneo ou entra antes (e o
   *   cancelamento é recusado) ou depois (e encontra a sala cancelada). Depois o Settlement
   *   grava o resultado no PostgreSQL.
   */
  static async cancel(id: string, userId: string) {
    const now = new Date();

    const wasRunning = await db.$transaction(async (tx) => {
      const auction = await lockOwnAuction(tx, id, userId);

      if (auction.status === AuctionStatus.RUNNING) return true;
      if (auction.status !== AuctionStatus.SCHEDULED || auction.endsAt <= now) {
        throw new Unprocessable('Só leilões agendados ou em andamento podem ser cancelados');
      }

      await tx.auction.update({ where: { id }, data: { status: AuctionStatus.CANCELLED } });
      return false;
    });

    if (wasRunning) {
      const result = await RoomState.cancel(id, now.getTime());
      if (result === 'HAS_BIDS') throw new Unprocessable('Leilões com lances não podem ser cancelados');
      if (result !== 'OK') {
        throw new Unprocessable('Só leilões agendados ou em andamento podem ser cancelados');
      }
      // Grava no PostgreSQL e avisa a sala.
      await Settlement.settle(id);
      return Auction.readById(id);
    }

    const auction = await Auction.readById(id);
    RoomEmitter.status(auction);
    return auction;
  }
}

export default Auction;
