import { Router } from 'express';
import Controller from '../controllers/Auction.js';
import Auth from '../middlewares/Auth.js';
import Validate from '../middlewares/Validate.js';
import {
  auctionIdSchema,
  createAuctionSchema,
  listAuctionsSchema,
  myAuctionsSchema,
  updateAuctionSchema,
} from '../schemas/Auction.js';

const router = Router();

// RF04: listagens e detalhe são públicos; entrar na sala (socket) é que exige login.
// A posse do leilão é conferida no service.
// Atenção à ordem: rotas fixas (/auction/my, /auction/all...) antes de /auction/:id.
router
  .get(
    '/auction/my',
    Auth.require('logged'),
    Validate.query(myAuctionsSchema),
    Controller.listOwn // Leilões que o usuário criou
  )
  .get(
    '/auction/history',
    Auth.require('logged'),
    Validate.query(myAuctionsSchema),
    Controller.listWon // Leilões que o usuário venceu
  )
  .get(
    '/auction/all',
    Validate.query(listAuctionsSchema),
    Controller.list // ?q=&category=ART,HOME&status=RUNNING&ownerId=&sort=ends&page=&pageSize=
  )
  .get(
    '/auction/:id',
    Validate.params(auctionIdSchema),
    Controller.readById
  )
  .post(
    '/auction',
    Auth.require('logged'),
    Validate.body(createAuctionSchema),
    Controller.create // Também serve para relistar um item (RF28)
  )
  .put(
    '/auction/:id',
    Auth.require('logged'),
    Validate.params(auctionIdSchema),
    Validate.body(updateAuctionSchema),
    Controller.update
  )
  .delete(
    '/auction/:id',
    Auth.require('logged'),
    Validate.params(auctionIdSchema),
    Controller.cancel // Não apaga: marca como Cancelado (RF08)
  );

export default router;
