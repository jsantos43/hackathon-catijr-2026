import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { AuctionStatus } from '../../src/generated/prisma/enums.js';
import { db } from '../../src/prisma/db.js';
import AuctionLifecycle from '../../src/jobs/AuctionLifecycle.js';
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

type Bidder = Awaited<ReturnType<typeof createUser>>;
const place = (auctionId: string, bidder: Bidder, amountCents: number, idempotencyKey = newKey()) =>
  Bid.place({ auctionId, bidder, amountCents, idempotencyKey });

describe('Bid.place — regras do lance', () => {
  it('aceita o primeiro lance igual ao preço inicial: grava só no Redis, nada no banco', async () => {
    const owner = await createUser();
    const bidder = await createUser('Marina Torres');
    const auction = await createRunningAuction(owner.id, { startingPriceCents: 100_00 });

    const outcome = await place(auction.id, bidder, 100_00);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.bid.bidderName).toBe('Marina T.');
    expect(outcome.auction).toMatchObject({
      finalPriceCents: 100_00,
      minimumBidCents: 105_00, // faixa de R$ 100 a R$ 499,99: incremento de R$ 5
      bidCount: 1,
      winnerId: bidder.id,
    });

    // Durante a disputa o PostgreSQL não é tocado.
    const saved = await db.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(saved).toMatchObject({ bidCount: 0, finalPriceCents: null, winnerId: null });
    expect(await db.bid.count()).toBe(0);

    const room = await RoomState.get(auction.id);
    expect(room).toMatchObject({ minimumBidCents: 105_00, leaderId: bidder.id, bidCount: 1, priceCents: 100_00 });
    expect(await RoomState.allBids(auction.id)).toHaveLength(1);

    // A leitura pública já mostra o estado ao vivo.
    const res = await request(app).get(`/auction/${auction.id}`).expect(200);
    expect(res.body.auction).toMatchObject({
      bidCount: 1,
      finalPriceCents: 100_00,
      minimumBidCents: 105_00,
      winner: { id: bidder.id, name: 'Marina Torres' },
    });
  });

  it('recusa valor abaixo do mínimo e informa o mínimo vigente', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id, { startingPriceCents: 100_00 });

    const outcome = await place(auction.id, bidder, 99_99);

    expect(outcome).toMatchObject({ ok: false, error: 'BID_TOO_LOW', minimumBidCents: 100_00 });
    expect(await RoomState.allBids(auction.id)).toHaveLength(0);
  });

  it('recusa lance do comitente', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id);

    expect(await place(auction.id, owner, 500_00)).toMatchObject({ ok: false, error: 'IS_OWNER' });
  });

  it('recusa quem já é o líder', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id);

    await place(auction.id, bidder, 100_00);
    await new Promise((r) => setTimeout(r, env.BID_THROTTLE_MS + 50)); // passa a anti-rajada

    expect(await place(auction.id, bidder, 200_00)).toMatchObject({
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

    expect(await place(scheduled.id, bidder, 100_00)).toMatchObject({
      ok: false,
      error: 'AUCTION_NOT_RUNNING',
    });
    expect(await place(timeUp.id, await createUser(), 100_00)).toMatchObject({
      ok: false,
      error: 'AUCTION_NOT_RUNNING',
    });
  });

  it('sem a sala no Redis não há disputa (o banco não decide lance)', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createAuction(owner.id); // RUNNING no banco, sem RoomState.open

    expect(await place(auction.id, bidder, 100_00)).toMatchObject({
      ok: false,
      error: 'AUCTION_NOT_RUNNING',
    });
    expect(await db.bid.count()).toBe(0);
  });
});

