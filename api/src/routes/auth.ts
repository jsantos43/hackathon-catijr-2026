import { Router } from 'express';
import { env } from '../config/env.js';
import Controller from '../controllers/Auth.js';
import Auth from '../middlewares/Auth.js';
import RateLimit from '../middlewares/RateLimit.js';
import Validate from '../middlewares/Validate.js';
import { loginSchema } from '../schemas/Auth.js';

const router = Router();

router
  .post(
    '/auth/login',
    RateLimit.byIp({
      scope: 'login',
      max: env.AUTH_RATE_LIMIT_MAX,
      windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    }),
    Validate.body(loginSchema),
    Controller.login
  )
  .post(
    '/auth/refresh',
    Controller.refresh // Usa o cookie refreshToken (path=/auth)
  )
  .post(
    '/auth/logout',
    Auth.require('logged'),
    Controller.logout
  );

export default router;
