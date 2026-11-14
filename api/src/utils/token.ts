import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/** Token opaco (refresh token). Só o hash dele vai para o banco. */
export const generateRandomToken = () => randomBytes(32).toString('base64url');

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const refreshExpiresAt = () => new Date(Date.now() + env.refreshTokenTtl * 1000);
