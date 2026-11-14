import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { db } from '../prisma/db.js';
import { redis } from '../redis/client.js';
import {
  auctionRoom,
  emitAuctionState,
  emitAuctionStatus,
  io,
  type AuctionStateEvent,
} from '../socket/events.js';
import { INCREMENTS } from '../utils/money.js';
import Auction from './Auction.js';
import { extendEndsAtLua } from './auctionExtension.js';

export type RoomAuction = {
  id: string;
  ownerId: string;
  title: string;
  startingPriceCents: number;
  startsAt: Date;
  originalEndsAt: Date;
  endsAt: Date;
};

type RoomKeys = {
  state: string;
  bids: string;
  participants: string;
  requests: string;
  closing: string;
};

type StoredBid = {
  bidId: string;
  userId: string;
  amountCents: number;
  timeMs: number;
};

type BidResult = {
  ok: boolean;
  code: string;
  duplicate?: boolean;
  minimumBidCents?: number;
  endsAt?: number;
  leaderId?: string | null;
  bidCount?: number;
  extended?: boolean;
  serverTimeMs?: number;
  bid?: StoredBid;
};

const roomKeys = (id: string): RoomKeys => ({
  state: `auction:${id}:state`,
  bids: `auction:${id}:bids`,
  participants: `auction:${id}:participants`,
  requests: `auction:${id}:requests`,
  closing: `auction:${id}:closing`,
});

const BID_SCRIPT = `
local stateKey = KEYS[1]
local bidsKey = KEYS[2]
local participantsKey = KEYS[3]
local requestsKey = KEYS[4]

local requestId = ARGV[1]
local bidId = ARGV[2]
local userId = ARGV[3]
local amount = tonumber(ARGV[4])
local windowMs = tonumber(ARGV[5])
local extensionMs = tonumber(ARGV[6])
local maxExtensionMs = tonumber(ARGV[7])
local increments = cjson.decode(ARGV[8])

${extendEndsAtLua}

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local state = redis.call('HMGET', stateKey, 'status', 'ownerId', 'endsAt', 'originalEndsAt', 'minBidCents', 'highestBidCents', 'leaderId', 'bidCount')
if not state[1] then
  return cjson.encode({ ok = false, code = 'ROOM_NOT_FOUND', serverTimeMs = now })
end

local status = state[1]
local ownerId = state[2]
local endsAt = tonumber(state[3])
local originalEndsAt = tonumber(state[4])
local minimumBidCents = tonumber(state[5])
local highestBidCents = tonumber(state[6])
local leaderId = state[7]
local bidCount = tonumber(state[8])

local existing = redis.call('HGET', requestsKey, requestId)
if existing then
  local previous = cjson.decode(existing)
  previous.duplicate = true
  return cjson.encode(previous)
end

local function reject(code)
  local result = {
    ok = false,
    code = code,
    minimumBidCents = minimumBidCents,
    endsAt = endsAt,
    leaderId = leaderId ~= '' and leaderId or nil,
    bidCount = bidCount,
    serverTimeMs = now
  }
  redis.call('HSET', requestsKey, requestId, cjson.encode(result))
  return cjson.encode(result)
end

if status ~= 'RUNNING' then
  return reject('NOT_RUNNING')
end
if now >= endsAt then
  return reject('ENDED')
end
if userId == ownerId then
  return reject('OWNER_CANNOT_BID')
end
if userId == leaderId then
  return reject('LEADER_CANNOT_BID')
end
if amount == nil or amount ~= math.floor(amount) or amount < minimumBidCents then
  return reject('BELOW_MINIMUM')
end

local newEndsAt, extended = extendEndsAt(now, endsAt, originalEndsAt, windowMs, extensionMs, maxExtensionMs)

local function incrementFor(price)
  for _, pair in ipairs(increments) do
    if price <= tonumber(pair[1]) then
      return tonumber(pair[2])
    end
  end
  return 50000
end

local nextMinimumBidCents = amount + incrementFor(amount)
bidCount = bidCount + 1

redis.call('HSET', stateKey,
  'highestBidCents', amount,
  'leaderId', userId,
  'bidCount', bidCount,
  'minBidCents', nextMinimumBidCents,
  'endsAt', newEndsAt
)

local bid = {
  bidId = bidId,
  userId = userId,
  amountCents = amount,
  timeMs = now
}

redis.call('ZADD', bidsKey, amount, cjson.encode(bid))
redis.call('SADD', participantsKey, userId)

local result = {
  ok = true,
  code = 'ACCEPTED',
  minimumBidCents = nextMinimumBidCents,
  endsAt = newEndsAt,
  leaderId = userId,
  bidCount = bidCount,
  extended = extended,
  serverTimeMs = now,
  bid = bid
}

redis.call('HSET', requestsKey, requestId, cjson.encode(result))
return cjson.encode(result)
`;

