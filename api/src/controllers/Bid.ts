import type { NextFunction, Request, Response } from 'express';
import { Unauthorized } from '../errors/index.js';
import type { AuctionIdParams } from '../schemas/Auction.js';
import type { ListBidsQuery } from '../schemas/Bid.js';
import Service from '../services/Bid.js';

class Bid {
  static async listByAuction(req: Request<AuctionIdParams>, res: Response, next: NextFunction) {
    try {
      const { limit } = req.query as unknown as ListBidsQuery;

      const bids = await Service.listByAuction(req.params.id, limit);

      return res.status(200).json({ success: true, bids, serverTime: new Date().toISOString() });
    } catch (err) {
      return next(err);
    }
  }

  static async participations(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new Unauthorized();

      const participations = await Service.listParticipations(req.user.id);

      return res
        .status(200)
        .json({ success: true, participations, serverTime: new Date().toISOString() });
    } catch (err) {
      return next(err);
    }
  }
}

export default Bid;
