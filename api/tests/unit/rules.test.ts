import { describe, expect, it } from 'vitest';
import { participationSituation } from '../../src/services/Bid.js';
import { shortName } from '../../src/utils/names.js';

describe('shortName', () => {
  it.each([
    ['Marina Torres', 'Marina T.'],
    ['ana maria da silva', 'ana S.'],
    ['Joaquim', 'Joaquim'],
    ['  Marina   Torres  ', 'Marina T.'],
    ['Marina T.', 'Marina T.'], // aplicar duas vezes não muda
  ])('%s -> %s', (name, expected) => {
    expect(shortName(name)).toBe(expected);
  });
});

describe('participationSituation (RF27)', () => {
  const me = 'eu';
  it.each([
    ['RUNNING', me, 'LEADING'],
    ['RUNNING', 'outro', 'OUTBID'],
    ['SOLD', me, 'WON'],
    ['SOLD', 'outro', 'LOST'],
    ['CANCELLED', me, 'LOST'],
  ] as const)('%s com líder %s -> %s', (status, winnerId, expected) => {
    expect(participationSituation({ status, winnerId }, me)).toBe(expected);
  });
});
