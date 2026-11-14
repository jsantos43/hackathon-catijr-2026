import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import AuctionLifecycle from './jobs/AuctionLifecycle.js';
import { db } from './prisma/db.js';
import { closeRedis } from './redis/client.js';
import { createSocketServer } from './socket/index.js';
import { ensureBucket } from './utils/storage.js';

/**
 * Ponto de entrada da API. A ordem importa:
 *   1. bucket de fotos;
 *   2. regra de queda (cancela o que estava Em andamento) — ANTES de o job começar a
 *      fechar leilões, senão ele os fecharia como Vendidos;
 *   3. HTTP + Socket.IO;
 *   4. job que abre/fecha leilões.
 */
const httpServer = createServer(app);
const sockets = createSocketServer(httpServer);

await ensureBucket();
await AuctionLifecycle.recoverFromCrash();

httpServer.listen(env.PORT, () => {
  console.log(`API rodando em http://localhost:${env.PORT}`);
  AuctionLifecycle.start();
});

// Desligamento limpo (Ctrl+C, docker stop): para o job, fecha sockets, banco e Redis.
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} recebido, encerrando...`);

  AuctionLifecycle.stop();
  await sockets.close(); // também fecha o servidor HTTP
  await Promise.allSettled([db.$disconnect(), closeRedis()]);
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
