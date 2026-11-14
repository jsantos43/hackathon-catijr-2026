import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { Forbidden, NotFound, Unprocessable } from '../errors/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AuctionStatus } from '../generated/prisma/enums.js';
import { db } from '../prisma/db.js';
import type { CreateItemData, UpdateItemData } from '../schemas/Item.js';
import { deleteObjects, uploadItemImages } from '../utils/storage.js';
import { itemSelect, ownItemSelect, serializeItem, serializeOwnItem } from '../views/item.js';

type Tx = Prisma.TransactionClient;

/**
 * Trava as linhas dos itens até o fim da transação. Criar/editar leilão e editar item passam
 * por aqui, então requisições simultâneas que envolvem o mesmo item são processadas uma de cada
 * vez. A ordem fixa (ORDER BY id) evita deadlock entre dois lotes com itens em comum.
 */
export const lockOwnItems = async (tx: Tx, itemIds: string[], userId: string) => {
  const items = await tx.$queryRaw<{ id: string; ownerId: string }[]>`
    SELECT id, "ownerId" FROM "Item" WHERE id = ANY(${itemIds}::uuid[]) ORDER BY id FOR UPDATE`;

  const found = new Set(items.map((i) => i.id));
  const missing = itemIds.filter((id) => !found.has(id));
  if (missing.length) throw new NotFound(missing.map((id) => `Item ${id} not found`));

  if (items.some((i) => i.ownerId !== userId)) {
    throw new Forbidden('All items must belong to you');
  }

  return items;
};

/**
 * RF23: o item (nome, descrição, categoria, fotos) faz parte do anúncio. Ele só pode mudar
 * enquanto nenhum leilão dele estiver em andamento ou agendado para daqui a pouco.
 */
const assertItemEditable = async (tx: Tx, itemId: string) => {
  const lockFrom = new Date(Date.now() + env.AUCTION_EDIT_LOCK_SECONDS * 1000);

  const blocking = await tx.auction.findFirst({
    where: {
      items: { some: { itemId } },
      OR: [
        { status: AuctionStatus.RUNNING },
        { status: AuctionStatus.SCHEDULED, startsAt: { lte: lockFrom } },
      ],
    },
    select: { status: true },
  });

  if (blocking) {
    throw new Unprocessable(
      blocking.status === AuctionStatus.RUNNING
        ? 'The item is in a running auction; append text to the auction description instead'
        : `The item's auction starts in less than ${Math.round(env.AUCTION_EDIT_LOCK_SECONDS / 60)} minutes`,
    );
  }
};

class Item {
  static async readOwn(userId: string) {
    const items = await db.item.findMany({
      where: { ownerId: userId },
      select: ownItemSelect,
      orderBy: { createdAt: 'desc' },
    });

    return items.map(serializeOwnItem);
  }

  static async readOwnById(id: string, userId: string) {
    const item = await db.item.findUnique({ where: { id }, select: ownItemSelect });

    if (!item) throw new NotFound('Item not found');
    if (item.ownerId !== userId) throw new Forbidden('This item belongs to another user');

    return serializeOwnItem(item);
  }

  static async create(userId: string, data: CreateItemData, files: Express.Multer.File[]) {
    // O id é gerado aqui para as fotos já subirem na pasta do item.
    const id = randomUUID();
    const images = await uploadItemImages(id, files);

    try {
      const item = await db.item.create({
        data: { ...data, id, ownerId: userId, images },
        select: ownItemSelect,
      });

      return serializeOwnItem(item);
    } catch (err) {
      await deleteObjects(images);
      throw err;
    }
  }

  static async update(
    id: string,
    userId: string,
    data: UpdateItemData,
    files: Express.Multer.File[],
  ) {
    if (!files.length && !Object.keys(data).length) {
      throw new Unprocessable('Send at least one field or a new set of photos');
    }

    // Sobe as fotos novas antes da transação (rede lenta não deve segurar a trava do item).
    const newImages = files.length ? await uploadItemImages(id, files) : undefined;
    let oldImages: string[] = [];

    try {
      const item = await db.$transaction(async (tx) => {
        await lockOwnItems(tx, [id], userId);
        await assertItemEditable(tx, id);

        if (newImages) {
          const current = await tx.item.findUniqueOrThrow({ where: { id }, select: { images: true } });
          oldImages = current.images;
        }

        return tx.item.update({
          where: { id },
          data: { ...data, ...(newImages && { images: newImages }) },
          select: ownItemSelect,
        });
      });

      await deleteObjects(oldImages);

      return serializeOwnItem(item);
    } catch (err) {
      if (newImages) await deleteObjects(newImages);
      throw err;
    }
  }

  static async delete(id: string, userId: string) {
    const item = await db.$transaction(async (tx) => {
      await lockOwnItems(tx, [id], userId);

      // Leilões nunca são apagados (nem os cancelados, RF08), então um item que já foi
      // leiloado continua existindo para o histórico.
      const auctions = await tx.auctionItem.count({ where: { itemId: id } });
      if (auctions) throw new Unprocessable('Items that already had auctions cannot be deleted');

      return tx.item.delete({ where: { id }, select: itemSelect });
    });

    await deleteObjects(item.images);

    return serializeItem(item);
  }
}

export default Item;
