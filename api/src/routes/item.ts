import { Router } from 'express';
import Controller from '../controllers/Item.js';
import auth from '../middlewares/auth.js';
import uploadImages from '../middlewares/uploadImages.js';
import validate from '../middlewares/validate.js';
import { createItemSchema, itemIdSchema, updateItemSchema } from '../schemas/Item.js';

const router = Router();

// Criar e editar item usam multipart/form-data: campos de texto + fotos no campo `images`.
// A posse do item é conferida no service (o middleware auth só sabe comparar com o id do usuário).
router
  .get(
    '/item/categories',
    Controller.categories // Lista pública das categorias aceitas
  )
  .get(
    '/item',
    auth('logged'),
    Controller.readItems // Ler todos os itens do próprio usuário
  )
  .get(
    '/item/:id',
    auth('logged'),
    validate(itemIdSchema, 'params'), // Lê um item do próprio usuário
    Controller.readById
  )
  .post(
    '/item',
    auth('logged'),
    uploadImages({ required: true }),
    validate(createItemSchema),
    Controller.create
  )
  .put(
    '/item/:id',
    auth('logged'),
    validate(itemIdSchema, 'params'),
    uploadImages({ required: false }), // Se mandar fotos, substituem todas as atuais
    validate(updateItemSchema),
    Controller.update,
  )
  .delete(
    '/item/:id',
    auth('logged'),
    validate(itemIdSchema, 'params'), // Só itens que nunca foram leiloados
    Controller.delete
  );

export default router;
