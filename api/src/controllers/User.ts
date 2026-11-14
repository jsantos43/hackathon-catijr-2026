import type { NextFunction, Request, Response } from 'express';
import { Unauthorized } from '../errors/index.js';
import type { CreateUserData, UpdateUserData, UserIdParams } from '../schemas/User.js';
import Service from '../services/User.js';

class User {

  static readSelf(req: Request, res: Response, next: NextFunction) {
    if (!req.user) return next(new Unauthorized());

    return res.status(200).json({ success: true, user: req.user });
  }

  static async readById(req: Request<UserIdParams>, res: Response, next: NextFunction) {
    try {
      const user = await Service.readPublicById(req.params.id);

      return res.status(200).json({ success: true, user });
    } catch (err) {
      return next(err);
    }
  }

  static async create(
    req: Request<Record<string, string>, unknown, CreateUserData>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const user = await Service.create(req.body);

      return res.status(201).json({ success: true, user });
    } catch (err) {
      return next(err);
    }
  }

  static async update(
    req: Request<Record<string, string>, unknown, UpdateUserData>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) throw new Unauthorized();

      const user = await Service.update(req.user.id, req.body);

      return res.status(200).json({ success: true, user });
    } catch (err) {
      return next(err);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Unauthorized();

      const user = await Service.delete(req.user.id);

      return res.status(200).json({ success: true, user });
    } catch (err) {
      return next(err);
    }
  }

}

export default User;
