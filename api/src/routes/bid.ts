import { Router } from 'express';
import Controller from '../controllers/Bid.js';
import Auth from '../middlewares/Auth.js';
import Validate from '../middlewares/Validate.js';
import { auctionIdSchema } from '../schemas/Auction.js';
import { listBidsSchema } from '../schemas/Bid.js';

const router = Router();

// Lances são DADOS pelo socket (evento auction:bid). Aqui ficam só as leituras.
// Este router é registrado ANTES do de leilões: senão /auction/participations cairia em
// /auction/:id e seria recusado por não ser um UUID.
router
  .get(
    '/auction/participations',
    Auth.require('logged'),
    Controller.participations // Leilões em que dei lance, com a minha situação (RF27)
  )
  .get(
    '/auction/:id/bids',
    Validate.params(auctionIdSchema),
    Validate.query(listBidsSchema),
    Controller.listByAuction // ?limit=20, mais recente primeiro
  );

export default router;