const FREEZE_SCRIPT = `
local stateKey = KEYS[1]
local state = redis.call('HMGET', stateKey, 'status', 'bidCount')
if not state[1] then
  return cjson.encode({ ok = true, code = 'NO_ROOM' })
end
if state[1] ~= 'RUNNING' then
  return cjson.encode({ ok = false, code = 'NOT_RUNNING' })
end
local bids = tonumber(state[2]) or 0
if bids > 0 then
  return cjson.encode({ ok = false, code = 'HAS_BIDS', bidCount = bids })
end
redis.call('HSET', stateKey, 'status', 'CANCELLING')
return cjson.encode({ ok = true, code = 'FROZEN' })
`;

const UNFREEZE_SCRIPT = `
local stateKey = KEYS[1]
local status = redis.call('HGET', stateKey, 'status')
if status == 'CANCELLING' then
  redis.call('HSET', stateKey, 'status', 'RUNNING')
end
return cjson.encode({ ok = true })
`;

const rooms = new Map<string, AuctionRoom>();

class AuctionRoom {
  readonly id: string;
  readonly ownerId: string;
  readonly title: string;
  readonly startingPriceCents: number;
  readonly startsAt: Date;
  readonly originalEndsAt: Date;
  private endsAt: Date;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly connections = new Map<string, Set<string>>();

  constructor(auction: RoomAuction) {
    this.id = auction.id;
    this.ownerId = auction.ownerId;
    this.title = auction.title;
    this.startingPriceCents = auction.startingPriceCents;
    this.startsAt = auction.startsAt;
    this.originalEndsAt = auction.originalEndsAt;
    this.endsAt = auction.endsAt;
  }

  static get(id: string) {
    return rooms.get(id);
  }

