import { randomBytes } from 'node:crypto';
import { NotFound, Unprocessable } from '../errors/index.js';
import { AuctionStatus } from '../generated/prisma/enums.js';
import { db } from '../prisma/db.js';
import type { CreateUserData, SearchUsersQuery, UpdateUserData } from '../schemas/User.js';
import { isRecordNotFound } from '../utils/dbErrors.js';
import { hash } from '../utils/hash.js';
import { containsPattern } from '../utils/search.js';
import { privateUserSelect, publicUserSelect } from '../views/user.js';
import RoomState from './RoomState.js';
import SessionCache from './SessionCache.js';

const rethrowNotFound = (err: unknown): never => {
  if (isRecordNotFound(err)) throw new NotFound('Usuário não encontrado');
  throw err;
};

export const DELETED_USER_NAME = 'Conta excluída';

class User {
  static async readById(id: string) {
    const user = await db.user.findUnique({ where: { id }, select: privateUserSelect });

    if (!user) throw new NotFound('Usuário não encontrado');

    return user;
  }

  static async readPublicById(id: string) {
    const user = await db.user.findUnique({ where: { id }, select: publicUserSelect });

    if (!user) throw new NotFound('Usuário não encontrado');

    return user;
  }

  /**
   * RF22: busca comitentes (quem já anunciou pelo menos um leilão) por pedaço do nome de
   * exibição, ignorando maiúsculas e acentos. Os que mais anunciaram aparecem primeiro.
   */
  static async search({ q, limit }: SearchUsersQuery) {
    const pattern = containsPattern(q);

    return db.$queryRaw<{ id: string; name: string; createdAt: Date; auctionCount: number }[]>`
      SELECT u.id, u.name, u."createdAt", COUNT(a.id)::int AS "auctionCount"
        FROM "User" u
        JOIN "Auction" a ON a."ownerId" = u.id
       WHERE u."deletedAt" IS NULL
         AND unaccent(u.name) ILIKE unaccent(${pattern})
       GROUP BY u.id
       ORDER BY "auctionCount" DESC, u.name ASC
       LIMIT ${limit}`;
  }

  static async findActiveSession(id: string, sessionVersion: number) {
    return db.user.findFirst({
      where: { id, sessionVersion, deletedAt: null },
      select: privateUserSelect,
    });
  }

  static async create(data: CreateUserData) {
    const password = await hash(data.password);

    return db.user.create({ data: { ...data, password }, select: privateUserSelect });
  }

  static async update(id: string, data: UpdateUserData) {
    return db.user
      .update({ where: { id }, data, select: privateUserSelect })
      .catch(rethrowNotFound);
  }

  /**
   * Exclui a conta sem apagar o histórico: leilões, lances e vitórias continuam existindo
   * (RF08 diz que nada é apagado), mas a pessoa vira "Conta excluída", o e-mail fica livre
   * para um cadastro novo e todas as sessões caem.
   *
   * Bloqueado enquanto a pessoa tiver compromissos em aberto: leilão próprio Agendado ou
   * Em andamento (cancele antes) ou liderança num leilão Em andamento (o lance é irrevogável).
   */
  static async delete(id: string) {
    const deleted = await db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User" WHERE id = ${id}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
      if (!locked) throw new NotFound('Usuário não encontrado');

      const [openOwn, leading] = await Promise.all([
        tx.auction.count({
          where: {
            ownerId: id,
            status: { in: [AuctionStatus.SCHEDULED, AuctionStatus.RUNNING] },
          },
        }),
        // A liderança de uma disputa aberta só existe no Redis (ver RoomState).
        RoomState.isLeadingAny(id),
      ]);

      const blockers: string[] = [];
      if (openOwn) blockers.push('Você tem leilões agendados ou em andamento: cancele-os ou espere terminarem');
      if (leading) blockers.push('Você está liderando um leilão em andamento');
      if (blockers.length) throw new Unprocessable(blockers);

      const user = await tx.user.update({
        where: { id },
        data: {
          name: DELETED_USER_NAME,
          email: `excluida-${id}@arremate.invalid`,
          password: await hash(randomBytes(32).toString('hex')),
          sessionVersion: { increment: 1 },
          refreshTokenHash: null,
          refreshTokenExpires: null,
          deletedAt: new Date(),
        },
        select: privateUserSelect,
      });

      return user;
    });

    // Depois do COMMIT: um socket que ficou aberto não dá mais lance.
    await SessionCache.revoke(id);
    return deleted;
  }
}

export default User;
