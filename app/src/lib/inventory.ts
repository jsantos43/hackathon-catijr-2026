import type { OwnItem } from '../types';

/** Por que um item do inventário não pode entrar num leilão novo (RF28), ou null se pode. */
export const unavailableReason = (i: OwnItem): string | null => {
  if (i.auctions.some((a) => a.status === 'SOLD')) return 'Vendido';
  if (i.auctions.some((a) => a.status === 'RUNNING')) return 'Em leilão agora';
  if (i.auctions.some((a) => a.status === 'SCHEDULED')) return 'Em leilão agendado';
  return null;
};

export const isAvailable = (i: OwnItem) => unavailableReason(i) === null;

/** `?itens=a,b` ↔ lista de ids, na ordem escolhida (o primeiro é a capa). */
export const parseItemIds = (v: string | null) => (v ?? '').split(',').filter(Boolean);
export const itemsQuery = (ids: string[]) => `itens=${ids.join(',')}`;
