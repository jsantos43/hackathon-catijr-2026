import type { NextFunction, Request, Response } from 'express';
import { Unauthorized } from '../errors/index.js';
import type { LoginData } from '../schemas/Auth.js';
import Service from '../services/Auth.js';
import { clearAuthCookies, setAuthCookies } from '../utils/cookies.js';

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
