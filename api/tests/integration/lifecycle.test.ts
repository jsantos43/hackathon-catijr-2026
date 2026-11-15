import { beforeEach, describe, expect, it } from 'vitest';
import { AuctionStatus } from '../../src/generated/prisma/enums.js';
import AuctionLifecycle from '../../src/jobs/AuctionLifecycle.js';
import { env } from '../../src/config/env.js';
import { db } from '../../src/prisma/db.js';
import { redis } from '../../src/redis/client.js';
import { RedisKeys } from '../../src/redis/keys.js';
import Bid from '../../src/services/Bid.js';
import Presence from '../../src/services/Presence.js';
import RoomState from '../../src/services/RoomState.js';
import { createAuction, createRunningAuction, createUser, newKey, resetState } from '../helpers/factories.js';

beforeEach(resetState);

const statusOf = async (id: string) =>
  (await db.auction.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

describe('AuctionLifecycle — abrir e fechar pelo relógio (RF17/RF18)', () => {
  it('abre os agendados que chegaram no horário e cria a sala no Redis', async () => {
    const owner = await createUser();
    const due = await createAuction(owner.id, {
      status: AuctionStatus.SCHEDULED,
      startsAt: new Date(Date.now() - 1000),
    });
    const later = await createAuction(owner.id, {
      status: AuctionStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60_000),
    });

    const opened = await AuctionLifecycle.openDue();

    expect(opened.map((a) => a.id)).toEqual([due.id]);
    expect(await statusOf(due.id)).toBe('RUNNING');
    expect(await statusOf(later.id)).toBe('SCHEDULED');
    expect(await RoomState.get(due.id)).toMatchObject({ minimumBidCents: 100_00, bidCount: 0 });
  });

  it('fecha como Vendido quem teve lance e como Encerrado sem lances quem não teve', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const withBid = await createRunningAuction(owner.id, { endsAt: new Date(Date.now() + 5 * 60_000) });
    const empty = await createRunningAuction(owner.id, { endsAt: new Date(Date.now() - 1000) });
    await Bid.place({ auctionId: withBid.id, bidder, amountCents: 100_00, idempotencyKey: newKey() });

    // "Avança o relógio" passando um horário depois do término.
    const closed = await AuctionLifecycle.closeDue(new Date(Date.now() + 6 * 60_000));

    expect(closed).toHaveLength(2);
    const sold = await db.auction.findUniqueOrThrow({ where: { id: withBid.id } });
    expect(sold).toMatchObject({ status: 'SOLD', winnerId: bidder.id, finalPriceCents: 100_00, bidCount: 1 });
    expect(await db.bid.count({ where: { auctionId: withBid.id } })).toBe(1);
    expect(await statusOf(empty.id)).toBe('ENDED_NO_BIDS');
    expect(await RoomState.get(withBid.id)).toBeNull();
  });

  it('não fecha um leilão que ainda não chegou no término', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id);

    expect(await AuctionLifecycle.closeDue()).toHaveLength(0);
    expect(await statusOf(auction.id)).toBe('RUNNING');
  });

  it('depois de fechado, o leilão não aceita mais lances', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id, { endsAt: new Date(Date.now() + 60_000) });
    await AuctionLifecycle.closeDue(new Date(Date.now() + 2 * 60_000));

    const outcome = await Bid.place({
      auctionId: auction.id,
      bidder: await createUser(),
      amountCents: 100_00,
      idempotencyKey: newKey(),
    });
    expect(outcome).toMatchObject({ ok: false, error: 'AUCTION_NOT_RUNNING' });
  });
});

describe('AuctionLifecycle.reconcile — sala perdida no Redis', () => {
  it('cancela leilão Em andamento cuja sala não existe mais', async () => {
    const owner = await createUser();
    const lost = await createAuction(owner.id); // RUNNING sem sala
    const fine = await createRunningAuction(owner.id);

    const cancelled = await AuctionLifecycle.reconcile(new Date(Date.now() + 60_000));

    expect(cancelled.map((a) => a.id)).toEqual([lost.id]);
    expect(await statusOf(fine.id)).toBe('RUNNING');
  });
});

describe('AuctionLifecycle.recoverFromCrash — regra de queda', () => {
  it('cancela os leilões que estavam Em andamento e guarda os lances no histórico', async () => {
    const owner = await createUser();
    const running = await createRunningAuction(owner.id);
    await Bid.place({
      auctionId: running.id,
      bidder: await createUser(),
      amountCents: 100_00,
      idempotencyKey: newKey(),
    });
    const scheduled = await createAuction(owner.id, {
      status: AuctionStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60 * 60_000),
      endsAt: new Date(Date.now() + 2 * 60 * 60_000),
    });

    const cancelled = await AuctionLifecycle.recoverFromCrash();

    expect(cancelled.map((a) => a.id)).toEqual([running.id]);
    expect(await statusOf(running.id)).toBe('CANCELLED');
    expect(await statusOf(scheduled.id)).toBe('SCHEDULED');
    expect(await RoomState.get(running.id)).toBeNull();
    expect(await db.bid.count({ where: { auctionId: running.id } })).toBe(1);
    expect(await db.auction.findUniqueOrThrow({ where: { id: running.id } })).toMatchObject({ winnerId: null });
  });

  it('cancela agendados cujo início caiu durante a queda (startsAt <= agora)', async () => {
    const owner = await createUser();
    const missedStart = await createAuction(owner.id, {
      status: AuctionStatus.SCHEDULED,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 10 * 60_000),
    });

    await AuctionLifecycle.recoverFromCrash();

    expect(await statusOf(missedStart.id)).toBe('CANCELLED');
  });

  it('sala que já tinha fechado antes da queda (CLOSING) é gravada como Vendido', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id, { endsAt: new Date(Date.now() + 5 * 60_000) });
    await Bid.place({ auctionId: auction.id, bidder, amountCents: 100_00, idempotencyKey: newKey() });
    // O job reivindicou a sala e o processo caiu antes de gravar.
    await RoomState.claimClose(auction.id, Date.now() + 6 * 60_000);

    await AuctionLifecycle.recoverFromCrash();

    expect(await db.auction.findUniqueOrThrow({ where: { id: auction.id } })).toMatchObject({
      status: 'SOLD',
      winnerId: bidder.id,
    });
  });

  it('com AUCTION_CANCEL_RUNNING_ON_BOOT=false a sala continua de onde parou', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id);
    env.AUCTION_CANCEL_RUNNING_ON_BOOT = false;
    try {
      await AuctionLifecycle.recoverFromCrash();
    } finally {
      env.AUCTION_CANCEL_RUNNING_ON_BOOT = true;
    }

    expect(await statusOf(auction.id)).toBe('RUNNING');
    expect(await RoomState.get(auction.id)).toMatchObject({ status: 'RUNNING' });
  });

  it('cancela agendados cuja janela inteira passou com a API fora', async () => {
    const owner = await createUser();
    const missed = await createAuction(owner.id, {
      status: AuctionStatus.SCHEDULED,
      startsAt: new Date(Date.now() - 10 * 60_000),
      endsAt: new Date(Date.now() - 5 * 60_000),
    });

    await AuctionLifecycle.recoverFromCrash();

    expect(await statusOf(missed.id)).toBe('CANCELLED');
  });

  it('apaga a presença que sobrou da execução anterior', async () => {
    await Presence.set('11111111-1111-1111-1111-111111111111', 'socket-velho', 'user', 'participant');

    await AuctionLifecycle.recoverFromCrash();

    expect(await redis.keys(RedisKeys.allPresence)).toHaveLength(0);
  });
});
