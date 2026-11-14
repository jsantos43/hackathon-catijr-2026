import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { startAuctionLifecycle } from "./jobs/auctionLifecycle.js";
import { setupSocket } from "./socket/index.js";
import { ensureBucket } from "./utils/storage.js";

const server = createServer(app);
setupSocket(server);

await ensureBucket();

server.listen(env.PORT, () => {
  console.log(`API rodando em http://localhost:${env.PORT}`);
  startAuctionLifecycle();
});
