import { Router } from 'express';
import Controller from '../controllers/User.js';
import auth from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { createUserSchema, userIdSchema, updateUserSchema } from '../schemas/User.js';

const router = Router();

router
  .get(
    '/user',
    auth('logged'),
    Controller.readSelf
  )
  .get(
    '/user/:id',
    validate(userIdSchema, 'params'),
    Controller.readById
  )
  .post(
    '/user',
    validate(createUserSchema),
    Controller.create
  )
  .put(
    '/user',
    auth('logged'),
    validate(updateUserSchema),
    Controller.update,
  )
  .delete(
    '/user',
    auth('logged'),
    Controller.delete
  );

export default router;
