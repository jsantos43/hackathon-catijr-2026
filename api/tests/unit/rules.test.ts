import { describe, expect, it } from 'vitest';
import { participationSituation } from '../../src/services/Bid.js';
import RoomState, { type RoomStateData } from '../../src/services/RoomState.js';
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

describe('RoomState.precheck (pré-validação pelo Redis)', () => {
  const state: RoomStateData = {
    auctionId: 'a',
    ownerId: 'dono',
    priceCents: 100_00,
    leaderId: 'lider',
    minimumBidCents: 105_00,
    bidCount: 1,
    endsAt: new Date(),
  };

  it('recusa o comitente', () => {
    expect(RoomState.precheck(state, { userId: 'dono', amountCents: 999_00 })).toBe('IS_OWNER');
  });

  it('recusa valor abaixo do mínimo', () => {
    expect(RoomState.precheck(state, { userId: 'x', amountCents: 104_99 })).toBe('BID_TOO_LOW');
  });

  it('deixa o "já é o líder" para o banco decidir (pode estar desatualizado)', () => {
    expect(RoomState.precheck(state, { userId: 'lider', amountCents: 200_00 })).toBeNull();
  });
});
