import type { Db } from "@builder/db";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "./auth";
import { ApiError, type AppEnv } from "./http";
import { pageRoutes } from "./pages";
import { siteRoutes } from "./sites";

export interface ContentAppOptions {
  db: Db;
  jwtSecret: string;
}

export function createContentApp({ db, jwtSecret }: ContentAppOptions) {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ ok: true }));
  app.use("/v1/*", authMiddleware(jwtSecret));
  app.route("/v1", siteRoutes(db));
  app.route("/v1", pageRoutes(db));

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { error: { code: error.code, message: error.message, details: error.details } },
        error.status,
      );
    }
    if (error instanceof HTTPException) {
      return c.json({ error: { code: "error", message: error.message } }, error.status);
    }
    console.error(error);
    return c.json({ error: { code: "internal", message: "Internal error" } }, 500);
  });

  return app;
}
