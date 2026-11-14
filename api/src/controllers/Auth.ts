import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { Unauthorized } from '../errors/index.js';
import type { LoginData } from '../schemas/Auth.js';
import Service from '../services/Auth.js';

// O atributo `secure` depende do protocolo real da requisição (via `req.secure`, que respeita o
// `trust proxy` do Express), e não do NODE_ENV: em produção sobre HTTP o navegador recusaria um
// cookie `secure` e a sessão sumiria ao recarregar a página.
const setAuthCookies = (
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

const clearAuthCookies = (req: Request, res: Response) => {
  res.clearCookie('accessToken', { secure: req.secure, sameSite: 'lax' });
  // Precisa do mesmo path usado ao criar, senão o navegador não remove o cookie.
  res.clearCookie('refreshToken', { path: '/auth', secure: req.secure, sameSite: 'lax' });
};

class Auth {
  static async login(
    req: Request<Record<string, string>, unknown, LoginData>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { user, accessToken, refreshToken } = await Service.login(
        req.body.email,
        req.body.password,
      );

      setAuthCookies(req, res, { accessToken, refreshToken });

      return res.status(200).json({ success: true, user });
    } catch (err) {
      return next(err);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const tokens = await Service.refresh(req.cookies?.['refreshToken']);

      setAuthCookies(req, res, tokens);

      return res.status(200).json({ success: true });
    } catch (err) {
      clearAuthCookies(req, res);
      return next(err);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user || req.sessionVersion === undefined) throw new Unauthorized();

      await Service.logout(req.user.id, req.sessionVersion);
      clearAuthCookies(req, res);

      return res.status(200).json({ success: true });
    } catch (err) {
      return next(err);
    }
  }
}

export default Auth;
