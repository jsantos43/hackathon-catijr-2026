import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { setupSocket } from "./socket/index.js";

const server = createServer(app);
setupSocket(server);

server.listen(env.PORT, () => {
  console.log(`API rodando em http://localhost:${env.PORT}`);
});
