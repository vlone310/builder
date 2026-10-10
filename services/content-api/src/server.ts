import { createDb } from "@builder/db";
import { serve } from "@hono/node-server";
import { createContentApp } from "./app";

const jwtSecret = process.env.CONTENT_API_JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("CONTENT_API_JWT_SECRET must be set to at least 32 characters");
}

const { db, close } = createDb();
const port = Number(process.env.PORT ?? 4000);

const server = serve({ fetch: createContentApp({ db, jwtSecret }).fetch, port }, (info) => {
  console.log(`Content API listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void close().then(() => process.exit(0));
  });
}
