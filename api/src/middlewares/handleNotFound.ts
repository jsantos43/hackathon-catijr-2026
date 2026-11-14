import type { NextFunction, Request, Response } from 'express';
import { NotFound } from '../errors/index.js';

const handleNotFound = (req: Request, res: Response, next: NextFunction) =>
  next(new NotFound(`Route ${req.method} ${req.path} not found`));

export default handleNotFound;
