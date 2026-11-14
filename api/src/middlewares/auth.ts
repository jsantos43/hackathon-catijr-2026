import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../errors/app-error.js";
import { verifyToken, type TokenPayload } from "../lib/jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function extractBearer(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearer(req.headers.authorization);
  if (!token) throw new UnauthorizedError("Token não informado");

  try {
    req.user = verifyToken(token);
  } catch {
    throw new UnauthorizedError();
  }

  next();
}
