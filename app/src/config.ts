// Limites do produto (decisão da equipe, ver design/DESIGN.md). A API valida de novo com os
// valores do api/.env; aqui é só para orientar o usuário antes de enviar.
export const LIMITS = {
  ITEM_NAME_MAX: 80,
  ITEM_DESCRIPTION_MAX: 2000,
  AUCTION_TITLE_MAX: 100,
  AUCTION_DESCRIPTION_MAX: 3000,
  APPEND_DESCRIPTION_MAX: 500,
  PHOTOS_MIN: 3,
  PHOTOS_MAX: 8,
  PHOTO_MAX_BYTES: 5 * 1024 * 1024,
  PHOTO_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  START_MIN_LEAD_MS: 60 * 1000,
  START_MAX_LEAD_MS: 30 * 24 * 60 * 60 * 1000,
  EDIT_LOCK_MS: 30 * 60 * 1000,
  /** Lance nos últimos 2 min prorroga o término para 2 min depois dele. */
  EXTENSION_WINDOW_MS: 2 * 60 * 1000,
  EXTENSION_MAX_MS: 30 * 60 * 1000,
  MIN_PRICE_CENTS: 100,
} as const;

export const DURATIONS: { label: string; seconds: number }[] = [
  { label: '3 minutos (demo)', seconds: 3 * 60 },
  { label: '15 minutos', seconds: 15 * 60 },
  { label: '30 minutos', seconds: 30 * 60 },
  { label: '1 hora', seconds: 60 * 60 },
  { label: '6 horas', seconds: 6 * 60 * 60 },
  { label: '1 dia', seconds: 24 * 60 * 60 },
  { label: '3 dias', seconds: 3 * 24 * 60 * 60 },
  { label: '7 dias', seconds: 7 * 24 * 60 * 60 },
];

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3333';

/**
 * Rotas/eventos que a API ainda não tem usam uma resposta genérica (ver services/pending.ts).
 * Defina VITE_PENDING_FALLBACK=false para desligar e ver os erros reais.
 */
export const PENDING_FALLBACK = import.meta.env.VITE_PENDING_FALLBACK !== 'false';
