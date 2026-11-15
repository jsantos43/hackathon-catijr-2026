import { Router } from 'express';
import { env } from '../config/env.js';
import Controller from '../controllers/User.js';
import Auth from '../middlewares/Auth.js';
import RateLimit from '../middlewares/RateLimit.js';
import Validate from '../middlewares/Validate.js';
import { createUserSchema, searchUsersSchema, updateUserSchema, userIdSchema } from '../schemas/User.js';

const router = Router();

router
  .get(
    '/user',
    Auth.require('logged'),
    Controller.readSelf // Dados da própria conta (com e-mail)
  )
  .get(
    '/user/search',
    Validate.query(searchUsersSchema),
    Controller.search // RF22: comitentes por nome (público). Antes de /user/:id.
  )
  .get(
    '/user/:id',
    Validate.params(userIdSchema),
    Controller.readById // Perfil público (sem e-mail)
  )
  .post(
    '/user',
    RateLimit.byIp({
      scope: 'signup',
      max: env.AUTH_RATE_LIMIT_MAX,
      windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    }),
    Validate.body(createUserSchema),
    Controller.create
  )
  .put(
    '/user',
    Auth.require('logged'),
    Validate.body(updateUserSchema),
    Controller.update
  )
  .delete(
    '/user',
    Auth.require('logged'),
    Controller.delete // Anonimiza a conta (histórico de leilões e lances é mantido)
  );

export default router;