describe('Bid.place — idempotência, anti-rajada e prorrogação', () => {
  it('reenviar a mesma chave devolve o mesmo lance, sem gravar outro (RF12)', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id);
    const key = newKey();

    const first = await place(auction.id, bidder, 100_00, key);
    const again = await place(auction.id, bidder, 100_00, key);

    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.bid.id).toBe(first.bid.id);
    expect(await RoomState.allBids(auction.id)).toHaveLength(1);
  });

  it('duplo clique: dois envios simultâneos com a mesma chave geram um lance só', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id);
    const key = newKey();

    const outcomes = await Promise.all([
      place(auction.id, bidder, 100_00, key),
      place(auction.id, bidder, 100_00, key),
      place(auction.id, bidder, 100_00, key),
    ]);

    expect(outcomes.filter((o) => o.ok && !o.duplicate)).toHaveLength(1);
    expect(await RoomState.allBids(auction.id)).toHaveLength(1);
  });

  it('reenvio depois do fechamento devolve o lance já gravado no banco', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id);
    const key = newKey();

    const first = await place(auction.id, bidder, 100_00, key);
    await AuctionLifecycle.closeDue(new Date(Date.now() + 60 * 60_000));
    const again = await place(auction.id, bidder, 100_00, key);

    expect(again).toMatchObject({ ok: true, duplicate: true });
    if (first.ok && again.ok) expect(again.bid.id).toBe(first.bid.id);
    expect(await db.bid.count()).toBe(1);
  });

  it('anti-rajada: dois lances do mesmo usuário em menos de 500 ms', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const a1 = await createRunningAuction(owner.id);
    const a2 = await createRunningAuction(owner.id);

    expect((await place(a1.id, bidder, 100_00)).ok).toBe(true);
    expect(await place(a2.id, bidder, 100_00)).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
  });

  it('lance nos últimos 2 min prorroga o término para 2 min depois do lance (RF15)', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id, {
      endsAt: new Date(Date.now() + 30_000),
    });

    const before = Date.now();
    const outcome = await place(auction.id, bidder, 100_00);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.extended).toBe(true);
    const endsAt = Date.parse(outcome.auction.endsAt);
    expect(endsAt).toBeGreaterThanOrEqual(before + 2 * 60_000);
    expect(endsAt).toBeLessThan(Date.now() + 2 * 60_000 + 1000);

    const room = await RoomState.get(auction.id);
    expect(room!.endsAt.getTime()).toBe(endsAt);
    expect(room!.originalEndsAt.getTime()).toBe(auction.originalEndsAt.getTime());
    // O job não fecha antes do novo término, e grava o término prorrogado no fim.
    expect(await AuctionLifecycle.closeDue(new Date(endsAt - 1000))).toHaveLength(0);
    const [closed] = await AuctionLifecycle.closeDue(new Date(endsAt));
    expect(closed!.endsAt.getTime()).toBe(endsAt);
  });
});

describe('Bid.place — concorrência', () => {
  it('vários lances simultâneos com o mesmo valor: só um é aceito', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id, { startingPriceCents: 100_00 });
    const bidders = await Promise.all(Array.from({ length: 8 }, () => createUser()));

    const outcomes = await Promise.all(bidders.map((b) => place(auction.id, b, 100_00)));

    const accepted = outcomes.filter((o) => o.ok);
    const rejected = outcomes.filter((o) => !o.ok);
    expect(accepted).toHaveLength(1);
    expect(rejected.every((o) => !o.ok && o.error === 'BID_TOO_LOW')).toBe(true);

    expect(await RoomState.get(auction.id)).toMatchObject({ bidCount: 1 });
    expect(await RoomState.allBids(auction.id)).toHaveLength(1);
  });

  it('lances simultâneos crescentes: o estado final é coerente com os lances gravados', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id, { startingPriceCents: 100_00 });
    const bidders = await Promise.all(Array.from({ length: 6 }, () => createUser()));

    await Promise.all(bidders.map((b, i) => place(auction.id, b, 100_00 + i * 50_00)));

    const room = await RoomState.get(auction.id);
    const bids = await RoomState.allBids(auction.id);
    // Cada lance aceito é maior que o anterior, e a sala aponta para o último.
    for (let i = 1; i < bids.length; i++) {
      expect(bids[i]!.amountCents).toBeGreaterThan(bids[i - 1]!.amountCents);
    }
    expect(room).toMatchObject({
      bidCount: bids.length,
      priceCents: bids.at(-1)!.amountCents,
      leaderId: bids.at(-1)!.bidderId,
    });

    // No fechamento, exatamente esses lances vão para o banco.
    await AuctionLifecycle.closeDue(new Date(Date.now() + 60 * 60_000));
    const saved = await db.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(saved).toMatchObject({
      status: 'SOLD',
      bidCount: bids.length,
      finalPriceCents: bids.at(-1)!.amountCents,
      winnerId: bids.at(-1)!.bidderId,
    });
    expect(await db.bid.count({ where: { auctionId: auction.id } })).toBe(bids.length);
    expect(await RoomState.get(auction.id)).toBeNull();
  });
});

describe('Rotas REST de lances', () => {
  it('GET /auction/:id/bids devolve os lances do mais recente para o mais antigo', async () => {
    const owner = await createUser();
    const [b1, b2] = [await createUser('Ana Lima'), await createUser('Bruno Souza')];
    const auction = await createRunningAuction(owner.id);
    await place(auction.id, b1, 100_00);
    await place(auction.id, b2, 110_00);

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

    await place(leading.id, me, 100_00);
    await place(outbid.id, rival, 100_00);
    await new Promise((r) => setTimeout(r, env.BID_THROTTLE_MS + 50));
    await place(outbid.id, me, 105_00);
    await new Promise((r) => setTimeout(r, env.BID_THROTTLE_MS + 50));
    await place(outbid.id, rival, 110_00);

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
