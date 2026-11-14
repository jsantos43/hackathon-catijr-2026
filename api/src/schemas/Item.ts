import { z } from 'zod';
import { Category } from '../generated/prisma/enums.js';

// RF05: limites de texto (decisão da equipe).
export const ITEM_NAME_MAX = 80;
export const ITEM_DESCRIPTION_MAX = 2000;

const name = z.string().trim().min(3, 'Name must be at least 3 characters').max(ITEM_NAME_MAX);
const description = z
  .string()
  .trim()
  .min(10, 'Description must be at least 10 characters')
  .max(ITEM_DESCRIPTION_MAX);
const category = z.enum(Category, 'Category is not valid');

// Chega como multipart/form-data: os campos são texto e as fotos vêm em `images`.
export const createItemSchema = z.object({ name, description, category });

export type CreateItemData = z.infer<typeof createItemSchema>;

// Todos opcionais; as fotos (se enviadas) substituem as atuais.
export const updateItemSchema = z.object({
  name: name.exactOptional(),
  description: description.exactOptional(),
  category: category.exactOptional(),
});

export type UpdateItemData = z.infer<typeof updateItemSchema>;

export const itemIdSchema = z.object({
  id: z.uuid('Id must be a valid UUID'),
});

export type ItemIdParams = z.infer<typeof itemIdSchema>;
