import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import { env, isProd } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { categoriesRouter, profileNamesRouter } from "./modules/lookups/lookup.routes.js";
import { meRouter } from "./modules/me/me.routes.js";
import { projectsRouter } from "./modules/projects/projects.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { clientsRouter } from "./modules/clients/clients.routes.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(morgan(isProd ? "combined" : "dev"));

  // Responses can contain decrypted credentials: never let browsers or proxies cache them.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, db: mongoose.connection.readyState === 1 ? "up" : "down" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/me", meRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/profile-names", profileNamesRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/clients", clientsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
