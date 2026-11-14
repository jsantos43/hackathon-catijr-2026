import type { NextFunction, Request, Response } from 'express';
import { Unauthorized } from '../errors/index.js';
import type {
  AuctionIdParams,
  CreateAuctionData,
  ListAuctionsQuery,
  MyAuctionsQuery,
  UpdateAuctionData,
} from '../schemas/Auction.js';
import Service from '../services/Auction.js';

// O validate() já trocou req.query pelo resultado do zod (com defaults e tipos convertidos).
const queryOf = <T>(req: Request) => req.query as unknown as T;

// serverTime vai junto para o front sincronizar a contagem regressiva (RF16).
const serverTime = () => new Date().toISOString();

class Auction {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await Service.list(queryOf<ListAuctionsQuery>(req));

      return res.status(200).json({ success: true, ...result, serverTime: serverTime() });
    } catch (err) {
      return next(err);
    }
  }

  static async listOwn(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Unauthorized();

      const result = await Service.listOwn(req.user.id, queryOf<MyAuctionsQuery>(req));

      return res.status(200).json({ success: true, ...result, serverTime: serverTime() });
    } catch (err) {
      return next(err);
    }
  }

  static async listWon(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Unauthorized();

      const result = await Service.listWon(req.user.id, queryOf<MyAuctionsQuery>(req));

      return res.status(200).json({ success: true, ...result, serverTime: serverTime() });
    } catch (err) {
      return next(err);
    }
  }

  static async readById(req: Request<AuctionIdParams>, res: Response, next: NextFunction) {
    try {
      const auction = await Service.readById(req.params.id);

      return res.status(200).json({ success: true, auction, serverTime: serverTime() });
    } catch (err) {
      return next(err);
    }
  }

  static async create(
    req: Request<Record<string, string>, unknown, CreateAuctionData>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) throw new Unauthorized();

      const auction = await Service.create(req.user.id, req.body);

      return res.status(201).json({ success: true, auction, serverTime: serverTime() });
    } catch (err) {
      return next(err);
    }
  }

  static async update(
    req: Request<AuctionIdParams, unknown, UpdateAuctionData>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) throw new Unauthorized();

      const auction = await Service.update(req.params.id, req.user.id, req.body);

      return res.status(200).json({ success: true, auction, serverTime: serverTime() });
    } catch (err) {
      return next(err);
    }
  }

  static async cancel(req: Request<AuctionIdParams>, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Unauthorized();

      const auction = await Service.cancel(req.params.id, req.user.id);

      return res.status(200).json({ success: true, auction, serverTime: serverTime() });
    } catch (err) {
      return next(err);
    }
  }
}

export default Auction;
