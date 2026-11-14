import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { AuctionStatus } from '../../src/generated/prisma/enums.js';
import { db } from '../../src/prisma/db.js';
import Bid from '../../src/services/Bid.js';
import RoomState from '../../src/services/RoomState.js';
import {
  createAuction,
  createRunningAuction,
  createUser,
  newKey,
  resetState,
  sessionCookie,
} from '../helpers/factories.js';

beforeEach(resetState);

const place = (auctionId: string, userId: string, amountCents: number, idempotencyKey = newKey()) =>
  Bid.place({ auctionId, userId, amountCents, idempotencyKey });

describe('Bid.place — regras do lance', () => {
  it('aceita o primeiro lance igual ao preço inicial e atualiza banco e Redis', async () => {
    const owner = await createUser();
    const bidder = await createUser('Marina Torres');
    const auction = await createRunningAuction(owner.id, { startingPriceCents: 100_00 });

    const outcome = await place(auction.id, bidder.id, 100_00);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.bid.bidderName).toBe('Marina T.');
    expect(outcome.auction).toMatchObject({
      finalPriceCents: 100_00,
      minimumBidCents: 105_00, // faixa de R$ 100 a R$ 499,99: incremento de R$ 5
      bidCount: 1,
      winnerId: bidder.id,
    });

    const saved = await db.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(saved).toMatchObject({ bidCount: 1, finalPriceCents: 100_00, winnerId: bidder.id });
    expect(await db.bid.count()).toBe(1);

    const room = await RoomState.get(auction.id);
    expect(room).toMatchObject({ minimumBidCents: 105_00, leaderId: bidder.id, bidCount: 1 });
  });

  it('recusa valor abaixo do mínimo e informa o mínimo vigente', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id, { startingPriceCents: 100_00 });

    const outcome = await place(auction.id, bidder.id, 99_99);

    expect(outcome).toMatchObject({ ok: false, error: 'BID_TOO_LOW', minimumBidCents: 100_00 });
    expect(await db.bid.count()).toBe(0);
  });

  it('recusa lance do comitente', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id);

    expect(await place(auction.id, owner.id, 500_00)).toMatchObject({ ok: false, error: 'IS_OWNER' });
  });

  it('recusa quem já é o líder', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id);

    await place(auction.id, bidder.id, 100_00);
    await new Promise((r) => setTimeout(r, env.BID_THROTTLE_MS + 50)); // passa a anti-rajada

    expect(await place(auction.id, bidder.id, 200_00)).toMatchObject({
      ok: false,
      error: 'ALREADY_LEADER',
    });
  });

  it('recusa lance em leilão agendado, encerrado ou que já passou do horário', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const scheduled = await createAuction(owner.id, {
      status: AuctionStatus.SCHEDULED,
      startsAt: new Date(Date.now() + 60_000),
    });
    const timeUp = await createAuction(owner.id, { endsAt: new Date(Date.now() - 1000) });

    expect(await place(scheduled.id, bidder.id, 100_00)).toMatchObject({
      ok: false,
      error: 'AUCTION_NOT_RUNNING',
    });
    expect(await place(timeUp.id, (await createUser()).id, 100_00)).toMatchObject({
      ok: false,
      error: 'AUCTION_NOT_RUNNING',
    });
  });

  it('funciona mesmo sem o estado da sala no Redis (o banco decide sozinho)', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createAuction(owner.id); // sem RoomState.open

    expect((await place(auction.id, bidder.id, 100_00)).ok).toBe(true);
  });
});

describe('Bid.place — idempotência, anti-rajada e prorrogação', () => {
  it('reenviar a mesma chave devolve o mesmo lance, sem gravar outro (RF12)', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id);
    const key = newKey();

    const first = await place(auction.id, bidder.id, 100_00, key);
    const again = await place(auction.id, bidder.id, 100_00, key);

    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.bid.id).toBe(first.bid.id);
    expect(await db.bid.count()).toBe(1);
  });

  it('a idempotência sobrevive à perda do Redis (o banco tem a chave única)', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id);
    const key = newKey();

    const first = await place(auction.id, bidder.id, 100_00, key);
    await resetRedisOnly();
    const again = await place(auction.id, bidder.id, 100_00, key);

    expect(again).toMatchObject({ ok: true, duplicate: true });
    if (first.ok && again.ok) expect(again.bid.id).toBe(first.bid.id);
    expect(await db.bid.count()).toBe(1);
  });

  it('anti-rajada: dois lances do mesmo usuário em menos de 500 ms', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const a1 = await createRunningAuction(owner.id);
    const a2 = await createRunningAuction(owner.id);

    expect((await place(a1.id, bidder.id, 100_00)).ok).toBe(true);
    expect(await place(a2.id, bidder.id, 100_00)).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
  });

  it('lance nos últimos 2 min prorroga o término para 2 min depois do lance (RF15)', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id, {
      endsAt: new Date(Date.now() + 30_000),
    });

    const before = Date.now();
    const outcome = await place(auction.id, bidder.id, 100_00);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.extended).toBe(true);
    const endsAt = Date.parse(outcome.auction.endsAt);
    expect(endsAt).toBeGreaterThanOrEqual(before + 2 * 60_000);
    expect(endsAt).toBeLessThan(Date.now() + 2 * 60_000 + 1000);

    const saved = await db.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(saved.endsAt.getTime()).toBe(endsAt);
    expect(saved.originalEndsAt.getTime()).toBe(auction.originalEndsAt.getTime());
  });
});

