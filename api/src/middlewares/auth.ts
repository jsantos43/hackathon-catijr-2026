import type { NextFunction, Request, Response } from 'express';
import { Forbidden } from '../errors/index.js';
import Service, { type Permission } from '../services/Auth.js';

const auth =
  (permission: Permission) =>
  async (req: Request<{ id?: string }>, res: Response, next: NextFunction) => {
    try {
      const { user, sessionVersion } = await Service.authenticate(req.cookies?.['accessToken']);

      req.user = user;
      req.sessionVersion = sessionVersion;

      const authorized = await Service.checkPermission(user, permission, req.params.id);
      if (!authorized) throw new Forbidden(`You need the "${permission}" permission`);

      return next();
    } catch (err) {
      return next(err);
    }
  };

export default auth;
