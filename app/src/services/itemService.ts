import type { Category, OwnItem } from '../types';
import api from './api';

export interface ItemFields {
  name: string;
  description: string;
  category: Category;
}

const toForm = (fields: Partial<ItemFields>, photos: File[]) => {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => v !== undefined && form.append(k, v));
  photos.forEach((p) => form.append('images', p));
  return form;
};

export const itemService = {
  async categories(): Promise<Category[]> {
    const { data } = await api.get<{ categories: Category[] }>('/item/categories');
    return data.categories;
  },

  /** Meus itens, com os leilões de que cada um já participou. */
  async listOwn(): Promise<OwnItem[]> {
    const { data } = await api.get<{ items: OwnItem[] }>('/item');
    return data.items;
  },

  /** multipart/form-data: campos + fotos no campo `images` (mín. 3). */
  async create(fields: ItemFields, photos: File[], onProgress?: (pct: number) => void) {
    const { data } = await api.post<{ item: OwnItem }>('/item', toForm(fields, photos), {
      onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
    });
    return data.item;
  },

  async update(id: string, fields: Partial<ItemFields>, photos: File[] = []) {
    const { data } = await api.put<{ item: OwnItem }>(`/item/${id}`, toForm(fields, photos));
    return data.item;
  },

  async delete(id: string) {
    await api.delete(`/item/${id}`);
  },
};
