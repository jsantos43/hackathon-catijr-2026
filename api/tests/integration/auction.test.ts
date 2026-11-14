import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { AuctionStatus } from '../../src/generated/prisma/enums.js';
import Bid from '../../src/services/Bid.js';
import {
  createAuction,
  createItem,
  createRunningAuction,
  createUser,
  newKey,
  resetState,
  sessionCookie,
} from '../helpers/factories.js';

beforeEach(resetState);

const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

describe('POST /auction', () => {
  it('cria um leilão agendado com os itens do usuário', async () => {
    const owner = await createUser();
    const item = await createItem(owner.id);

    const res = await request(app)
      .post('/auction')
      .set('Cookie', sessionCookie(owner.id))
      .send({
        title: 'Câmera antiga',
        itemIds: [item.id],
        startingPriceCents: 50_00,
        startsAt: inMinutes(60),
        durationSeconds: 600,
      })
      .expect(201);

    expect(res.body.auction).toMatchObject({
      status: 'SCHEDULED',
      minimumBidCents: 50_00,
      winner: null,
      owner: { id: owner.id },
    });
    expect(res.body.auction.items[0].images[0]).toMatch(/^http/);
  });

  it('recusa início em menos de AUCTION_MIN_LEAD_SECONDS', async () => {
    const owner = await createUser();
    const item = await createItem(owner.id);

    await request(app)
      .post('/auction')
      .set('Cookie', sessionCookie(owner.id))
      .send({ title: 'Cedo demais', itemIds: [item.id], startingPriceCents: 50_00, startsAt: inMinutes(0), durationSeconds: 600 })
      .expect(422);
  });

  it('não deixa usar item de outra pessoa', async () => {
    const owner = await createUser();
    const other = await createUser();
    const item = await createItem(other.id);

    await request(app)
      .post('/auction')
      .set('Cookie', sessionCookie(owner.id))
      .send({ title: 'Não é meu', itemIds: [item.id], startingPriceCents: 50_00, startsAt: inMinutes(60), durationSeconds: 600 })
      .expect(403);
  });
});

describe('GET /auction/all', () => {
  it('ordena por preço atual (maior lance ou preço inicial) com ?sort=price', async () => {
    const owner = await createUser();
    const cheapWithBid = await createRunningAuction(owner.id, { startingPriceCents: 10_00, title: 'A' });
    await createRunningAuction(owner.id, { startingPriceCents: 50_00, title: 'B' });
    await createRunningAuction(owner.id, { startingPriceCents: 30_00, title: 'C' });
    // O lance leva o A de R$ 10 para R$ 80.
    await Bid.place({ auctionId: cheapWithBid.id, userId: (await createUser()).id, amountCents: 80_00, idempotencyKey: newKey() });

    const res = await request(app).get('/auction/all?sort=price').expect(200);

    expect(res.body.auctions.map((a: { title: string }) => a.title)).toEqual(['C', 'B', 'A']);
    expect(res.body.auctions[2].winner).toMatchObject({ name: expect.any(String) });
  });

  it('ordena por quantidade de lances com ?sort=bids', async () => {
    const owner = await createUser();
    await createRunningAuction(owner.id, { title: 'Sem lance' });
    const popular = await createRunningAuction(owner.id, { title: 'Com lance' });
    await Bid.place({ auctionId: popular.id, userId: (await createUser()).id, amountCents: 100_00, idempotencyKey: newKey() });

    const res = await request(app).get('/auction/all?sort=bids').expect(200);

    expect(res.body.auctions[0].title).toBe('Com lance');
  });

  it('recusa sort desconhecido', async () => {
    await request(app).get('/auction/all?sort=nome').expect(400);
  });
});

describe('DELETE /auction/:id (RF08)', () => {
  it('cancela um leilão em andamento sem lances', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id);

    const res = await request(app)
      .delete(`/auction/${auction.id}`)
      .set('Cookie', sessionCookie(owner.id))
      .expect(200);

    expect(res.body.auction.status).toBe('CANCELLED');
  });

  it('não cancela leilão com lances', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id);
    await Bid.place({ auctionId: auction.id, userId: (await createUser()).id, amountCents: 100_00, idempotencyKey: newKey() });

    await request(app).delete(`/auction/${auction.id}`).set('Cookie', sessionCookie(owner.id)).expect(422);
  });

  it('só o dono cancela', async () => {
    const owner = await createUser();
    const auction = await createAuction(owner.id, { status: AuctionStatus.SCHEDULED, startsAt: new Date(Date.now() + 3_600_000) });

    await request(app)
      .delete(`/auction/${auction.id}`)
      .set('Cookie', sessionCookie((await createUser()).id))
      .expect(403);
  });
});

describe('PUT /auction/:id (RF23)', () => {
  it('em andamento, só deixa acrescentar texto', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id);
    const cookie = sessionCookie(owner.id);

    await request(app).put(`/auction/${auction.id}`).set('Cookie', cookie).send({ title: 'Outro título' }).expect(422);

    const res = await request(app)
      .put(`/auction/${auction.id}`)
      .set('Cookie', cookie)
      .send({ appendDescription: 'Acompanha caixa original.' })
      .expect(200);
    expect(res.body.auction.description).toContain('Acompanha caixa original.');
  });
});
