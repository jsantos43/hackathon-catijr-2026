import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { Forbidden, NotFound, Unprocessable } from '../errors/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AuctionStatus } from '../generated/prisma/enums.js';
import { db } from '../prisma/db.js';
import type { CreateItemData, UpdateItemData } from '../schemas/Item.js';
import { deleteObjects, publicUrl, uploadItemImages } from '../utils/storage.js';
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
  if (missing.length) throw new NotFound(missing.map((id) => `Item ${id} não encontrado`));

  if (items.some((i) => i.ownerId !== userId)) {
    throw new Forbidden('Todos os itens precisam ser seus');
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
        ? 'O item está num leilão em andamento; acrescente texto à descrição do leilão'
        : `O leilão do item começa em menos de ${Math.round(env.AUCTION_EDIT_LOCK_SECONDS / 60)} minutos`,
    );
  }
};

/**
 * Monta a lista final de fotos a partir do keepImages do front, na ordem pedida:
 *   - URL pública ou chave de uma foto atual do item = mantém essa foto;
 *   - "new:N" = a N-ésima foto enviada agora (permite pôr uma foto nova como capa).
 * Fotos enviadas que não aparecem no keepImages vão para o fim. Recusa foto que não é do item
 * e referência repetida.
 */
const resolvePhotoOrder = (current: string[], keep: string[], uploaded: string[]) => {
  const byRef = new Map<string, string>();
  for (const key of current) {
    byRef.set(key, key);
    byRef.set(publicUrl(key), key);
  }

  const ordered = keep.map((ref) => {
    const match = /^new:(\d+)$/.exec(ref);
    const key = match ? uploaded[Number(match[1])] : byRef.get(ref);
    if (key === undefined) throw new Unprocessable('keepImages tem uma foto que não é deste item');
    return key;
  });
  if (new Set(ordered).size !== ordered.length) {
    throw new Unprocessable('keepImages repete uma foto');
  }
  return [...ordered, ...uploaded.filter((key) => !ordered.includes(key))];
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

    if (!item) throw new NotFound('Item não encontrado');
    if (item.ownerId !== userId) throw new Forbidden('Esse item é de outra pessoa');

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
    { keepImages, ...data }: UpdateItemData,
    files: Express.Multer.File[],
  ) {
    if (!files.length && !keepImages && !Object.keys(data).length) {
      throw new Unprocessable('Envie pelo menos um campo ou novas fotos');
    }

    // Sobe as fotos novas antes da transação (disco/rede lenta não deve segurar a trava do item).
    const uploaded = files.length ? await uploadItemImages(id, files) : [];
    let removed: string[] = [];

    try {
      const item = await db.$transaction(async (tx) => {
        await lockOwnItems(tx, [id], userId);
        await assertItemEditable(tx, id);

        const touchesPhotos = keepImages !== undefined || uploaded.length > 0;
        let images: string[] | undefined;

        if (touchesPhotos) {
          const current = await tx.item.findUniqueOrThrow({ where: { id }, select: { images: true } });
          images = keepImages ? resolvePhotoOrder(current.images, keepImages, uploaded) : uploaded;

          if (images.length < env.ITEM_MIN_PHOTOS || images.length > env.ITEM_MAX_PHOTOS) {
            throw new Unprocessable(
              `O item precisa ter de ${env.ITEM_MIN_PHOTOS} a ${env.ITEM_MAX_PHOTOS} fotos (ficaria com ${images.length})`,
            );
          }
          const final = images;
          removed = current.images.filter((key) => !final.includes(key));
        }

        return tx.item.update({
          where: { id },
          data: { ...data, ...(images && { images }) },
          select: ownItemSelect,
        });
      });

      await deleteObjects(removed);

      return serializeOwnItem(item);
    } catch (err) {
      await deleteObjects(uploaded);
      throw err;
    }
  }

  static async delete(id: string, userId: string) {
    const item = await db.$transaction(async (tx) => {
      await lockOwnItems(tx, [id], userId);

      // Leilões nunca são apagados (nem os cancelados, RF08), então um item que já foi
      // leiloado continua existindo para o histórico.
      const auctions = await tx.auctionItem.count({ where: { itemId: id } });
      if (auctions) throw new Unprocessable('Itens que já foram leiloados não podem ser excluídos');

      return tx.item.delete({ where: { id }, select: itemSelect });
    });

    await deleteObjects(item.images);

    return serializeItem(item);
  }
}

export default Item;
