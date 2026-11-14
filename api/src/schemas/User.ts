import { z } from 'zod';

// RF01: cadastro com nome de exibição, e-mail e senha. O e-mail é normalizado para que
// "Joao@X.com" e "joao@x.com" sejam a mesma conta.
export const createUserSchema = z.object({
  email: z.email('Email is not valid').trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  name: z.string().trim().min(1, 'Name is required').max(60),
});

export type CreateUserData = z.infer<typeof createUserSchema>;

export const userIdSchema = z.object({
  id: z.uuid('Id must be a valid UUID'),
});

export type UserIdParams = z.infer<typeof userIdSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(60).exactOptional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Send at least one field to update');

export type UpdateUserData = z.infer<typeof updateUserSchema>;
