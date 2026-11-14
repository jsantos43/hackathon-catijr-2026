import { env } from '../config/env.js';
import { db } from '../prisma/db.js';
import AuctionRoom, { type RoomAuction } from '../services/AuctionRoom.js';
import {
  emitAuctionState,
  emitAuctionStatus,
  type AuctionStatusEvent,
} from '../socket/events.js';

type OpenedRow = RoomAuction;
type ClosedRow = AuctionStatusEvent;

const cancelActiveOnStartup = (now: Date) => db.$queryRaw<ClosedRow[]>`
  UPDATE "Auction"
     SET status = 'CANCELLED', "updatedAt" = ${now}
   WHERE status IN ('SCHEDULED', 'RUNNING')
     AND (
       status = 'RUNNING'
       OR ("startsAt" <= ${now} AND "endsAt" > ${now})
     )
  RETURNING id, status::text AS status, "endsAt", "winnerId", "finalPriceCents"`;

const openDue = (now: Date) => db.$queryRaw<OpenedRow[]>`
  UPDATE "Auction"
     SET status = 'RUNNING', "updatedAt" = ${now}
   WHERE status = 'SCHEDULED' AND "startsAt" <= ${now}
  RETURNING id, "ownerId", title, "startingPriceCents", "startsAt", "originalEndsAt", "endsAt"`;

const dueRooms = (now: Date) => db.$queryRaw<Array<{ id: string }>>`
  SELECT id FROM "Auction"
   WHERE status = 'RUNNING' AND "endsAt" <= ${now}`;

let running = false;
let reconciled = false;

const reconcile = async (now: Date) => {
  const cancelled = await cancelActiveOnStartup(now);

  for (const auction of cancelled) {
    await AuctionRoom.dispose(auction.id, 'CANCELLED');
    emitAuctionStatus(auction);
  }

  reconciled = true;
};

export const tick = async () => {
  if (running) return;
  running = true;

  try {
    const now = new Date();
    if (!reconciled) await reconcile(now);

    const opened = await openDue(now);
    for (const auction of opened) {
      try {
        const room = await AuctionRoom.open(auction);
        emitAuctionState(await room.snapshot());
      } catch (err) {
        console.error(`Erro ao abrir a sala do leilão ${auction.id}`, err);
      }
      emitAuctionStatus({
        id: auction.id,
        status: 'RUNNING',
        endsAt: auction.endsAt,
        winnerId: null,
        finalPriceCents: null,
      });
    }

    for (const { id } of await dueRooms(now)) {
      try {
        await AuctionRoom.closeById(id);
      } catch (err) {
        console.error(`Erro ao fechar o leilão ${id}`, err);
      }
    }
  } catch (err) {
    console.error('Erro ao abrir/fechar leilões', err);
  } finally {
    running = false;
  }
};

export const startAuctionLifecycle = () => {
  void tick();
  const timer = setInterval(() => void tick(), env.AUCTION_TICK_MS);
  timer.unref();
  return timer;
};
