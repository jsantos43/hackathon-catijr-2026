import type { Response } from 'express';
import { env } from '../config/env.js';

export const setAuthCookies = (res: Response, tokens: { accessToken: string; refreshToken: string }) => {
  res.cookie('accessToken', tokens.accessToken, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    maxAge: env.accessTokenTtl * 1000,
  });

  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    path: '/auth',
    maxAge: env.refreshTokenTtl * 1000,
  });
};

export const clearAuthCookies = (res: Response) => {
  res.clearCookie('accessToken');
  // Precisa do mesmo path usado ao criar, senão o navegador não remove o cookie.
  res.clearCookie('refreshToken', { path: '/auth' });
};
