import { env } from '../config/env.js';
import { db } from '../prisma/db.js';
import Presence from '../services/Presence.js';
import RoomState from '../services/RoomState.js';
import Settlement, { RETURNING, type ChangedAuction } from '../services/Settlement.js';
import RoomEmitter from '../socket/RoomEmitter.js';

/** Uma sala aberta há mais que isso e sem estado no Redis foi perdida (ver reconcile). */
const RECONCILE_GRACE_MS = 10_000;
/** De quantas em quantas rodadas o reconcile roda. */
const RECONCILE_EVERY_TICKS = 5;

/**
 * Abre e fecha os leilões sozinho, pelo relógio do servidor (RF17/RF18).
 *
 * O PostgreSQL só é tocado nas pontas da disputa:
 *   - abertura: SCHEDULED -> RUNNING (UPDATE condicional) e a sala é criada no Redis;
 *   - fechamento: o job pega no Redis as salas cujo prazo passou (ZSET rooms:deadlines),
 *     reivindica cada uma com um script atômico (RUNNING -> CLOSING) e chama o Settlement,
 *     que grava lances e resultado numa transação e apaga a sala.
 *
 * Com várias instâncias da API rodando o job: o UPDATE condicional da abertura só funciona
 * para uma; a reivindicação no Redis é atômica; o settle tem trava e é idempotente.
 */
class AuctionLifecycle {
  private static timer: NodeJS.Timeout | null = null;
  private static busy = false;
  private static ticks = 0;

  /**
   * Regra de queda. Roda UMA vez na subida, antes do start().
   *
   *  1. Presença guardada no Redis é apagada (nenhum socket sobreviveu ao reinício).
   *  2. Salas que já tinham sido decididas antes da queda (CLOSING/CANCELLED no Redis) são
   *     gravadas normalmente: o término delas chegou com o serviço no ar.
   *  3. Todo leilão cuja janela já começou (startsAt <= agora) e que não foi finalizado vira
   *     Cancelado — estava (ou deveria estar) em execução enquanto o serviço estava fora.
   *     Isso inclui os Em andamento e os Agendados cujo início caiu durante a queda.
   *     Os lances que estavam no Redis são gravados para o histórico, sem vencedor.
   *
   * Com AUCTION_CANCEL_RUNNING_ON_BOOT=false (útil em dev, onde o tsx watch reinicia a API a
   * cada arquivo salvo) o passo 3 não roda: as salas continuam do ponto em que estavam no Redis.
   */
  static async recoverFromCrash(now = new Date()): Promise<ChangedAuction[]> {
    await Presence.clearAll();

    for (const id of await RoomState.allRoomIds()) {
      const state = await RoomState.get(id);
      if (state && state.status !== 'RUNNING') await Settlement.settle(id);
    }

    if (!env.AUCTION_CANCEL_RUNNING_ON_BOOT) return [];

    const interrupted = await db.auction.findMany({
      where: { status: { in: ['RUNNING', 'SCHEDULED'] }, startsAt: { lte: now } },
      select: { id: true },
    });

    const cancelled: ChangedAuction[] = [];
    for (const { id } of interrupted) {
      const row = (await RoomState.exists(id))
        ? await AuctionLifecycle.cancelRoom(id, now)
        : await AuctionLifecycle.cancelWithoutRoom(id, now, ['RUNNING', 'SCHEDULED']);
      if (row) cancelled.push(row);
    }

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
        // Sem a sala no Redis não há disputa: o reconcile cancela o leilão.
        console.error(`Erro ao criar a sala ${auction.id} no Redis`, err);
      }
      RoomEmitter.status(auction);
    }

    return opened;
  }

  /**
   * Fecha as salas cujo término (com prorrogações) passou: reivindica no Redis e grava no
   * PostgreSQL. Devolve os leilões que mudaram de estado.
   */
  static async closeDue(now = new Date()) {
    const closed: ChangedAuction[] = [];

    for (const id of await RoomState.dueRooms(now.getTime())) {
      try {
        const claim = await RoomState.claimClose(id, now.getTime());
        if (claim !== 'CLOSE') continue;
        const row = await Settlement.settle(id);
        if (row) closed.push(row);
      } catch (err) {
        // A sala fica como está (CLOSING) e a próxima rodada tenta de novo.
        console.error(`Erro ao fechar o leilão ${id}`, err);
      }
    }

    return closed;
  }

  /**
   * Leilões Em andamento no PostgreSQL cuja sala não existe no Redis (o Redis reiniciou sem
   * persistência, ou a criação da sala falhou): sem os lances não há como decidir o vencedor,
   * então são cancelados. Também recoloca no índice de prazos as salas que estiverem fora dele.
   */
  static async reconcile(now = new Date()) {
    const running = await db.auction.findMany({
      where: { status: 'RUNNING', updatedAt: { lt: new Date(now.getTime() - RECONCILE_GRACE_MS) } },
      select: { id: true },
    });

    const cancelled: ChangedAuction[] = [];
    for (const { id } of running) {
      const state = await RoomState.get(id);
      if (state) {
        // Já decidida (ex.: o settle falhou): tenta gravar de novo. Senão só corrige o índice.
        if (state.status !== 'RUNNING') await Settlement.settle(id);
        else await RoomState.claimClose(id, 0); // NOT_DUE -> ZADD com o término atual
        continue;
      }
      const row = await AuctionLifecycle.cancelWithoutRoom(id, now, ['RUNNING']);
      if (row) {
        console.warn(`Leilão ${id} sem sala no Redis: marcado como Cancelado.`);
        cancelled.push(row);
      }
    }
    return cancelled;
  }

  /** Cancela uma sala que está no Redis (forçado) e grava o resultado. */
  private static async cancelRoom(id: string, now: Date) {
    await RoomState.cancel(id, now.getTime(), true);
    return Settlement.settle(id);
  }

  private static async cancelWithoutRoom(id: string, now: Date, from: ('RUNNING' | 'SCHEDULED')[]) {
    const [row] = await db.$queryRaw<ChangedAuction[]>`UPDATE "Auction"
          SET status = 'CANCELLED', "updatedAt" = ${now}
        WHERE id = ${id}::uuid AND status::text = ANY(${from})
       RETURNING ${RETURNING}`;
    if (row) RoomEmitter.status(row);
    return row ?? null;
  }

  /** Uma rodada do job. Se a anterior ainda não terminou, esta é pulada. */
  static async tick(now = new Date()) {
    if (AuctionLifecycle.busy) return;
    AuctionLifecycle.busy = true;

    try {
      await AuctionLifecycle.openDue(now);
      await AuctionLifecycle.closeDue(now);
      AuctionLifecycle.ticks += 1;
      if (AuctionLifecycle.ticks % RECONCILE_EVERY_TICKS === 0) await AuctionLifecycle.reconcile(now);
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
