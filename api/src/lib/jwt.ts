import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";

const tokenPayloadSchema = z.object({
  sub: z.uuid(),
  name: z.string(),
});

export type TokenPayload = z.infer<typeof tokenPayloadSchema>;

export function signToken(payload: TokenPayload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

/** Lança erro se o token for inválido ou estiver expirado. */
export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  return tokenPayloadSchema.parse(decoded);
}
