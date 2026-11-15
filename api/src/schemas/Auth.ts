import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('E-mail inválido').trim().toLowerCase(),
  password: z.string().min(1, 'Informe a senha'),
});

export type LoginData = z.infer<typeof loginSchema>;

export const accessTokenPayloadSchema = z.object({
  sub: z.uuid(),
  sv: z.number().int().nonnegative(),
});

export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;
