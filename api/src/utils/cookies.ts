import type { Request, Response } from 'express';
import { env } from '../config/env.js';

// O atributo `secure` depende do protocolo real da requisição (via `req.secure`, que respeita o
// `trust proxy` do Express), e não do NODE_ENV: em produção sobre HTTP o navegador recusaria um
// cookie `secure` e a sessão sumiria ao recarregar a página.
export const setAuthCookies = (
  req: Request,
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
) => {
  res.cookie('accessToken', tokens.accessToken, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    maxAge: env.accessTokenTtl * 1000,
  });

  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    path: '/auth',
    maxAge: env.refreshTokenTtl * 1000,
  });
};

export const clearAuthCookies = (req: Request, res: Response) => {
  res.clearCookie('accessToken', { secure: req.secure, sameSite: 'lax' });
  // Precisa do mesmo path usado ao criar, senão o navegador não remove o cookie.
  res.clearCookie('refreshToken', { path: '/auth', secure: req.secure, sameSite: 'lax' });
};
