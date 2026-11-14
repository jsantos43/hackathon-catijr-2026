// RF14: o lance mínimo é calculado só pelo sistema, a partir do estado do leilão.
// Tabela de incrementos de referência do documento, em centavos (RF19).
const INCREMENTS: Array<[upToCents: number, incrementCents: number]> = [
  [9_999, 100],
  [49_999, 500],
  [99_999, 1_000],
  [499_999, 5_000],
  [2_499_999, 10_000],
];

export const bidIncrementCents = (priceCents: number) =>
  INCREMENTS.find(([upTo]) => priceCents <= upTo)?.[1] ?? 50_000;

/**
 * Menor valor aceito para o próximo lance. O primeiro lance pode ser igual ao preço inicial.
 * Durante a disputa, finalPriceCents guarda o preço atual (o maior lance aceito).
 */
export const minimumBidCents = (auction: {
  startingPriceCents: number;
  bidCount: number;
  finalPriceCents: number | null;
}) =>
  auction.bidCount === 0 || auction.finalPriceCents === null
    ? auction.startingPriceCents
    : auction.finalPriceCents + bidIncrementCents(auction.finalPriceCents);
