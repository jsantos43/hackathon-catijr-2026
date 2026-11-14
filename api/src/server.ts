import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { ensureBucket } from "./lib/storage.js";
import { setupSocket } from "./socket/index.js";

await ensureBucket();

const server = createServer(app);
const io = setupSocket(server);

server.listen(env.PORT, () => {
  console.log(`API rodando em http://localhost:${env.PORT}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} recebido, encerrando...`);
  io.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
