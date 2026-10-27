import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { isProd } from "../config/env.js";
import { AppError } from "../lib/http.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found` });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ message: err.message, details: err.details });
    return;
  }

  // Duplicate key (unique index) from Mongo
  if (typeof err === "object" && err && "code" in err && (err as { code: number }).code === 11000) {
    const fields = Object.keys((err as { keyValue?: object }).keyValue ?? {});
    res.status(409).json({ message: `${fields.join(", ") || "Value"} already exists`, details: { fields } });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, [v.message]]));
    res.status(400).json({ message: "Validation failed", details });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ message: `Invalid ${err.path}` });
    return;
  }

  console.error(err);
  res.status(500).json({ message: isProd ? "Internal server error" : String((err as Error)?.message ?? err) });
}
