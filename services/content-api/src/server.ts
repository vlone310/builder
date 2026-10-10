import { createDb } from "@builder/db";
import { serve } from "@hono/node-server";
import { createContentApp } from "./app";
import { createEditTokenSigner } from "./edit-tokens";
import { consoleSender, type EmailSender, fileSender, smtpSender } from "./email";

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

const issuer = process.env.KEYCLOAK_ISSUER;
if (!issuer) console.warn("KEYCLOAK_ISSUER is not set; sign-in at /auth/* is off");
const oidc = issuer
  ? {
      issuer,
      audience: process.env.KEYCLOAK_AUDIENCE ?? "builder-content-api",
      editorClientId: process.env.KEYCLOAK_EDITOR_CLIENT_ID ?? "builder-editor",
      jwksUrl: process.env.KEYCLOAK_JWKS_URL || undefined,
    }
  : undefined;

const smtpUrl = process.env.SMTP_URL;
const outboxFile = process.env.EMAIL_OUTBOX_FILE;
if (outboxFile && process.env.NODE_ENV === "production") {
  throw new Error("EMAIL_OUTBOX_FILE is for development and tests only");
}
if (!smtpUrl && !outboxFile) {
  console.warn("SMTP_URL is not set; invite emails go to this log (dev only)");
}
const email: EmailSender = smtpUrl
  ? smtpSender({ url: smtpUrl, from: process.env.EMAIL_FROM ?? "Builder <no-reply@example.com>" })
  : outboxFile
    ? fileSender(outboxFile)
    : consoleSender();

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
  ...(oidc ? { oidc } : {}),
  email,
  ...(process.env.EDITOR_URL ? { editorUrl: process.env.EDITOR_URL } : {}),
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
