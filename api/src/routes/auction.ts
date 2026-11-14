import { Router } from 'express';
import Controller from '../controllers/Auction.js';
import auth from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
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
router
  .get(
    '/auction/my',
    auth('logged'),
    validate(myAuctionsSchema, 'query'),
    Controller.listOwn // Leilões que o usuário criou
  )
  .get(
    '/auction/history',
    auth('logged'),
    validate(myAuctionsSchema, 'query'),
    Controller.listWon // Leilões que o usuário venceu
  )
  .get(
    '/auction/all',
    validate(listAuctionsSchema, 'query'),
    Controller.list // ?q=&category=ART,HOME&status=RUNNING&ownerId=&page=&pageSize=
  )
  .get(
    '/auction/:id',
    validate(auctionIdSchema, 'params'),
    Controller.readById
  )
  .post(
    '/auction',
    auth('logged'),
    validate(createAuctionSchema),
    Controller.create // Também serve para relistar um item (RF28)
  )
  .put(
    '/auction/:id',
    auth('logged'),
    validate(auctionIdSchema, 'params'),
    validate(updateAuctionSchema),
    Controller.update,
  )
  .delete(
    '/auction/:id',
    auth('logged'),
    validate(auctionIdSchema, 'params'),
    Controller.cancel // Não apaga: marca como Cancelado (RF08)
  );

export default router;
