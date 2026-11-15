import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { AuctionStatus } from '../../src/generated/prisma/enums.js';
import { db } from '../../src/prisma/db.js';
import Bid from '../../src/services/Bid.js';
import {
  PASSWORD,
  createAuction,
  createItem,
  createRunningAuction,
  createUser,
  newKey,
  resetState,
  sessionCookie,
} from '../helpers/factories.js';

beforeEach(resetState);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('GET /user/search (RF22)', () => {
  it('acha comitentes por pedaço do nome, ignorando acentos e maiúsculas', async () => {
    const joao = await createUser('João Conceição');
    const outro = await createUser('Joana Prado');
    const semLeilao = await createUser('João Sem Leilão');
    await createAuction(joao.id);
    await createAuction(joao.id, { status: AuctionStatus.SOLD });
    await createAuction(outro.id);

    const res = await request(app).get('/user/search').query({ q: 'joao' }).expect(200);

    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toMatchObject({ id: joao.id, name: 'João Conceição', auctionCount: 2 });
    expect(res.body.users[0]).not.toHaveProperty('email');
    expect(res.body.users.map((u: { id: string }) => u.id)).not.toContain(semLeilao.id);

    const accent = await request(app).get('/user/search').query({ q: 'CONCEICAO' }).expect(200);
    expect(accent.body.users.map((u: { id: string }) => u.id)).toEqual([joao.id]);
  });

  it('exige o texto da busca', async () => {
    await request(app).get('/user/search').expect(400);
  });
});

describe('GET /auction/all?q= (RF21)', () => {
  it('ignora acentos no título e no nome dos itens do lote', async () => {
    const owner = await createUser();
    const a = await createAuction(owner.id, { title: 'Câmera Pentax' });
    const b = await createAuction(owner.id, { title: 'Lote variado' }); // item: Relógio de bolso antigo
    await createAuction(owner.id, { title: 'Bicicleta' });

    const camera = await request(app).get('/auction/all').query({ q: 'camera' }).expect(200);
    expect(camera.body.auctions.map((x: { id: string }) => x.id)).toEqual([a.id]);

    const relogio = await request(app).get('/auction/all').query({ q: 'relogio', status: 'RUNNING' }).expect(200);
    expect(relogio.body.auctions.map((x: { id: string }) => x.id)).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
  });

  it('trata % e _ como texto, não como curinga', async () => {
    const owner = await createUser();
    await createAuction(owner.id, { title: 'Desconto de 50% hoje' });
    await createAuction(owner.id, { title: 'Desconto de 500 hoje' });

    const res = await request(app).get('/auction/all').query({ q: '50%' }).expect(200);
    expect(res.body.auctions.map((x: { title: string }) => x.title)).toEqual(['Desconto de 50% hoje']);
  });
});

describe('DELETE /user', () => {
  it('anonimiza a conta, mantém o histórico e derruba a sessão', async () => {
    const user = await createUser('Pessoa Que Sai');
    await createAuction(user.id, { status: AuctionStatus.ENDED_NO_BIDS });

    const res = await request(app).delete('/user').set('Cookie', sessionCookie(user.id)).expect(200);
    expect(String(res.headers['set-cookie'])).toMatch(/accessToken=;/);

    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.name).toBe('Conta excluída');
    expect(stored.deletedAt).not.toBeNull();
    expect(await db.auction.count({ where: { ownerId: user.id } })).toBe(1);

    // Sessão antiga não vale mais e o login com o e-mail antigo falha.
    await request(app).get('/user').set('Cookie', sessionCookie(user.id)).expect(401);
    await request(app).post('/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);

    // O e-mail fica livre para um cadastro novo.
    await request(app)
      .post('/user')
      .send({ name: 'Nova', email: user.email, password: PASSWORD })
      .expect(201);
  });

  it('recusa enquanto houver leilão próprio aberto ou liderança', async () => {
    const owner = await createUser();
    await createAuction(owner.id, { status: AuctionStatus.SCHEDULED, startsAt: new Date(Date.now() + 3_600_000) });

    const res = await request(app).delete('/user').set('Cookie', sessionCookie(owner.id)).expect(422);
    expect(res.body.details.join(' ')).toMatch(/agendados ou em andamento/);

    const bidder = await createUser();
    // A liderança só existe no Redis enquanto a disputa corre.
    const running = await createRunningAuction(owner.id);
    await Bid.place({ auctionId: running.id, bidder, amountCents: 10_000, idempotencyKey: newKey() });
    const lead = await request(app).delete('/user').set('Cookie', sessionCookie(bidder.id)).expect(422);
    expect(lead.body.details.join(' ')).toMatch(/liderando/);
  });
});

describe('PUT /item/:id com keepImages', () => {
  it('reordena as fotos atuais (troca a capa) e acrescenta novas', async () => {
    const owner = await createUser();
    const item = await createItem(owner.id); // fotos: items/a.png, b.png, c.png

    const reorder = await request(app)
      .put(`/item/${item.id}`)
      .set('Cookie', sessionCookie(owner.id))
      .field('keepImages', JSON.stringify(['items/c.png', 'items/a.png', 'items/b.png']))
      .expect(200);
    expect(reorder.body.item.images.map((u: string) => u.split('/').pop())).toEqual(['c.png', 'a.png', 'b.png']);

    const add = await request(app)
      .put(`/item/${item.id}`)
      .set('Cookie', sessionCookie(owner.id))
      .field('keepImages', JSON.stringify(reorder.body.item.images.slice(0, 2)))
      .attach('images', PNG, 'nova1.png')
      .attach('images', PNG, 'nova2.png')
      .expect(200);
    expect(add.body.item.images).toHaveLength(4);
    expect(add.body.item.images[0]).toMatch(/c\.png$/);

    // Foto nova como capa: "new:0" no começo da ordem.
    const cover = await request(app)
      .put(`/item/${item.id}`)
      .set('Cookie', sessionCookie(owner.id))
      .field('keepImages', JSON.stringify(['new:0', ...add.body.item.images.slice(0, 2)]))
      .attach('images', PNG, 'capa.png')
      .expect(200);
    expect(cover.body.item.images).toHaveLength(3);
    expect(cover.body.item.images[0]).toMatch(/foto-0\.png$/);
    expect(cover.body.item.images[1]).toMatch(/c\.png$/);
  });

  it('recusa ficar com menos fotos que o mínimo ou foto de outro item', async () => {
    const owner = await createUser();
    const item = await createItem(owner.id);

    const few = await request(app)
      .put(`/item/${item.id}`)
      .set('Cookie', sessionCookie(owner.id))
      .field('keepImages', JSON.stringify(['items/a.png']))
      .expect(422);
    expect(few.body.details.join(' ')).toMatch(/de 3 a 8 fotos/);

    await request(app)
      .put(`/item/${item.id}`)
      .set('Cookie', sessionCookie(owner.id))
      .field('keepImages', JSON.stringify(['items/a.png', 'items/b.png', 'items/outro.png']))
      .expect(422);
  });
});