  static async open(auction: RoomAuction) {
    const existing = rooms.get(auction.id);
    if (existing) return existing;

    const room = new AuctionRoom(auction);
    await room.init();

    const socketIds = io?.sockets.adapter.rooms.get(auctionRoom(auction.id));
    if (socketIds) {
      for (const socketId of socketIds) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket?.data.user?.id) room.addConnection(socket.data.user.id, socketId);
      }
    }

    rooms.set(auction.id, room);
    room.scheduleClose();
    return room;
  }

  static async dispose(id: string, status: string) {
    const room = rooms.get(id);
    if (room) {
      room.closed = true;
      if (room.timer) clearTimeout(room.timer);
      room.connections.clear();
      rooms.delete(id);
    }

    const keys = roomKeys(id);
    const pipeline = redis.pipeline();
    const exists = await redis.exists(keys.state);
    if (exists) pipeline.hset(keys.state, 'status', status);
    for (const key of [keys.state, keys.bids, keys.participants, keys.requests]) {
      pipeline.expire(key, env.REDIS_ROOM_TTL_SECONDS);
    }
    pipeline.del(keys.closing);
    await pipeline.exec();
  }

  static async freezeForCancel(id: string) {
    const raw = (await redis.eval(FREEZE_SCRIPT, 1, roomKeys(id).state)) as string;
    return JSON.parse(raw) as { ok: boolean; code: string; bidCount?: number };
  }

  static async unfreezeForCancel(id: string) {
    await redis.eval(UNFREEZE_SCRIPT, 1, roomKeys(id).state);
  }

  static async closeById(id: string) {
    const room = rooms.get(id);
    if (room) {
      await room.close();
      return;
    }

    const keys = roomKeys(id);
    const state = await redis.hgetall(keys.state);

    if (state.status === 'RUNNING') {
      const endsAt = new Date(Number(state.endsAt));
      if (Date.now() < endsAt.getTime()) return;

      const bidCount = Number(state.bidCount ?? 0);
      const winnerId = bidCount > 0 ? state.leaderId || null : null;
      const finalPriceCents = bidCount > 0 ? Number(state.highestBidCents) : null;
      const status = bidCount > 0 ? 'SOLD' : 'ENDED_NO_BIDS';

      await Auction.onEnded({ auctionId: id, bidCount, winnerId, finalPriceCents });
      await redis.hset(keys.state, 'status', status);
      emitAuctionStatus({ id, status, endsAt, winnerId, finalPriceCents });
      await AuctionRoom.dispose(id, status);
      return;
    }

    const auction = await db.auction.findUnique({
      where: { id },
      select: { status: true, endsAt: true },
    });
    if (!auction || auction.status !== 'RUNNING') return;

    await Auction.onEnded({ auctionId: id, bidCount: 0, winnerId: null, finalPriceCents: null });
    emitAuctionStatus({
      id,
      status: 'ENDED_NO_BIDS',
      endsAt: auction.endsAt,
      winnerId: null,
      finalPriceCents: null,
    });
  }

  addConnection(userId: string, socketId: string) {
    const sockets = this.connections.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.connections.set(userId, sockets);
  }

  removeConnection(userId: string, socketId: string) {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) this.connections.delete(userId);
  }

  async placeBid(input: { userId: string; amountCents: number; requestId: string }) {
    const keys = roomKeys(this.id);
    const raw = (await redis.eval(
      BID_SCRIPT,
      4,
      keys.state,
      keys.bids,
      keys.participants,
      keys.requests,
      input.requestId,
      randomUUID(),
      input.userId,
      String(input.amountCents),
      String(env.AUCTION_EXTENSION_WINDOW_SECONDS * 1000),
      String(env.AUCTION_EXTENSION_SECONDS * 1000),
      String(env.AUCTION_MAX_EXTENSION_SECONDS * 1000),
      JSON.stringify(INCREMENTS),
    )) as string;

    const result = JSON.parse(raw) as BidResult;
    if (result.ok && result.endsAt) {
      this.endsAt = new Date(result.endsAt);
      this.scheduleClose();
    }

    return result;
  }

  async snapshot(): Promise<AuctionStateEvent> {
    const keys = roomKeys(this.id);
    const [state, bidderIds, recent] = await Promise.all([
      redis.hgetall(keys.state),
      redis.smembers(keys.participants),
      redis.zrevrange(keys.bids, 0, env.AUCTION_RECENT_BIDS_LIMIT - 1),
    ]);

    const bidCount = Number(state.bidCount ?? 0);
    const highestBidCents = Number(state.highestBidCents ?? 0);
    const bidders = new Set(bidderIds);
    let participants = 0;
    let spectators = 0;
    for (const userId of this.connections.keys()) {
      if (bidders.has(userId)) participants += 1;
      else spectators += 1;
    }

    return {
      auctionId: this.id,
      status: state.status ?? 'RUNNING',
      title: state.title ?? this.title,
      startsAt: new Date(Number(state.startsAt)).toISOString(),
      originalEndsAt: new Date(Number(state.originalEndsAt)).toISOString(),
      endsAt: new Date(Number(state.endsAt)).toISOString(),
      currentPriceCents: bidCount > 0 ? highestBidCents : this.startingPriceCents,
      minimumBidCents: Number(state.minBidCents ?? this.startingPriceCents),
      leaderId: state.leaderId || null,
      bidCount,
      participants,
      spectators,
      recentBids: recent.map((member: string) => {
        const bid = JSON.parse(member) as StoredBid;
        return {
          bidId: bid.bidId,
          userId: bid.userId,
          amountCents: bid.amountCents,
          at: new Date(bid.timeMs).toISOString(),
        };
      }),
      serverTime: new Date().toISOString(),
    };
  }

  private async init() {
    const keys = roomKeys(this.id);
    await redis
      .pipeline()
      .del(keys.state, keys.bids, keys.participants, keys.requests, keys.closing)
      .hset(keys.state, {
        status: 'RUNNING',
        ownerId: this.ownerId,
        title: this.title,
        startsAt: String(this.startsAt.getTime()),
        originalEndsAt: String(this.originalEndsAt.getTime()),
        endsAt: String(this.endsAt.getTime()),
        startingPriceCents: String(this.startingPriceCents),
        highestBidCents: '0',
        leaderId: '',
        bidCount: '0',
        minBidCents: String(this.startingPriceCents),
      })
      .exec();
  }

  private scheduleClose(delayMs?: number) {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);

    const delay = delayMs ?? this.endsAt.getTime() - Date.now();
    if (delay <= 0) {
      void this.close();
      return;
    }

    this.timer = setTimeout(() => void this.close(), Math.min(delay, 2_147_483_000));
    this.timer.unref();
  }

  private async close() {
    if (this.closed) return;

    const keys = roomKeys(this.id);
    const state = await redis.hgetall(keys.state);
    if (!state.status || state.status !== 'RUNNING') {
      await this.teardown(state.status ?? 'CANCELLED');
      return;
    }

    const endsAt = new Date(Number(state.endsAt));
    if (Date.now() < endsAt.getTime()) {
      this.endsAt = endsAt;
      this.scheduleClose();
      return;
    }

    const locked = await redis.set(keys.closing, '1', 'EX', 30, 'NX');
    if (!locked) return;

    const bidCount = Number(state.bidCount ?? 0);
    const winnerId = bidCount > 0 ? state.leaderId || null : null;
    const finalPriceCents = bidCount > 0 ? Number(state.highestBidCents) : null;
    const status = bidCount > 0 ? 'SOLD' : 'ENDED_NO_BIDS';

    try {
      await Auction.onEnded({ auctionId: this.id, bidCount, winnerId, finalPriceCents });
      await redis.hset(keys.state, 'status', status);
      this.endsAt = endsAt;
      const snapshot = await this.snapshot();
      emitAuctionStatus({ id: this.id, status, endsAt, winnerId, finalPriceCents });
      emitAuctionState(snapshot);
      await this.teardown(status);
    } catch (err) {
      console.error(`Erro ao encerrar o leilão ${this.id}`, err);
      await redis.del(keys.closing);
      this.scheduleClose(5000);
    }
  }

  private async teardown(status: string) {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.connections.clear();
    rooms.delete(this.id);

    const keys = roomKeys(this.id);
    const pipeline = redis.pipeline();
    pipeline.hset(keys.state, 'status', status);
    for (const key of [keys.state, keys.bids, keys.participants, keys.requests]) {
      pipeline.expire(key, env.REDIS_ROOM_TTL_SECONDS);
    }
    pipeline.del(keys.closing);
    await pipeline.exec();
  }
}

export default AuctionRoom;
