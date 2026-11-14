import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { Unauthorized } from '../errors/index.js';
import type { LoginData } from '../schemas/Auth.js';
import Service from '../services/Auth.js';

const setAuthCookies = (res: Response, tokens: { accessToken: string; refreshToken: string }) => {
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

const clearAuthCookies = (res: Response) => {
  res.clearCookie('accessToken');
  // Precisa do mesmo path usado ao criar, senão o navegador não remove o cookie.
  res.clearCookie('refreshToken', { path: '/auth' });
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

      setAuthCookies(res, { accessToken, refreshToken });

      return res.status(200).json({ success: true, user });
    } catch (err) {
      return next(err);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const tokens = await Service.refresh(req.cookies?.['refreshToken']);

      setAuthCookies(res, tokens);

      return res.status(200).json({ success: true });
    } catch (err) {
      clearAuthCookies(res);
      return next(err);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user || req.sessionVersion === undefined) throw new Unauthorized();

      await Service.logout(req.user.id, req.sessionVersion);
      clearAuthCookies(res);

      return res.status(200).json({ success: true });
    } catch (err) {
      return next(err);
    }
  }
}

export default Auth;
