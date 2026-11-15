import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { AuctionStatus } from '../generated/prisma/enums.js';
import { db } from '../prisma/db.js';
import RoomEmitter from '../socket/RoomEmitter.js';
import RoomState from './RoomState.js';

/** Colunas devolvidas pelo UPDATE ... RETURNING (o suficiente para avisar a sala). */
export type ChangedAuction = {
  id: string;
  ownerId: string;
  status: AuctionStatus;
  startingPriceCents: number;
  bidCount: number;
  finalPriceCents: number | null;
  winnerId: string | null;
  endsAt: Date;
  originalEndsAt: Date;
};

// Lista fixa de colunas (não vem do usuário), por isso pode entrar com Prisma.raw.
export const RETURNING = Prisma.raw(`id, "ownerId", status::text AS status, "startingPriceCents",
  "bidCount", "finalPriceCents", "winnerId", "endsAt", "originalEndsAt"`);

/**
 * Fechamento: o ÚNICO momento em que a disputa vai para o PostgreSQL.
 *
 * Pré-condição: a sala no Redis já saiu de RUNNING (CLOSING pelo job, ou CANCELLED). A partir
 * daí o script de lance recusa tudo, então a lista de lances está congelada e pode ser lida
 * sem pressa.
 *
 * Passos:
 *  1. trava curta no Redis (SET NX PX) — com várias instâncias, só uma grava a sala;
 *  2. UMA transação no PostgreSQL: insere todos os lances (skipDuplicates: o id do lance e o
 *     índice único (bidderId, idempotencyKey) tornam a reexecução inofensiva) e grava o
 *     resultado com UPDATE ... WHERE status = 'RUNNING' (só a primeira execução muda o leilão);
 *  3. só DEPOIS do COMMIT apaga a sala do Redis.
 *
 * Se o processo morrer entre 2 e 3, a sala continua no Redis como CLOSING/CANCELLED e a próxima
 * rodada do job (ou a subida da API) repete o settle — que é idempotente. Nada se perde e nada
 * é gravado duas vezes.
 */
class Settlement {
  static async settle(auctionId: string): Promise<ChangedAuction | null> {
    const token = randomUUID();
    if (!(await RoomState.lockSettle(auctionId, token))) return null;

    try {
      const state = await RoomState.get(auctionId);
      if (!state || state.status === 'RUNNING') return null;

      const bids = await RoomState.allBids(auctionId);
      const sold = state.status === 'CLOSING' && bids.length > 0;
      const status =
        state.status === 'CANCELLED'
          ? AuctionStatus.CANCELLED
          : sold
            ? AuctionStatus.SOLD
            : AuctionStatus.ENDED_NO_BIDS;
      const winnerId = sold ? state.leaderId : null;
      const finalPriceCents = sold ? state.priceCents : null;

      const updated = await db.$transaction(async (tx) => {
        if (bids.length) {
          await tx.bid.createMany({
            data: bids.map((b) => ({
              id: b.id,
              auctionId,
              bidderId: b.bidderId,
              amountCents: b.amountCents,
              idempotencyKey: b.idempotencyKey,
              createdAt: new Date(b.createdAt),
            })),
            skipDuplicates: true,
          });
        }

        const [row] = await tx.$queryRaw<ChangedAuction[]>`UPDATE "Auction"
              SET status = ${status}::"AuctionStatus",
                  "bidCount" = ${bids.length},
                  "winnerId" = ${winnerId}::uuid,
                  "finalPriceCents" = ${finalPriceCents}::int,
                  "endsAt" = ${state.endsAt},
                  "updatedAt" = ${new Date()}
            WHERE id = ${auctionId}::uuid AND status = 'RUNNING'
           RETURNING ${RETURNING}`;
        return row ?? null;
      });

      await RoomState.destroy(auctionId);
      if (updated) RoomEmitter.status(updated);
      return updated;
    } finally {
      await RoomState.unlockSettle(auctionId, token);
    }
  }
}

export default Settlement;
