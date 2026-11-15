import { Router } from 'express';
import Controller from '../controllers/Item.js';
import Auth from '../middlewares/Auth.js';
import Upload from '../middlewares/Upload.js';
import Validate from '../middlewares/Validate.js';
import { createItemSchema, itemIdSchema, updateItemSchema } from '../schemas/Item.js';

const router = Router();

// Criar e editar item usam multipart/form-data: campos de texto + fotos no campo `images`.
// A posse do item é conferida no service.
router
  .get(
    '/item/categories',
    Controller.categories // Lista pública das categorias aceitas
  )
  .get(
    '/item',
    Auth.require('logged'),
    Controller.readItems // Todos os itens do próprio usuário
  )
  .get(
    '/item/:id',
    Auth.require('logged'),
    Validate.params(itemIdSchema),
    Controller.readById // Um item do próprio usuário
  )
  .post(
    '/item',
    Auth.require('logged'),
    Upload.images({ required: true }),
    Validate.body(createItemSchema),
    Controller.create
  )
  .put(
    '/item/:id',
    Auth.require('logged'),
    Validate.params(itemIdSchema),
    Upload.images({ required: false }), // Fotos novas; keepImages diz quais atuais ficam (ver schema)
    Validate.body(updateItemSchema),
    Controller.update
  )
  .delete(
    '/item/:id',
    Auth.require('logged'),
    Validate.params(itemIdSchema),
    Controller.delete // Só itens que nunca foram leiloados
  );

export default router;
