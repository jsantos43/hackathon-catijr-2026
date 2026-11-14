import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import AuctionLifecycle from '../../src/jobs/AuctionLifecycle.js';
import type { BidOutcome } from '../../src/services/Bid.js';
import type { BidEvent, JoinAck, PresenceEvent, StatusEvent } from '../../src/socket/contract.js';
import { createSocketServer } from '../../src/socket/index.js';
import { createRunningAuction, createUser, newKey, resetState, sessionCookie } from '../helpers/factories.js';

let httpServer: HttpServer;
let closeSockets: () => Promise<void>;
let url: string;
const clients: Socket[] = [];

beforeAll(async () => {
  httpServer = createServer(app);
  closeSockets = createSocketServer(httpServer).close;
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await closeSockets();
});

beforeEach(resetState);

afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});

/** Abre um "navegador" conectado com o cookie de sessão do usuário. */
const open = (cookie?: string) =>
  new Promise<Socket>((resolve, reject) => {
    const client = connect(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: cookie ? { cookie } : {},
    });
    clients.push(client);
    client.on('connect', () => resolve(client));
    client.on('connect_error', reject);
  });

const join = (client: Socket, auctionId: string, role?: 'participant' | 'spectator') =>
  client.timeout(3000).emitWithAck('auction:join', { auctionId, role }) as Promise<JoinAck>;

const bid = (client: Socket, auctionId: string, amountCents: number, idempotencyKey = newKey()) =>
  client.timeout(3000).emitWithAck('auction:bid', { auctionId, amountCents, idempotencyKey }) as Promise<BidOutcome>;

/** Espera o próximo evento que satisfaça a condição. */
const next = <T>(client: Socket, event: string, match: (e: T) => boolean = () => true) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${event}`)), 3000);
    const handler = (e: T) => {
      if (!match(e)) return;
      clearTimeout(timer);
      client.off(event, handler);
      resolve(e);
    };
    client.on(event, handler);
  });

describe('Socket.IO — sala ao vivo', () => {
  it('recusa conexão sem sessão', async () => {
    await expect(open()).rejects.toThrow('UNAUTHORIZED');
  });

  it('ao entrar, devolve o snapshot da sala (leilão, lances, presença)', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const auction = await createRunningAuction(owner.id);
    const client = await open(sessionCookie(viewer.id));

    const ack = await join(client, auction.id);

    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.role).toBe('participant');
    expect(ack.snapshot.auction).toMatchObject({ id: auction.id, status: 'RUNNING', minimumBidCents: 100_00 });
    expect(ack.snapshot.bids).toEqual([]);
    expect(ack.snapshot.presence).toMatchObject({ participants: 1, spectators: 0 });
  });

  it('lance aceito: ack para quem deu e evento auction:bid para toda a sala', async () => {
    const owner = await createUser();
    const marina = await createUser('Marina Torres');
    const auction = await createRunningAuction(owner.id);
    const ownerClient = await open(sessionCookie(owner.id));
    const marinaClient = await open(sessionCookie(marina.id));
    await join(ownerClient, auction.id);
    await join(marinaClient, auction.id);

    const seenByOwner = next<BidEvent>(ownerClient, 'auction:bid');
    const ack = await bid(marinaClient, auction.id, 100_00);
    const event = await seenByOwner;

    expect(ack).toMatchObject({ ok: true, auction: { finalPriceCents: 100_00, minimumBidCents: 105_00 } });
    expect(event).toMatchObject({
      auctionId: auction.id,
      priceCents: 100_00,
      minimumBidCents: 105_00,
      leaderId: marina.id,
      bidCount: 1,
      extended: false,
      bid: { bidderName: 'Marina T.', amountCents: 100_00 },
    });
  });

  it('lance recusado volta só no ack, com o mínimo vigente', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id);
    const client = await open(sessionCookie(bidder.id));
    await join(client, auction.id);

    const ack = await bid(client, auction.id, 50_00);

    expect(ack).toMatchObject({ ok: false, error: 'BID_TOO_LOW', minimumBidCents: 100_00 });
  });

  it('não aceita lance de quem não entrou na sala', async () => {
    const owner = await createUser();
    const auction = await createRunningAuction(owner.id);
    const client = await open(sessionCookie((await createUser()).id));

    expect(await bid(client, auction.id, 100_00)).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
  });

  it('não aceita lance depois do logout, mesmo com o socket aberto', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id);
    const client = await open(sessionCookie(bidder.id));
    await join(client, auction.id);

    const { default: Auth } = await import('../../src/services/Auth.js');
    await Auth.logout(bidder.id, 0);

    expect(await bid(client, auction.id, 100_00)).toMatchObject({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('payload inválido é recusado', async () => {
    const client = await open(sessionCookie((await createUser()).id));
    const ack = (await client.timeout(3000).emitWithAck('auction:bid', { amountCents: 'muito' })) as BidOutcome;
    expect(ack).toMatchObject({ ok: false, error: 'INVALID_PAYLOAD' });
  });

  it('presença: comitente conta como espectador; trocar de papel atualiza a sala', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const auction = await createRunningAuction(owner.id);
    const ownerClient = await open(sessionCookie(owner.id));
    const viewerClient = await open(sessionCookie(viewer.id));

    const ownerAck = await join(ownerClient, auction.id, 'participant');
    expect(ownerAck.ok && ownerAck.role).toBe('spectator');
    await join(viewerClient, auction.id);

    const update = next<PresenceEvent>(ownerClient, 'auction:presence', (e) => e.spectators === 2);
    await viewerClient.timeout(3000).emitWithAck('auction:role', { auctionId: auction.id, role: 'spectator' });
    expect(await update).toMatchObject({ participants: 0, spectators: 2 });

    const afterLeave = next<PresenceEvent>(ownerClient, 'auction:presence', (e) => e.spectators === 1);
    viewerClient.disconnect();
    expect(await afterLeave).toMatchObject({ participants: 0, spectators: 1 });
  });

  it('quando o leilão fecha, a sala recebe auction:status com o vencedor', async () => {
    const owner = await createUser();
    const bidder = await createUser();
    const auction = await createRunningAuction(owner.id, { endsAt: new Date(Date.now() + 5 * 60_000) });
    const client = await open(sessionCookie(bidder.id));
    await join(client, auction.id);
    await bid(client, auction.id, 100_00);

    const closed = next<StatusEvent>(client, 'auction:status');
    await AuctionLifecycle.closeDue(new Date(Date.now() + 6 * 60_000));

    expect(await closed).toMatchObject({
      auctionId: auction.id,
      status: 'SOLD',
      winnerId: bidder.id,
      finalPriceCents: 100_00,
    });
  });
});
