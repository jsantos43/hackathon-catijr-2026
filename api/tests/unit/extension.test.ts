import { describe, expect, it } from 'vitest';
import { extendEndsAt, type ExtensionRules } from '../../src/utils/extension.js';

// RF15: lance nos últimos 2 min leva o término para 2 min depois do lance, até +30 min.
const rules: ExtensionRules = {
  windowMs: 2 * 60_000,
  extensionMs: 2 * 60_000,
  maxExtensionMs: 30 * 60_000,
};

const t0 = new Date('2026-11-14T18:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

describe('extendEndsAt (prorrogação)', () => {
  it('não prorroga quando faltam 2 min ou mais', () => {
    const endsAt = at(2 * 60_000);
    const result = extendEndsAt({ bidAt: t0, endsAt, originalEndsAt: endsAt }, rules);
    expect(result).toEqual({ endsAt, extended: false });
  });

  it('leva o término para 2 min depois do lance quando falta menos que isso', () => {
    const endsAt = at(30_000); // faltam 30 s
    const result = extendEndsAt({ bidAt: t0, endsAt, originalEndsAt: endsAt }, rules);
    expect(result.extended).toBe(true);
    expect(result.endsAt).toEqual(at(2 * 60_000));
  });

  it('nunca passa do término original + 30 min', () => {
    const originalEndsAt = t0;
    const endsAt = at(29 * 60_000); // já prorrogado 29 min
    const bidAt = at(28 * 60_000 + 30_000); // faltam 30 s
    const result = extendEndsAt({ bidAt, endsAt, originalEndsAt }, rules);
    expect(result.extended).toBe(true);
    expect(result.endsAt).toEqual(at(30 * 60_000)); // limite, não 30min30s
  });

  it('não prorroga quando já chegou no limite', () => {
    const originalEndsAt = t0;
    const endsAt = at(30 * 60_000);
    const bidAt = at(29 * 60_000 + 50_000);
    const result = extendEndsAt({ bidAt, endsAt, originalEndsAt }, rules);
    expect(result).toEqual({ endsAt, extended: false });
  });
});
