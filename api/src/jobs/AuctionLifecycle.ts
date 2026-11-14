import { env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AuctionStatus } from '../generated/prisma/enums.js';
import { db } from '../prisma/db.js';
import Presence from '../services/Presence.js';
import RoomState, { type AuctionForRoom } from '../services/RoomState.js';
import RoomEmitter from '../socket/RoomEmitter.js';

/** Colunas devolvidas pelos UPDATE ... RETURNING abaixo. */
type ChangedAuction = AuctionForRoom & { status: AuctionStatus };

// Lista fixa de colunas (não vem do usuário), por isso pode entrar com Prisma.raw.
const RETURNING = Prisma.raw(`id, "ownerId", status::text AS status, "startingPriceCents",
  "bidCount", "finalPriceCents", "winnerId", "endsAt"`);

/**
 * Abre e fecha os leilões sozinho, pelo relógio do servidor (RF17/RF18).
 *
 * A cada AUCTION_TICK_MS:
 *   - SCHEDULED -> RUNNING quando chega o startsAt: cria o estado da sala no Redis e avisa a sala;
 *   - RUNNING   -> SOLD (com lances) ou ENDED_NO_BIDS no endsAt: apaga o estado do Redis e avisa.
 *
 * Tudo é feito com UPDATE condicional (WHERE status = ...). Se duas instâncias da API rodarem o
 * job ao mesmo tempo, só uma consegue mudar cada leilão, e o RETURNING diz qual foi.
 *
 * Por que lances e fechamento não se atropelam: o lance trava a linha (FOR UPDATE) e pode
 * prorrogar o endsAt. O UPDATE do fechamento espera essa trava e, ao continuar, o PostgreSQL
 * reavalia o WHERE com o endsAt novo, então um leilão recém-prorrogado não é fechado.
 */
class AuctionLifecycle {
  private static timer: NodeJS.Timeout | null = null;
  private static busy = false;

  /**
   * Regra de queda (decisão da equipe). Roda UMA vez na subida, antes do start():
   *   - leilões que estavam Em andamento quando a API caiu viram Cancelados;
   *   - leilões agendados cuja janela inteira passou com a API fora também (ninguém pôde dar
   *     lance neles);
   *   - presença guardada no Redis é apagada (nenhum socket sobreviveu ao reinício).
   *
   * Com AUCTION_CANCEL_RUNNING_ON_BOOT=false (útil em dev), os leilões em andamento continuam,
   * e o estado das salas é recriado no Redis a partir do banco.
   */
  static async recoverFromCrash(now = new Date()) {
    await Presence.clearAll();

    if (!env.AUCTION_CANCEL_RUNNING_ON_BOOT) {
      const running = await db.auction.findMany({
        where: { status: 'RUNNING' },
        select: {
          id: true,
          ownerId: true,
          startingPriceCents: true,
          bidCount: true,
          finalPriceCents: true,
          winnerId: true,
          endsAt: true,
        },
      });
      for (const auction of running) await RoomState.open(auction);
      return [];
    }

    const cancelled = await db.$queryRaw<ChangedAuction[]>`UPDATE "Auction"
          SET status = 'CANCELLED', "updatedAt" = ${now}
        WHERE status = 'RUNNING'
           OR (status = 'SCHEDULED' AND "endsAt" <= ${now})
       RETURNING ${RETURNING}`;

    for (const auction of cancelled) await RoomState.clear(auction.id);
    if (cancelled.length) {
      console.warn(
        `Regra de queda: ${cancelled.length} leilão(ões) interrompido(s) marcado(s) como Cancelado.`,
      );
    }

    return cancelled;
  }

  /** SCHEDULED -> RUNNING para os que já chegaram no horário de início. */
  static async openDue(now = new Date()) {
    const opened = await db.$queryRaw<ChangedAuction[]>`UPDATE "Auction"
          SET status = 'RUNNING', "updatedAt" = ${now}
        WHERE status = 'SCHEDULED' AND "startsAt" <= ${now}
       RETURNING ${RETURNING}`;

    for (const auction of opened) {
      try {
        await RoomState.open(auction);
      } catch (err) {
        // Sem o Redis o leilão funciona do mesmo jeito: o banco decide cada lance sozinho.
        console.error(`Erro ao criar o estado da sala ${auction.id} no Redis`, err);
      }
      RoomEmitter.status(auction);
    }

    return opened;
  }

  /**
   * RUNNING -> SOLD / ENDED_NO_BIDS para os que passaram do endsAt. Durante a disputa,
   * winnerId e finalPriceCents já guardam o líder e o preço, então basta trocar o status.
   */
  static async closeDue(now = new Date()) {
    const closed = await db.$queryRaw<ChangedAuction[]>`UPDATE "Auction"
          SET status = (CASE WHEN "bidCount" > 0 THEN 'SOLD' ELSE 'ENDED_NO_BIDS' END)::"AuctionStatus",
              "winnerId" = CASE WHEN "bidCount" > 0 THEN "winnerId" END,
              "finalPriceCents" = CASE WHEN "bidCount" > 0 THEN "finalPriceCents" END,
              "updatedAt" = ${now}
        WHERE status = 'RUNNING' AND "endsAt" <= ${now}
       RETURNING ${RETURNING}`;

    for (const auction of closed) {
      try {
        await RoomState.clear(auction.id);
      } catch (err) {
        console.error(`Erro ao apagar o estado da sala ${auction.id} do Redis`, err);
      }
      RoomEmitter.status(auction);
    }

    return closed;
  }

  /** Uma rodada do job. Se a anterior ainda não terminou, esta é pulada. */
  static async tick(now = new Date()) {
    if (AuctionLifecycle.busy) return;
    AuctionLifecycle.busy = true;

    try {
      await AuctionLifecycle.openDue(now);
      await AuctionLifecycle.closeDue(now);
    } catch (err) {
      console.error('Erro ao abrir/fechar leilões', err);
    } finally {
      AuctionLifecycle.busy = false;
    }
  }

  static start() {
    if (AuctionLifecycle.timer) return;
    void AuctionLifecycle.tick();
    AuctionLifecycle.timer = setInterval(() => void AuctionLifecycle.tick(), env.AUCTION_TICK_MS);
    AuctionLifecycle.timer.unref();
  }

  static stop() {
    if (AuctionLifecycle.timer) clearInterval(AuctionLifecycle.timer);
    AuctionLifecycle.timer = null;
  }
}

export default AuctionLifecycle;
