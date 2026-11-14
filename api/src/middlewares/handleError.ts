import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import Base from '../errors/Base.js';
import Conflict from '../errors/Conflict.js';
import InvalidRequest from '../errors/InvalidRequest.js';
import Unprocessable from '../errors/Unprocessable.js';
import { isForeignKeyViolation, uniqueViolationField } from '../utils/dbErrors.js';

const handleError = (err: Error, req: Request, res: Response, next: NextFunction) => {
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

  const isAppError = err instanceof Base;

  if (!isAppError) {
    console.error(err);

    return new Base().send(res);
  }

  if (err.status === 500) console.error(err);

  return err.send(res);
};

export default handleError;
