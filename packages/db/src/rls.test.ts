import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  type DbHandle,
  generateApiKey,
  newId,
  resolveApiKey,
  runMigrations,
  withOrg,
} from "./index";
import { apiKeys, orgs, pages, sites, tenantTables } from "./schema";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("row-level security", () => {
  let handle: DbHandle;
  const orgA = newId("org");
  const orgB = newId("org");
  const siteA = newId("st");
  let keyA: string;

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    for (const [org, site] of [
      [orgA, siteA],
      [orgB, newId("st")],
    ] as const) {
      await withOrg(handle.db, org, async (tx) => {
        await tx.insert(orgs).values({ id: org, name: org });
        await tx.insert(sites).values({ id: site, orgId: org, name: "Site" });
        await tx.insert(pages).values({
          id: newId("pg"),
          orgId: org,
          siteId: site,
          kind: "page",
          slug: "/",
          locale: "en",
        });
      });
    }
    const key = generateApiKey("delivery");
    keyA = key.plaintext;
    await withOrg(handle.db, orgA, (tx) =>
      tx
        .insert(apiKeys)
        .values({ id: newId("key"), orgId: orgA, siteId: siteA, kind: "delivery", hash: key.hash }),
    );
  });

  afterAll(async () => {
    for (const org of [orgA, orgB]) {
      await withOrg(handle.db, org, (tx) => tx.delete(orgs).where(sql`id = ${org}`));
    }
    await handle.close();
  });

  it("enables RLS on every tenant table", async () => {
    const rows = await handle.db.execute<{ relname: string; relrowsecurity: boolean }>(
      sql`SELECT relname, relrowsecurity FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname NOT LIKE '\\_\\_%'`,
    );
    const tables = rows.map((row) => row.relname).sort();
    expect(tables).toEqual([...tenantTables].sort());
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("shows each org only its own rows", async () => {
    const visible = await withOrg(handle.db, orgA, (tx) =>
      tx.select({ orgId: pages.orgId }).from(pages),
    );
    expect(visible.length).toBeGreaterThan(0);
    expect(new Set(visible.map((row) => row.orgId))).toEqual(new Set([orgA]));
    const orgRows = await withOrg(handle.db, orgA, (tx) => tx.select().from(orgs));
    expect(orgRows.map((row) => row.id)).toEqual([orgA]);
  });

  it("refuses writes into another org", async () => {
    await expect(
      withOrg(handle.db, orgA, (tx) =>
        tx.insert(sites).values({ id: newId("st"), orgId: orgB, name: "Sneaky" }),
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } });
  });

  it("sees nothing without an org", async () => {
    const rows = await withOrg(handle.db, "", (tx) => tx.select().from(pages));
    expect(rows).toEqual([]);
  });

  it("resolves API keys across orgs by hash only", async () => {
    expect(await resolveApiKey(handle.db, keyA)).toMatchObject({
      orgId: orgA,
      siteId: siteA,
      kind: "delivery",
    });
    expect(await resolveApiKey(handle.db, "bk_dlv_wrong")).toBeNull();
  });
});
