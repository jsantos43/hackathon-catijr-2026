import type { ErrorRequestHandler } from "express";
import { MulterError } from "multer";
import { ZodError, z } from "zod";
import { AppError } from "../errors/app-error.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Dados inválidos",
      details: z.flattenError(err),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ code: err.code, message: err.message, details: err.details });
    return;
  }

  if (err instanceof MulterError) {
    res.status(400).json({ code: err.code, message: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Erro interno do servidor" });
};
