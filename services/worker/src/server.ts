import { createDb } from "@builder/db";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cloudflarePurger, noopPurger } from "./purge";
import { runOnce, type WorkerOptions } from "./worker";

const { db, close } = createDb();
const port = Number(process.env.PORT ?? 4002);
const pollMs = Number(process.env.WORKER_POLL_MS ?? 2000);
const runSecret = process.env.WORKER_RUN_SECRET;

const purger =
  process.env.CLOUDFLARE_ZONE_ID && process.env.CLOUDFLARE_API_TOKEN
    ? cloudflarePurger({
        zoneId: process.env.CLOUDFLARE_ZONE_ID,
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
      })
    : noopPurger;
const allowPrivateAddresses = process.env.WEBHOOK_ALLOW_PRIVATE === "1";
if (allowPrivateAddresses)
  console.warn("Webhooks may call private addresses (WEBHOOK_ALLOW_PRIVATE=1, dev only)");
console.log(`CDN purger: ${purger.name}`);

const options: WorkerOptions = { db, purger, allowPrivateAddresses, log: console.warn };

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await runOnce(options);
    if (result.claimed > 0) console.log(`outbox: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error("outbox run failed", error);
  } finally {
    running = false;
  }
}

const timer = pollMs > 0 ? setInterval(tick, pollMs) : undefined;

// For hosts without long-running processes: a cron calls POST /run.
const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));
app.post("/run", async (c) => {
  if (!runSecret || c.req.header("authorization") !== `Bearer ${runSecret}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json(await runOnce(options));
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `Worker listening on http://localhost:${info.port}${pollMs > 0 ? `, polling every ${pollMs} ms` : ""}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close();
    void close().then(() => process.exit(0));
  });
}
