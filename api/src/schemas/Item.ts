import { z } from 'zod';
import { env } from '../config/env.js';
import { Category } from '../generated/prisma/enums.js';

// RF05: limites de texto (decisão da equipe).
export const ITEM_NAME_MAX = 80;
export const ITEM_DESCRIPTION_MAX = 2000;

const name = z.string().trim().min(3, 'O nome precisa ter pelo menos 3 caracteres').max(ITEM_NAME_MAX);
const description = z
  .string()
  .trim()
  .min(10, 'A descrição precisa ter pelo menos 10 caracteres')
  .max(ITEM_DESCRIPTION_MAX);
const category = z.enum(Category, 'Categoria inválida');

// Chega como multipart/form-data: os campos são texto e as fotos vêm em `images`.
export const createItemSchema = z.object({ name, description, category });

export type CreateItemData = z.infer<typeof createItemSchema>;

// Chega como texto no multipart: JSON com a ordem final das fotos (a primeira é a capa).
// Cada posição é uma foto atual (URL pública ou chave) ou "new:N" (N-ésima foto enviada agora).
const keepImages = z
  .string()
  .transform((v, ctx) => {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'keepImages precisa ser uma lista JSON' });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.string().min(1)).max(env.ITEM_MAX_PHOTOS));

// Todos opcionais. Fotos:
//   - sem keepImages: fotos enviadas substituem todas as atuais (sem fotos, nada muda);
//   - com keepImages: fotos finais = keepImages (nessa ordem) + fotos enviadas não citadas.
export const updateItemSchema = z.object({
  name: name.exactOptional(),
  description: description.exactOptional(),
  category: category.exactOptional(),
  keepImages: keepImages.exactOptional(),
});

export type UpdateItemData = z.infer<typeof updateItemSchema>;

export const itemIdSchema = z.object({
  id: z.uuid('Id inválido (UUID)'),
});

export type ItemIdParams = z.infer<typeof itemIdSchema>;
