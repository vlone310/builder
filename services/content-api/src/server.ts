import { createDb } from "@builder/db";
import { serve } from "@hono/node-server";
import { createContentApp } from "./app";
import { createEditTokenSigner } from "./edit-tokens";
import { consoleSender, resendSender } from "./email";

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

const signInSecret = process.env.BETTER_AUTH_SECRET;
if (signInSecret !== undefined && signInSecret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
}
if (!signInSecret) console.warn("BETTER_AUTH_SECRET is not set; sign-in at /auth/* is off");
const resendKey = process.env.RESEND_API_KEY;
if (signInSecret && !resendKey) {
  console.warn("RESEND_API_KEY is not set; sign-in and invite emails go to this log (dev only)");
}
const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
    : undefined;

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
  ...(signInSecret
    ? {
        signIn: {
          secret: signInSecret,
          baseUrl: publicUrl,
          email: resendKey
            ? resendSender({
                apiKey: resendKey,
                from: process.env.EMAIL_FROM ?? "Builder <no-reply@example.com>",
              })
            : consoleSender(),
          google,
        },
      }
    : {}),
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
