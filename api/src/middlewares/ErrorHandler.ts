import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { Base, Conflict, InvalidRequest, NotFound, Unprocessable } from '../errors/index.js';
import { isForeignKeyViolation, uniqueViolationField } from '../utils/dbErrors.js';

/**
 * Os dois últimos middlewares da aplicação. Todo erro chega aqui e sai no formato padrão:
 *   { success: false, error: CODE, message, details: string[] }
 */
class ErrorHandler {
  /** Nenhuma rota respondeu. O front usa o texto "Route ..." para saber que a rota não existe. */
  static notFound(req: Request, _res: Response, next: NextFunction) {
    next(new NotFound(`Route ${req.method} ${req.path} not found`));
  }

  // O Express só reconhece um middleware de erro se ele tiver 4 parâmetros.
  static handle(err: Error, _req: Request, res: Response, _next: NextFunction) {
    const duplicatedField = uniqueViolationField(err);

    if (duplicatedField !== undefined) {
      const details = duplicatedField ? `${duplicatedField} is already in use` : [];
      return new Conflict(details).send(res);
    }

    if (isForeignKeyViolation(err)) {
      return new Unprocessable('This resource is still referenced by other records').send(res);
    }

    // Arquivo grande demais, fotos demais, campo de arquivo errado...
    if (err instanceof multer.MulterError) {
      return new InvalidRequest(`${err.field ? `${err.field}: ` : ''}${err.message}`).send(res);
    }

    // JSON malformado no corpo da requisição.
    if (err instanceof SyntaxError && 'body' in err) {
      return new InvalidRequest('Request body is not valid JSON').send(res);
    }

    if (!(err instanceof Base)) {
      console.error(err);
      return new Base().send(res);
    }

    if (err.status === 500) console.error(err);

    return err.send(res);
  }
}

export default ErrorHandler;
