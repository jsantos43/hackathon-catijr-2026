import type { Express, Request, Response } from 'express';
import { db } from '../prisma/db.js';
import { redis } from '../redis/client.js';
import auction from './auction.js';
import auth from './auth.js';
import bid from './bid.js';
import item from './item.js';
import user from './user.js';

const routes = (app: Express) => {
  // Horário do servidor (o relógio que vale é o do servidor, RF16).
  app.get('/', (_req: Request, res: Response) => {
    res.json({ success: true, name: 'Arremate API', serverTime: new Date().toISOString() });
  });

  // Health check para o deploy: confere banco e Redis.
  app.get('/health', async (_req: Request, res: Response) => {
    const [database, cache] = await Promise.allSettled([db.$queryRaw`SELECT 1`, redis.ping()]);
    const ok = database.status === 'fulfilled' && cache.status === 'fulfilled';

    res.status(ok ? 200 : 503).json({
      success: ok,
      database: database.status === 'fulfilled' ? 'up' : 'down',
      redis: cache.status === 'fulfilled' ? 'up' : 'down',
      serverTime: new Date().toISOString(),
    });
  });

  // `bid` antes de `auction` (ver routes/bid.ts).
  app.use(user, auth, item, bid, auction);
};

export default routes;
