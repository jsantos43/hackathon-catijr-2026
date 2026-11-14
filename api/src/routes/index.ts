import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const routes = Router();

// Health check + horário do servidor (o relógio que vale é o do servidor, RF16).
routes.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", serverTime: new Date().toISOString() });
});
