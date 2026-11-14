import { Router } from 'express';
import Controller from '../controllers/Auth.js';
import auth from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { loginSchema } from '../schemas/Auth.js';

const router = Router();

router
  .post('/auth/login', validate(loginSchema), Controller.login)
  .post('/auth/refresh', Controller.refresh)
  .post('/auth/logout', auth('logged'), Controller.logout);

export default router;
