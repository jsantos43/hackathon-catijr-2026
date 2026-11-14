import { NotFound } from '../errors/index.js';
import { db } from '../prisma/db.js';
import type { CreateUserData, UpdateUserData } from '../schemas/User.js';
import { isRecordNotFound } from '../utils/dbErrors.js';
import { hash } from '../utils/hash.js';
import { privateUserSelect, publicUserSelect } from '../views/user.js';

const rethrowNotFound = (err: unknown): never => {
  if (isRecordNotFound(err)) throw new NotFound('User not found');
  throw err;
};

class User {
  static async readById(id: string) {
    const user = await db.user.findUnique({ where: { id }, select: privateUserSelect });

    if (!user) throw new NotFound('User not found');

    return user;
  }

  static async readPublicById(id: string) {
    const user = await db.user.findUnique({ where: { id }, select: publicUserSelect });

    if (!user) throw new NotFound('User not found');

    return user;
  }

  static async findActiveSession(id: string, sessionVersion: number) {
    return db.user.findFirst({ where: { id, sessionVersion }, select: privateUserSelect });
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

  static async delete(id: string) {
    return db.user.delete({ where: { id }, select: privateUserSelect }).catch(rethrowNotFound);
  }
}

export default User;
