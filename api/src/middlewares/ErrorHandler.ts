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
      const details =
        duplicatedField === 'email'
          ? 'Já existe uma conta com este e-mail'
          : duplicatedField
            ? `${duplicatedField} já está em uso`
            : [];
      return new Conflict(details).send(res);
    }

    if (isForeignKeyViolation(err)) {
      return new Unprocessable('Esse registro ainda está ligado a outros dados').send(res);
    }

    // Arquivo grande demais, fotos demais, campo de arquivo errado...
    if (err instanceof multer.MulterError) {
      return new InvalidRequest(`${err.field ? `${err.field}: ` : ''}${err.message}`).send(res);
    }

    // JSON malformado no corpo da requisição.
    if (err instanceof SyntaxError && 'body' in err) {
      return new InvalidRequest('O corpo da requisição não é um JSON válido').send(res);
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
