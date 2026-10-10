import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { verifyWebhookSignature } from "@builder/core";
import {
  createDb,
  type DbHandle,
  enqueuePageEvent,
  jobs,
  newId,
  orgs,
  runMigrations,
  sites,
  webhooks,
  withOrg,
} from "@builder/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isPrivateAddress } from "./network";
import type { CdnPurger } from "./purge";
import { backoffMs, runOnce } from "./worker";

const url = process.env.TEST_DATABASE_URL;

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("backoffMs", () => {
  it("doubles from 10 s and caps at an hour", () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 20].map((n) => backoffMs(n, mid))).toEqual([
      10_000, 20_000, 40_000, 3_600_000,
    ]);
  });
});

describe.skipIf(!url)("runOnce", () => {
  let handle: DbHandle;
  let server: Server;
  let endpoint: string;
  let respondWith = 200;
  const received: Array<{
    body: string;
    signature: string | undefined;
    delivery: string | undefined;
  }> = [];
  const purged: string[][] = [];
  const purger: CdnPurger = { name: "test", purgeTags: async (tags) => void purged.push(tags) };
  const orgId = newId("org");
  const siteId = newId("st");
  const secret = "whsec_test";
  const page = { id: "pg_x", siteId, kind: "page" as const, locale: "en", slug: "/x" };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => resolve(body));
    });

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    server = createServer(async (req, res) => {
      received.push({
        body: await readBody(req),
        signature: req.headers["builder-signature"] as string | undefined,
        delivery: req.headers["builder-delivery"] as string | undefined,
      });
      res.statusCode = respondWith;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    await withOrg(handle.db, orgId, async (tx) => {
      await tx.insert(orgs).values({ id: orgId, name: "Org" });
      await tx.insert(sites).values({ id: siteId, orgId, name: "Site" });
      await tx.insert(webhooks).values({
        id: newId("wh"),
        orgId,
        siteId,
        url: endpoint,
        secret,
        events: ["page.published"],
      });
    });
  });

  beforeEach(async () => {
    received.length = 0;
    purged.length = 0;
    respondWith = 200;
    // Other suites share the test database: touch only this org's outbox.
    await handle.db.delete(jobs).where(eq(jobs.orgId, orgId));
  });

  afterAll(async () => {
    await withOrg(handle.db, orgId, (tx) => tx.delete(orgs).where(eq(orgs.id, orgId)));
    await handle.close();
    server.close();
  });

  const publish = () =>
    withOrg(handle.db, orgId, (tx) =>
      enqueuePageEvent(tx, { orgId, event: "page.published", page, revisionId: "rev_1" }),
    );

  it("delivers a signed webhook and purges the CDN", async () => {
    await publish();
    const result = await runOnce({ db: handle.db, purger, allowPrivateAddresses: true, orgId });
    expect(result).toEqual({ claimed: 2, succeeded: 2, retried: 0, failed: 0 });
    expect(received).toHaveLength(1);
    const delivery = received[0];
    expect(JSON.parse(delivery?.body ?? "")).toMatchObject({
      type: "page.published",
      page: { id: "pg_x" },
    });
    expect(await verifyWebhookSignature(secret, delivery?.signature, delivery?.body ?? "")).toBe(
      true,
    );
    expect(purged).toEqual([
      ["builder:page:pg_x", `builder:slug:${siteId}:en:/x`, `builder:site:${siteId}`],
    ]);
    const rows = await handle.db.select().from(jobs).where(eq(jobs.orgId, orgId));
    expect(rows.every((row) => row.status === "succeeded")).toBe(true);
    expect(rows.find((row) => row.kind === "webhook")?.lastStatusCode).toBe(200);
    // Nothing left to do.
    expect(
      (await runOnce({ db: handle.db, purger, allowPrivateAddresses: true, orgId })).claimed,
    ).toBe(0);
  });

  it("retries with backoff and gives up after max attempts", async () => {
    respondWith = 503;
    await publish();
    await handle.db.update(jobs).set({ maxAttempts: 2 }).where(eq(jobs.orgId, orgId));
    const first = await runOnce({ db: handle.db, purger, allowPrivateAddresses: true, orgId });
    expect(first).toMatchObject({ claimed: 2, succeeded: 1, retried: 1 });
    const [pending] = await handle.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.orgId, orgId), eq(jobs.kind, "webhook")));
    expect(pending).toMatchObject({
      status: "pending",
      attempts: 1,
      lastStatusCode: 503,
      lastError: "Endpoint answered 503",
    });
    expect(pending?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5_000);

    // Not due yet: nothing is claimed.
    expect(
      (await runOnce({ db: handle.db, purger, allowPrivateAddresses: true, orgId })).claimed,
    ).toBe(0);
    await handle.db
      .update(jobs)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(and(eq(jobs.orgId, orgId), eq(jobs.kind, "webhook")));
    expect(
      await runOnce({ db: handle.db, purger, allowPrivateAddresses: true, orgId }),
    ).toMatchObject({ claimed: 1, failed: 1 });
    const [failed] = await handle.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.orgId, orgId), eq(jobs.kind, "webhook")));
    expect(failed).toMatchObject({ status: "failed", attempts: 2 });
    expect(received).toHaveLength(2);
  });

  it("refuses private addresses unless allowed", async () => {
    await publish();
    const result = await runOnce({ db: handle.db, purger, orgId });
    expect(result).toMatchObject({ succeeded: 1, retried: 1 });
    expect(received).toHaveLength(0);
    const [blocked] = await handle.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.orgId, orgId), eq(jobs.kind, "webhook")));
    expect(blocked?.lastError).toMatch(/private address/);
  });
});
