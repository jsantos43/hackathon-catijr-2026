import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { InvalidRequest } from '../errors/index.js';

type RequestProperty = 'body' | 'query' | 'params';

const validate =
  (schema: ZodType, property: RequestProperty = 'body') =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[property]);

    if (!result.success) {
      const details = result.error.issues.map((issue) =>
        issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
      );

      return next(new InvalidRequest(details));
    }

    Object.defineProperty(req, property, {
      value: result.data,
      writable: true,
      enumerable: true,
      configurable: true,
    });

    return next();
  };

export default validate;
