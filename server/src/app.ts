import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Env } from "./config/env.js";
import { errorHandler } from "./middleware/errors.js";
import { authRouter } from "./modules/auth/routes.js";
import { inventoryRouter } from "./modules/inventory/routes.js";
import { machinesRouter, type Publish } from "./modules/machines/routes.js";
import { productionRouter } from "./modules/production/routes.js";

export function createApp(env: Env, publish: Publish = () => {}): Express {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRouter(env));
  app.use("/api/inventory", inventoryRouter(env));
  app.use("/api/machines", machinesRouter(env, publish));
  app.use("/api/production", productionRouter(env));

  app.use(errorHandler);
  return app;
}