describe('Bid.place — concorrência', () => {
  it('vários lances simultâneos com o mesmo valor: só um é aceito', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id, { startingPriceCents: 100_00 });
    const bidders = await Promise.all(Array.from({ length: 8 }, () => createUser()));

    const outcomes = await Promise.all(bidders.map((b) => place(auction.id, b.id, 100_00)));

    const accepted = outcomes.filter((o) => o.ok);
    const rejected = outcomes.filter((o) => !o.ok);
    expect(accepted).toHaveLength(1);
    expect(rejected.every((o) => !o.ok && o.error === 'BID_TOO_LOW')).toBe(true);

    const saved = await db.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(saved.bidCount).toBe(1);
    expect(await db.bid.count()).toBe(1);
  });

  it('lances simultâneos crescentes: o estado final é coerente com os lances gravados', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id, { startingPriceCents: 100_00 });
    const bidders = await Promise.all(Array.from({ length: 6 }, () => createUser()));

    await Promise.all(bidders.map((b, i) => place(auction.id, b.id, 100_00 + i * 50_00)));

    const saved = await db.auction.findUniqueOrThrow({ where: { id: auction.id } });
    const bids = await db.bid.findMany({ where: { auctionId: auction.id }, orderBy: { createdAt: 'asc' } });
    // Cada lance aceito é maior que o anterior, e o leilão aponta para o último.
    for (let i = 1; i < bids.length; i++) {
      expect(bids[i]!.amountCents).toBeGreaterThan(bids[i - 1]!.amountCents);
    }
    expect(saved.bidCount).toBe(bids.length);
    expect(saved.finalPriceCents).toBe(bids.at(-1)!.amountCents);
    expect(saved.winnerId).toBe(bids.at(-1)!.bidderId);
    // O Redis nunca fica "para trás" do banco.
    expect(await RoomState.get(auction.id)).toMatchObject({ bidCount: bids.length });
  });
});

describe('Rotas REST de lances', () => {
  it('GET /auction/:id/bids devolve os lances do mais recente para o mais antigo', async () => {
    const owner = await createUser();
    const [b1, b2] = [await createUser('Ana Lima'), await createUser('Bruno Souza')];
    const auction = await createRunningAuction(owner.id);
    await place(auction.id, b1.id, 100_00);
    await place(auction.id, b2.id, 110_00);

    const res = await request(app).get(`/auction/${auction.id}/bids?limit=1`).expect(200);

    expect(res.body.bids).toHaveLength(1);
    expect(res.body.bids[0]).toMatchObject({ amountCents: 110_00, bidderName: 'Bruno S.' });
  });

  it('GET /auction/:id/bids responde 404 para leilão inexistente', async () => {
    await request(app).get(`/auction/${newKey()}/bids`).expect(404);
  });

  it('GET /auction/participations mostra a situação em cada leilão (RF27)', async () => {
    const owner = await createUser();
    const me = await createUser();
    const rival = await createUser();
    const leading = await createRunningAuction(owner.id, { title: 'Liderando' });
    const outbid = await createRunningAuction(owner.id, { title: 'Superado' });

    await place(leading.id, me.id, 100_00);
    await place(outbid.id, rival.id, 100_00);
    await new Promise((r) => setTimeout(r, env.BID_THROTTLE_MS + 50));
    await place(outbid.id, me.id, 105_00);
    await new Promise((r) => setTimeout(r, env.BID_THROTTLE_MS + 50));
    await place(outbid.id, rival.id, 110_00);

    const res = await request(app)
      .get('/auction/participations')
      .set('Cookie', sessionCookie(me.id))
      .expect(200);

    const byTitle = Object.fromEntries(
      res.body.participations.map((p: { auction: { title: string } }) => [p.auction.title, p]),
    );
    expect(byTitle['Liderando']).toMatchObject({ situation: 'LEADING', myHighestBidCents: 100_00 });
    expect(byTitle['Superado']).toMatchObject({ situation: 'OUTBID', myHighestBidCents: 105_00 });
  });

  it('GET /auction/participations exige login', async () => {
    await request(app).get('/auction/participations').expect(401);
  });
});

async function resetRedisOnly() {
  const { redis } = await import('../../src/redis/client.js');
  await redis.flushdb();
}
