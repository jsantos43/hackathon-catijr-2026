import { env } from '../config/env.js';
import { db } from '../prisma/db.js';
import { emitAuctionStatus, type AuctionStatusEvent } from '../socket/index.js';

/**
 * RF17/RF18: abre e fecha leilões sem ninguém intervir.
 *
 * O estado fica só no banco (nada de timers em memória), então reiniciar a API não perde nada:
 * na primeira rodada ela abre o que deveria ter aberto e fecha o que já passou do término.
 *
 * Cada transição é um único UPDATE condicional (WHERE status = ...), então:
 * - fechar duas vezes não duplica o resultado: a segunda vez não encontra mais 'RUNNING';
 * - várias instâncias da API podem rodar este job ao mesmo tempo sem conflito;
 * - um lance que esteja travando a linha (SELECT ... FOR UPDATE) termina antes do fechamento,
 *   e o Postgres reavalia o WHERE com o endsAt já prorrogado. Nunca fecha no meio de um lance.
 */

type Row = AuctionStatusEvent;

// Agendado -> Em andamento, quando chega o início.
const openDue = (now: Date) => db.$queryRaw<Row[]>`
  UPDATE "Auction"
     SET status = 'RUNNING', "updatedAt" = ${now}
   WHERE status = 'SCHEDULED' AND "startsAt" <= ${now}
  RETURNING id, status::text AS status, "endsAt", "winnerId", "finalPriceCents"`;

// Em andamento -> Vendido (maior lance vence) ou Encerrado sem lances, no término vigente.
// Durante a disputa, winnerId/finalPriceCents já guardam o líder e o preço atuais (o lance os
// atualiza), então no fechamento eles simplesmente viram o resultado.
const closeDue = (now: Date) => db.$queryRaw<Row[]>`
  UPDATE "Auction"
     SET status = (CASE WHEN "bidCount" > 0 THEN 'SOLD' ELSE 'ENDED_NO_BIDS' END)::"AuctionStatus",
         "winnerId" = CASE WHEN "bidCount" > 0 THEN "winnerId" END,
         "finalPriceCents" = CASE WHEN "bidCount" > 0 THEN "finalPriceCents" END,
         "updatedAt" = ${now}
   WHERE status = 'RUNNING' AND "endsAt" <= ${now}
  RETURNING id, status::text AS status, "endsAt", "winnerId", "finalPriceCents"`;

let running = false;

export const tick = async () => {
  // Evita duas rodadas sobrepostas se o banco estiver lento.
  if (running) return;
  running = true;

  try {
    const now = new Date();
    // Abre antes de fechar: um leilão que começou e terminou com a API fora do ar
    // passa pelos dois estados na mesma rodada e termina Encerrado sem lances.
    const opened = await openDue(now);
    const closed = await closeDue(now);

    for (const auction of [...opened, ...closed]) emitAuctionStatus(auction);
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
