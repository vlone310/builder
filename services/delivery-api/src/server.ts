import { createDb } from "@builder/db";
import { serve } from "@hono/node-server";
import { createDeliveryApp } from "./app";

const { db, close } = createDb();
const port = Number(process.env.PORT ?? 4001);

const server = serve({ fetch: createDeliveryApp({ db }).fetch, port }, (info) => {
  console.log(`Delivery API listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void close().then(() => process.exit(0));
  });
}
