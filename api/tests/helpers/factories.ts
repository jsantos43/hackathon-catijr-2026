import { randomUUID } from 'node:crypto';
import { AuctionStatus } from '../../src/generated/prisma/enums.js';
import { db } from '../../src/prisma/db.js';
import { redis } from '../../src/redis/client.js';
import Auth from '../../src/services/Auth.js';
import RoomState from '../../src/services/RoomState.js';
import User from '../../src/services/User.js';

export const PASSWORD = 'senha-segura-123';

/** Apaga tudo do banco de testes e do Redis de testes. Chame no beforeEach. */
export const resetState = async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "Bid", "AuctionItem", "Auction", "Item", "User" RESTART IDENTITY CASCADE',
  );
  await redis.flushdb();
};

let seq = 0;

export const createUser = async (name?: string) => {
  seq += 1;
  return User.create({
    name: name ?? `Pessoa${seq} Sobrenome${seq}`,
    email: `pessoa${seq}-${randomUUID().slice(0, 8)}@teste.com`,
    password: PASSWORD,
  });
};

/** Cookie de sessão pronto (sem passar pelo login, para os testes ficarem rápidos). */
export const sessionCookie = (userId: string, sessionVersion = 0) =>
  `accessToken=${Auth.generateAccessToken(userId, sessionVersion)}`;

export const createItem = (ownerId: string, name = 'Relógio de bolso antigo') =>
  db.item.create({
    data: {
      ownerId,
      name,
      description: 'Item em ótimo estado, funcionando.',
      category: 'COLLECTIBLES',
      images: ['items/a.png', 'items/b.png', 'items/c.png'],
    },
  });

const minutes = (n: number) => n * 60 * 1000;

type AuctionOverrides = {
  status?: AuctionStatus;
  startingPriceCents?: number;
  startsAt?: Date;
  endsAt?: Date;
  originalEndsAt?: Date;
  title?: string;
};

/**
 * Cria um leilão direto no banco (sem as validações de antecedência da rota), com um item.
 * Padrão: Em andamento desde 1 min atrás, terminando em 10 min, preço inicial R$ 100,00.
 */
export const createAuction = async (ownerId: string, overrides: AuctionOverrides = {}) => {
  const item = await createItem(ownerId);
  const now = Date.now();
  const endsAt = overrides.endsAt ?? new Date(now + minutes(10));

  return db.auction.create({
    data: {
      ownerId,
      title: overrides.title ?? 'Leilão de teste',
      description: '',
      status: overrides.status ?? AuctionStatus.RUNNING,
      startingPriceCents: overrides.startingPriceCents ?? 10_000,
      startsAt: overrides.startsAt ?? new Date(now - minutes(1)),
      originalEndsAt: overrides.originalEndsAt ?? endsAt,
      endsAt,
      items: { create: [{ itemId: item.id, position: 0 }] },
    },
  });
};

/** Leilão Em andamento com o estado da sala já no Redis, como o job deixaria. */
export const createRunningAuction = async (ownerId: string, overrides: AuctionOverrides = {}) => {
  const auction = await createAuction(ownerId, { ...overrides, status: AuctionStatus.RUNNING });
  await RoomState.open(auction);
  return auction;
};

export const newKey = () => randomUUID();
