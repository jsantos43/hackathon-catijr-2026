import { z } from 'zod';

// RF01: cadastro com nome de exibição, e-mail e senha. O e-mail é normalizado para que
// "Joao@X.com" e "joao@x.com" sejam a mesma conta.
export const createUserSchema = z.object({
  email: z.email('E-mail inválido').trim().toLowerCase(),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(72),
  name: z.string().trim().min(1, 'Informe o nome').max(60),
});

export type CreateUserData = z.infer<typeof createUserSchema>;

export const userIdSchema = z.object({
  id: z.uuid('Id inválido (UUID)'),
});

export type UserIdParams = z.infer<typeof userIdSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome').max(60).exactOptional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Envie pelo menos um campo para alterar');

export type UpdateUserData = z.infer<typeof updateUserSchema>;

// RF22: busca de comitentes pelo nome de exibição.
export const searchUsersSchema = z.object({
  q: z.string().trim().min(1, 'Digite um nome para buscar').max(60),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchUsersQuery = z.infer<typeof searchUsersSchema>;
