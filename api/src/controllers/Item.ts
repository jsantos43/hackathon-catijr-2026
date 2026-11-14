import type { NextFunction, Request, Response } from 'express';
import { Unauthorized } from '../errors/index.js';
import { Category } from '../generated/prisma/enums.js';
import type { CreateItemData, ItemIdParams, UpdateItemData } from '../schemas/Item.js';
import Service from '../services/Item.js';

const filesOf = (req: Request) => (req.files as Express.Multer.File[] | undefined) ?? [];

class Item {
  static categories(_req: Request, res: Response) {
    return res.status(200).json({ success: true, categories: Object.values(Category) });
  }

  static async readItems(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Unauthorized();

      const items = await Service.readOwn(req.user.id);

      return res.status(200).json({ success: true, items });
    } catch (err) {
      return next(err);
    }
  }

  static async readById(req: Request<ItemIdParams>, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Unauthorized();

      const item = await Service.readOwnById(req.params.id, req.user.id);

      return res.status(200).json({ success: true, item });
    } catch (err) {
      return next(err);
    }
  }

  static async create(
    req: Request<Record<string, string>, unknown, CreateItemData>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) throw new Unauthorized();

      const item = await Service.create(req.user.id, req.body, filesOf(req));

      return res.status(201).json({ success: true, item });
    } catch (err) {
      return next(err);
    }
  }

  static async update(
    req: Request<ItemIdParams, unknown, UpdateItemData>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) throw new Unauthorized();

      const item = await Service.update(req.params.id, req.user.id, req.body, filesOf(req));

      return res.status(200).json({ success: true, item });
    } catch (err) {
      return next(err);
    }
  }

  static async delete(req: Request<ItemIdParams>, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Unauthorized();

      const item = await Service.delete(req.params.id, req.user.id);

      return res.status(200).json({ success: true, item });
    } catch (err) {
      return next(err);
    }
  }
}

export default Item;
