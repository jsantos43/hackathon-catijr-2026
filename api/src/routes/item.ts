import { Router } from 'express';
import Controller from '../controllers/Item.js';
import auth from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { createItemSchema, itemIdSchema, updateItemSchema } from '../schemas/Item.js';

const router = Router();

router
  .get(
    '/item',
    auth('logged'),
    Controller.readItems // Ler todos os itens do próprio usuário
  )
  .get(
    '/item/:id',
    auth('logged'),
    validate(itemIdSchema, 'params'), // Lê um item próprio usuário
    Controller.readById
  )
  .post(
    '/item',
    auth('logged'),
    validate(createItemSchema),
    Controller.create
  )
  .put(
    '/item/:id',
    auth('logged'),
    validate(itemIdSchema, 'params'),
    validate(updateItemSchema),
    Controller.update,
  )
  .delete(
    '/item/:id',
    auth('logged'),
    validate(itemIdSchema, 'params'),
    Controller.delete
  );

export default router;
