import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import ErrorHandler from '../../src/middlewares/ErrorHandler.js';
import RateLimit from '../../src/middlewares/RateLimit.js';
import { PASSWORD, resetState } from '../helpers/factories.js';

beforeEach(resetState);

describe('Cadastro, login e sessão', () => {
  it('cadastra, entra, lê a própria conta e sai', async () => {
    const agent = request.agent(app);

    await agent
      .post('/user')
      .send({ name: 'Marina Torres', email: 'Marina@Teste.com', password: PASSWORD })
      .expect(201);

    const login = await agent.post('/auth/login').send({ email: 'marina@teste.com', password: PASSWORD }).expect(200);
    expect(String(login.headers['set-cookie'])).toMatch(/accessToken=.*HttpOnly/i);

    const me = await agent.get('/user').expect(200);
    expect(me.body.user).toMatchObject({ name: 'Marina Torres', email: 'marina@teste.com' });

    await agent.post('/auth/logout').expect(200);
    await agent.get('/user').expect(401);
  });

  it('não diz se foi o e-mail ou a senha que errou', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'ninguem@teste.com', password: 'x' }).expect(401);
    expect(res.body.details).toEqual(['Email or password is invalid']);
  });

  it('e-mail repetido responde 409', async () => {
    const body = { name: 'Ana', email: 'ana@teste.com', password: PASSWORD };
    await request(app).post('/user').send(body).expect(201);
    await request(app).post('/user').send(body).expect(409);
  });

  it('rota inexistente responde 404 com "Route ..." (o front usa isso)', async () => {
    const res = await request(app).get('/nao-existe').expect(404);
    expect(res.body.details).toEqual(['Route GET /nao-existe not found']);
  });
});

describe('RateLimit.byIp', () => {
  it('responde 429 depois do limite, com Retry-After', async () => {
    const mini = express();
    mini.get('/x', RateLimit.byIp({ scope: 'teste', max: 2, windowSeconds: 60 }), (_req, res) => {
      res.json({ ok: true });
    });
    mini.use(ErrorHandler.handle);

    await request(mini).get('/x').expect(200);
    await request(mini).get('/x').expect(200);
    const blocked = await request(mini).get('/x').expect(429);

    expect(blocked.body.error).toBe('TOO_MANY_REQUESTS');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
