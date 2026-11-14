import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { routes } from "./routes/index.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(","), credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.use("/api", routes);

app.use((_req, res) => {
  res.status(404).json({ code: "NOT_FOUND", message: "Rota não encontrada" });
});

app.use(errorHandler);
