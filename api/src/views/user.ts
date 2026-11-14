import type { Prisma } from '../generated/prisma/client.js';

// Dados do próprio usuário (nunca inclui senha nem tokens).
export const privateUserSelect = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

// Dados que qualquer pessoa pode ver de outro usuário (sem e-mail).
export const publicUserSelect = {
  id: true,
  name: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;
