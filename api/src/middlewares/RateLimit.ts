import type { NextFunction, Request, Response } from 'express';
import { TooManyRequests } from '../errors/index.js';
import { redis } from '../redis/client.js';
import { RedisKeys } from '../redis/keys.js';

type RateLimitOptions = {
  /** Nome do contador (ex.: "login"). Cada escopo conta separado. */
  scope: string;
  /** Quantas requisições cada IP pode fazer na janela. */
  max: number;
  windowSeconds: number;
};

/**
 * Rate limit simples por IP com janela fixa no Redis: INCR no contador e, na primeira
 * requisição da janela, EXPIRE. Como o contador está no Redis, vale para todas as instâncias.
 *
 *   router.post('/auth/login', RateLimit.byIp({ scope: 'login', max: 20, windowSeconds: 60 }), ...)
 */
class RateLimit {
  static byIp({ scope, max, windowSeconds }: RateLimitOptions) {
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = RedisKeys.rateLimit(scope, req.ip ?? 'unknown');

      try {
        const [[, count], [, ttl]] = (await redis
          .multi()
          .incr(key)
          .ttl(key)
          .exec()) as [[null, number], [null, number]];

        // Sem expiração ainda (-1): é a primeira requisição da janela.
        if (ttl < 0) await redis.expire(key, windowSeconds);

        if (count > max) {
          const retryAfter = ttl > 0 ? ttl : windowSeconds;
          res.setHeader('Retry-After', String(retryAfter));
          return next(new TooManyRequests(`Tente de novo em ${retryAfter} segundos`));
        }
      } catch (err) {
        // Se o Redis estiver fora, não bloqueia o login de ninguém.
        console.error('Rate limit indisponível', err);
      }

      return next();
    };
  }
}

export default RateLimit;
