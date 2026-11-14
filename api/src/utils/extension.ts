import { env } from '../config/env.js';

export type ExtensionRules = {
  /** Lance com menos que isso para o fim prorroga o leilão. */
  windowMs: number;
  /** O novo término fica a esse tempo depois do lance. */
  extensionMs: number;
  /** Prorrogação máxima somada, contada a partir do término original. */
  maxExtensionMs: number;
};

export const defaultExtensionRules = (): ExtensionRules => ({
  windowMs: env.AUCTION_EXTENSION_WINDOW_SECONDS * 1000,
  extensionMs: env.AUCTION_EXTENSION_SECONDS * 1000,
  maxExtensionMs: env.AUCTION_MAX_EXTENSION_SECONDS * 1000,
});

/**
 * RF15 — prorrogação de lance de última hora.
 *
 * Um lance dado com menos de 2 min no relógio leva o término para 2 min depois do lance,
 * mas nunca além de `originalEndsAt + 30 min`. Função pura (sem banco, sem relógio) para ser
 * fácil de testar.
 */
export const extendEndsAt = (
  { bidAt, endsAt, originalEndsAt }: { bidAt: Date; endsAt: Date; originalEndsAt: Date },
  rules: ExtensionRules = defaultExtensionRules(),
): { endsAt: Date; extended: boolean } => {
  const remaining = endsAt.getTime() - bidAt.getTime();
  if (remaining >= rules.windowMs) return { endsAt, extended: false };

  const cap = originalEndsAt.getTime() + rules.maxExtensionMs;
  const proposed = Math.min(bidAt.getTime() + rules.extensionMs, cap);

  // Já estava prorrogado até depois disso (ou chegou no limite): não muda.
  if (proposed <= endsAt.getTime()) return { endsAt, extended: false };

  return { endsAt: new Date(proposed), extended: true };
};
