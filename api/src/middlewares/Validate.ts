import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { InvalidRequest } from '../errors/index.js';

type RequestProperty = 'body' | 'query' | 'params';

/**
 * Valida (e converte) uma parte da requisição com um schema do zod. Depois daqui, o
 * controller recebe os dados já no formato certo (números convertidos, defaults aplicados...).
 *
 *   router.get('/auction/:id', Validate.params(auctionIdSchema), Controller.readById)
 */
class Validate {
  static body(schema: ZodType) {
    return Validate.on('body', schema);
  }

  static query(schema: ZodType) {
    return Validate.on('query', schema);
  }

  static params(schema: ZodType) {
    return Validate.on('params', schema);
  }

  private static on(property: RequestProperty, schema: ZodType) {
    return (req: Request, _res: Response, next: NextFunction) => {
      const result = schema.safeParse(req[property]);

      if (!result.success) {
        const details = result.error.issues.map((issue) =>
          issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
        );

        return next(new InvalidRequest(details));
      }

      // No Express 5, req.query é só leitura; defineProperty troca o valor mesmo assim.
      Object.defineProperty(req, property, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      return next();
    };
  }
}

export default Validate;
