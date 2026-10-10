import { createDb } from "@builder/db";
import { serve } from "@hono/node-server";
import { createContentApp } from "./app";
import { createEditTokenSigner } from "./edit-tokens";

const jwtSecret = process.env.CONTENT_API_JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("CONTENT_API_JWT_SECRET must be set to at least 32 characters");
}

const port = Number(process.env.PORT ?? 4000);
const publicUrl = process.env.CONTENT_API_PUBLIC_URL ?? `http://localhost:${port}`;
const devLogin = process.env.CONTENT_API_DEV_LOGIN === "1";

if (!process.env.EDIT_TOKEN_PRIVATE_JWK) {
  console.warn("EDIT_TOKEN_PRIVATE_JWK is not set; using an ephemeral key (dev only)");
}
if (devLogin) console.warn("Dev login is enabled at POST /auth/dev-login (dev only)");

const editTokens = await createEditTokenSigner({
  issuer: publicUrl,
  ...(process.env.EDIT_TOKEN_PRIVATE_JWK ? { privateJwk: process.env.EDIT_TOKEN_PRIVATE_JWK } : {}),
});

const { db, close } = createDb();
const app = createContentApp({
  db,
  jwtSecret,
  editTokens,
  devLogin,
  corsOrigins: (process.env.EDITOR_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Content API listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void close().then(() => process.exit(0));
  });
}
