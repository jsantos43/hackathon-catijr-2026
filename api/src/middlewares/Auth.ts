import type { NextFunction, Request, Response } from 'express';
import { Forbidden } from '../errors/index.js';
import Service, { type Permission } from '../services/Auth.js';

/**
 * Exige sessão válida (cookie httpOnly `accessToken`) e preenche `req.user`.
 *
 *   router.get('/item', Auth.require('logged'), Controller.readItems)
 */
class Auth {
  static require(permission: Permission) {
    return async (req: Request<{ id?: string }>, _res: Response, next: NextFunction) => {
      try {
        const { user, sessionVersion } = await Service.authenticate(req.cookies?.['accessToken']);

        req.user = user;
        req.sessionVersion = sessionVersion;

        const authorized = Service.checkPermission(user, permission, req.params.id);
        if (!authorized) throw new Forbidden(`Você precisa da permissão "${permission}"`);

        return next();
      } catch (err) {
        return next(err);
      }
    };
  }
}

export default Auth;
