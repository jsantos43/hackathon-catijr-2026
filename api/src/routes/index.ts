import type { Express, Request, Response } from 'express';
import auction from './auction.js';
import auth from './auth.js';
import item from './item.js';
import user from './user.js';

const routes = (app: Express) => {
  // Health check + horário do servidor (o relógio que vale é o do servidor, RF16).
  app.get('/', (_req: Request, res: Response) => {
    res.json({ mensagem: 'Olá, mundo!', serverTime: new Date().toISOString() });
  });

  app.use(user, auth, item, auction);
};

export default routes;
