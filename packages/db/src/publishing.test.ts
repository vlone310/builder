import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  type DbHandle,
  enqueuePageEvent,
  generatePreviewToken,
  jobs,
  newId,
  orgs,
  pages,
  previewLinks,
  resolvePreviewLink,
  revisions,
  runMigrations,
  sites,
  webhooks,
  withOrg,
} from "./index";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("publishing outbox and preview links", () => {
  let handle: DbHandle;
  const orgId = newId("org");
  const siteId = newId("st");
  const pageId = newId("pg");
  const revisionId = newId("rev");

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    await withOrg(handle.db, orgId, async (tx) => {
      await tx.insert(orgs).values({ id: orgId, name: "Org" });
      await tx.insert(sites).values({ id: siteId, orgId, name: "Site" });
      await tx
        .insert(pages)
        .values({ id: pageId, orgId, siteId, kind: "page", slug: "/a", locale: "en" });
      await tx.insert(revisions).values({
        id: revisionId,
        orgId,
        pageId,
        tree: {} as never,
        schemaVersion: 1,
        authorId: "u",
      });
      await tx.insert(webhooks).values([
        {
          id: newId("wh"),
          orgId,
          siteId,
          url: "https://a.test/hook",
          secret: "s1",
          events: ["page.published"],
        },
        {
          id: newId("wh"),
          orgId,
          siteId,
          url: "https://b.test/hook",
          secret: "s2",
          events: ["page.unpublished"],
        },
      ]);
    });
  });

  afterAll(async () => {
    await withOrg(handle.db, orgId, (tx) => tx.delete(orgs).where(sql`id = ${orgId}`));
    await handle.close();
  });

  it("queues one webhook per subscribed endpoint and one CDN purge", async () => {
    const page = { id: pageId, siteId, kind: "page" as const, locale: "en", slug: "/a" };
    const { jobIds } = await withOrg(handle.db, orgId, (tx) =>
      enqueuePageEvent(tx, { orgId, event: "page.published", page, revisionId }),
    );
    expect(jobIds).toHaveLength(2);
    const rows = await withOrg(handle.db, orgId, (tx) => tx.select().from(jobs));
    const webhook = rows.find((row) => row.kind === "webhook");
    expect(webhook?.payload).toMatchObject({
      type: "page.published",
      revisionId,
      tags: [`builder:page:${pageId}`, `builder:slug:${siteId}:en:/a`],
    });
    expect(rows.find((row) => row.kind === "cdn_purge")?.payload).toEqual({
      tags: [`builder:page:${pageId}`, `builder:slug:${siteId}:en:/a`, `builder:site:${siteId}`],
    });
  });

  it("resolves only live preview links", async () => {
    const live = generatePreviewToken();
    const expired = generatePreviewToken();
    const revoked = generatePreviewToken();
    const base = { orgId, siteId, pageId, revisionId, createdBy: "u" };
    await withOrg(handle.db, orgId, (tx) =>
      tx.insert(previewLinks).values([
        { ...base, id: newId("pvw"), hash: live.hash, expiresAt: new Date(Date.now() + 60_000) },
        { ...base, id: newId("pvw"), hash: expired.hash, expiresAt: new Date(Date.now() - 1000) },
        {
          ...base,
          id: newId("pvw"),
          hash: revoked.hash,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(),
        },
      ]),
    );
    expect(await resolvePreviewLink(handle.db, live.plaintext)).toMatchObject({
      orgId,
      pageId,
      revisionId,
    });
    expect(await resolvePreviewLink(handle.db, expired.plaintext)).toBeNull();
    expect(await resolvePreviewLink(handle.db, revoked.plaintext)).toBeNull();
    expect(await resolvePreviewLink(handle.db, "bk_pvw_nope")).toBeNull();
  });
});
