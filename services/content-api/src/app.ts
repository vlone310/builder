import type { Db } from "@builder/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "./auth";
import { devLoginRoute } from "./dev-login";
import { type EditTokenSigner, editTokenRoutes, jwksRoute } from "./edit-tokens";
import type { EmailSender } from "./email";
import { ApiError, type AppEnv } from "./http";
import { memberRoutes } from "./members";
import { pageRoutes } from "./pages";
import { publishingRoutes } from "./publishing";
import { type OidcOptions, signInRoutes } from "./sign-in";
import { siteRoutes } from "./sites";

export interface ContentAppOptions {
  db: Db;
  jwtSecret: string;
  editTokens: EditTokenSigner;
  /** Browser origins allowed to call the API (the editor). */
  corsOrigins?: string[];
  /** Mount the passwordless dev login. Never in production. */
  devLogin?: boolean;
  /** The editor's base URL for invite links; defaults to the first CORS origin. */
  editorUrl?: string;
  /** Sign-in with Keycloak (OIDC) under /auth/*. */
  oidc?: OidcOptions;
  /** Sends invite emails; without it invites only return their link. */
  email?: EmailSender;
}

export function createContentApp({
  db,
  jwtSecret,
  editTokens,
  corsOrigins = [],
  devLogin = false,
  oidc,
  email,
  editorUrl = corsOrigins[0] ?? "http://localhost:5173",
}: ContentAppOptions) {
  const app = new Hono<AppEnv>();

  if (corsOrigins.length > 0) {
    app.use(
      "*",
      cors({
        origin: corsOrigins,
        allowHeaders: ["authorization", "content-type"],
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        maxAge: 600,
      }),
    );
  }

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", jwksRoute(editTokens));
  // Which sign-in methods the editor should offer.
  app.get("/auth/providers", (c) =>
    c.json({
      oidc: oidc ? { issuer: oidc.issuer, clientId: oidc.editorClientId } : null,
      devLogin,
    }),
  );
  if (devLogin) app.route("/", devLoginRoute(db, jwtSecret));
  if (oidc) app.route("/", signInRoutes({ db, oidc, jwtSecret }));

  app.use("/v1/*", authMiddleware(jwtSecret));
  app.route("/v1", siteRoutes(db));
  app.route("/v1", pageRoutes(db));
  app.route("/v1", editTokenRoutes(db, editTokens));
  app.route("/v1", publishingRoutes(db));
  app.route("/v1", memberRoutes({ db, editorUrl, email }));

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
