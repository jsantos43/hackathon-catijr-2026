import { describe, expect, it } from 'vitest';
import { bidIncrementCents, minimumBidCents } from '../../src/utils/money.js';

describe('bidIncrementCents (tabela de incrementos, RF19)', () => {
  it.each([
    [1_00, 1_00],
    [99_99, 1_00],
    [100_00, 5_00],
    [499_99, 5_00],
    [500_00, 10_00],
    [999_99, 10_00],
    [1_000_00, 50_00],
    [4_999_99, 50_00],
    [5_000_00, 100_00],
    [24_999_99, 100_00],
    [25_000_00, 500_00],
    [1_000_000_00, 500_00],
  ])('preço %i centavos -> incremento %i', (price, increment) => {
    expect(bidIncrementCents(price)).toBe(increment);
  });
});

describe('minimumBidCents', () => {
  it('o primeiro lance pode ser igual ao preço inicial', () => {
    expect(minimumBidCents({ startingPriceCents: 150_00, bidCount: 0, finalPriceCents: null })).toBe(150_00);
  });

  it('depois, é o preço atual mais o incremento da faixa', () => {
    expect(minimumBidCents({ startingPriceCents: 100_00, bidCount: 3, finalPriceCents: 120_00 })).toBe(125_00);
  });
});
