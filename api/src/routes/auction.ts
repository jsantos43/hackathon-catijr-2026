import { Router } from 'express';
import Controller from '../controllers/Auction.js';
import auth from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { createAutctionSchema, auctionIdSchema, updateAuctionSchema } from '../schemas/Auction.js';

const router = Router();

router
  .get(
    '/auction/my',
    auth('logged'),
    Controller.readAll // Ler todos os leilões que usuário
  )
  .get(
    '/auction/history',
    auth('logged'),
    Controller.readAll // Ler todos os leilões que usuário
  )
  .get(
    '/auction/all',
    auth('logged'),
    Controller.readAll // Ler todos os leilões do sistema com req queries
  )
  .get(
    '/auction/:id',
    auth('logged'), // opcional
    validate(auctionIdSchema, 'params'), // Lê qualquer leilão do sistema
    Controller.readById
  )
  .post(
    '/auction',
    auth('logged'),
    validate(createAuctionSchema),
    Controller.create
  )
  .put(
    '/item/:id',
    auth('auction:own'),
    validate(auctionIdSchema, 'params'),
    validate(updateAuctionSchema),
    Controller.update,
  )
  .delete(
    '/item/:id',
    auth('auction:own'),
    validate(auctionIdSchema, 'params'),
    Controller.delete
  );

export default router;
