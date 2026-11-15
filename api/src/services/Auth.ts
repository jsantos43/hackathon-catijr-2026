import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Unauthorized } from '../errors/index.js';
import { db } from '../prisma/db.js';
import { accessTokenPayloadSchema, type AccessTokenPayload } from '../schemas/Auth.js';
import type { AuthUser } from '../types/express.js';
import { compareHash, hash } from '../utils/hash.js';
import { generateRandomToken, hashToken, refreshExpiresAt } from '../utils/token.js';
import User from './User.js';

// Não existe administrador (RF03): só "logado" e "o próprio usuário".
export type Permission = 'logged' | 'self';

// Usado quando o e-mail não existe, para o login levar o mesmo tempo nos dois casos.
const DUMMY_HASH = await hash(generateRandomToken());

class Auth {
  static generateAccessToken(userId: string, sessionVersion: number) {
    const payload: AccessTokenPayload = { sub: userId, sv: sessionVersion };

    return jwt.sign(payload, env.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: env.accessTokenTtl,
    });
  }

  static verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });

      return accessTokenPayloadSchema.parse(payload);
    } catch {
      throw new Unauthorized('Sessão inválida ou expirada');
    }
  }

  static async login(email: string, password: string) {
    const user = await db.user.findUnique({ where: { email } });

    const passwordMatches = await compareHash(password, user?.password || DUMMY_HASH);

    if (!user || !passwordMatches) throw new Unauthorized('E-mail ou senha inválidos');

    const refreshToken = generateRandomToken();

    const { count } = await db.user.updateMany({
      where: { id: user.id, sessionVersion: user.sessionVersion },
      data: {
        refreshTokenHash: hashToken(refreshToken),
        refreshTokenExpires: refreshExpiresAt(),
      },
    });

    if (!count) throw new Unauthorized('Sua sessão mudou, entre de novo');

    return {
      user: await User.readById(user.id),
      accessToken: Auth.generateAccessToken(user.id, user.sessionVersion),
      refreshToken,
    };
  }

  static async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw new Unauthorized('Sessão expirada, entre de novo');

    const tokenHash = hashToken(refreshToken);
    const user = await db.user.findUnique({ where: { refreshTokenHash: tokenHash } });

    if (!user?.refreshTokenExpires || user.refreshTokenExpires <= new Date()) {
      throw new Unauthorized('Sessão expirada, entre de novo');
    }

    // Rotação: o refresh token antigo deixa de valer. O where com o hash antigo garante que
    // duas chamadas simultâneas com o mesmo token não gerem duas sessões.
    const newRefreshToken = generateRandomToken();
    const { count } = await db.user.updateMany({
      where: { id: user.id, refreshTokenHash: tokenHash },
      data: {
        refreshTokenHash: hashToken(newRefreshToken),
        refreshTokenExpires: refreshExpiresAt(),
      },
    });

    if (!count) throw new Unauthorized('Sessão expirada, entre de novo');

    return {
      accessToken: Auth.generateAccessToken(user.id, user.sessionVersion),
      refreshToken: newRefreshToken,
    };
  }

  static async logout(userId: string, sessionVersion: number) {
    await db.user.updateMany({
      where: { id: userId, sessionVersion },
      data: {
        sessionVersion: { increment: 1 },
        refreshTokenHash: null,
        refreshTokenExpires: null,
      },
    });
  }

  static async authenticate(token: string | undefined): Promise<{
    user: AuthUser;
    sessionVersion: number;
  }> {
    if (!token) throw new Unauthorized('Você precisa entrar na sua conta');

    const { sub, sv } = Auth.verifyAccessToken(token);

    const user = await User.findActiveSession(sub, sv);
    if (!user) throw new Unauthorized('Sua sessão não é mais válida, entre de novo');

    return { user, sessionVersion: sv };
  }

  static checkPermission(user: AuthUser, permission: Permission, id?: string) {
    switch (permission) {
      case 'logged':
        return true;
      case 'self':
        return id === user.id;
    }
  }
}

export default Auth;
