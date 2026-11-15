import { uuid } from './format';

/** Foto que já está no servidor (`url` pública) ou foto nova escolhida agora (`file`). */
export type PhotoEntry =
  | { id: string; kind: 'existing'; url: string }
  | { id: string; kind: 'new'; file: File; url: string; error?: string };

export const existingPhotos = (urls: string[]): PhotoEntry[] =>
  urls.map((url) => ({ id: uuid(), kind: 'existing', url }));

export const validPhotos = (list: PhotoEntry[]) => list.filter((p) => !(p.kind === 'new' && p.error));
