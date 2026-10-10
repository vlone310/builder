import {
  createDb,
  type DbHandle,
  generatePreviewToken,
  newId,
  previewLinks,
  revisions,
  runMigrations,
  withOrg,
} from "@builder/db";
import { DEMO_DELIVERY_KEY, seedDemo } from "@builder/db/seed";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryApp } from "./app";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Delivery API", () => {
  let handle: DbHandle;
  let app: ReturnType<typeof createDeliveryApp>;
  const auth = { authorization: `Bearer ${DEMO_DELIVERY_KEY}` };

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    await seedDemo(handle.db);
    app = createDeliveryApp({ db: handle.db });
  });

  afterAll(() => handle.close());

  it("serves a published page by slug with cache headers", async () => {
    const response = await app.request("/v1/sites/st_demo/pages?slug=/sports/football&locale=en", {
      headers: auth,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      schemaVersion: 1,
      page: { id: "pg_demo_football", slug: "/sports/football", seo: { title: "Football odds" } },
      root: { type: "core/section@1" },
    });
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("cache-tag")).toBe(
      "builder:page:pg_demo_football,builder:slug:st_demo:en:/sports/football,builder:site:st_demo",
    );

    const etag = response.headers.get("etag") ?? "";
    const cached = await app.request("/v1/sites/st_demo/pages?slug=/sports/football&locale=en", {
      headers: { ...auth, "if-none-match": etag },
    });
    expect(cached.status).toBe(304);
  });

  it("normalizes the slug", async () => {
    const response = await app.request("/v1/sites/st_demo/pages?slug=sports/football/&locale=en", {
      headers: auth,
    });
    expect(response.status).toBe(200);
  });

  it("returns 404 for unknown pages and locales", async () => {
    expect(
      (await app.request("/v1/sites/st_demo/pages?slug=/nope&locale=en", { headers: auth })).status,
    ).toBe(404);
    expect(
      (await app.request("/v1/sites/st_demo/pages?slug=/&locale=de", { headers: auth })).status,
    ).toBe(404);
    expect(
      (await app.request("/v1/sites/st_demo/regions/home-hero?locale=en", { headers: auth }))
        .status,
    ).toBe(404);
  });

  it("requires a valid delivery key and locale", async () => {
    expect((await app.request("/v1/sites/st_demo/pages?slug=/&locale=en")).status).toBe(401);
    expect(
      (
        await app.request("/v1/sites/st_demo/pages?slug=/&locale=en", {
          headers: { authorization: "Bearer bk_dlv_nope" },
        })
      ).status,
    ).toBe(401);
    expect((await app.request("/v1/sites/st_demo/pages?slug=/", { headers: auth })).status).toBe(
      400,
    );
    // A key only opens its own site's URLs.
    expect(
      (await app.request("/v1/sites/st_other/pages?slug=/&locale=en", { headers: auth })).status,
    ).toBe(404);
  });

  it("tags 404s by address so a first publish can purge them", async () => {
    const response = await app.request("/v1/sites/st_demo/pages?slug=/soon&locale=en", {
      headers: auth,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-tag")).toBe(
      "builder:slug:st_demo:en:/soon,builder:site:st_demo",
    );
  });

  it("serves a draft revision by preview token, never cached", async () => {
    const { plaintext, hash } = generatePreviewToken();
    await withOrg(handle.db, "org_demo", async (tx) => {
      const [revision] = await tx
        .select({ id: revisions.id })
        .from(revisions)
        .where(eq(revisions.pageId, "pg_demo_home"));
      await tx.insert(previewLinks).values({
        id: newId("pvw"),
        orgId: "org_demo",
        siteId: "st_demo",
        pageId: "pg_demo_home",
        revisionId: revision?.id as string,
        hash,
        createdBy: "test",
        expiresAt: new Date(Date.now() + 60_000),
      });
    });
    const response = await app.request(`/v1/sites/st_demo/preview?token=${plaintext}`, {
      headers: auth,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      page: { id: "pg_demo_home" },
      preview: { revisionId: expect.any(String) },
    });
    expect(
      (await app.request("/v1/sites/st_demo/preview?token=bk_pvw_nope", { headers: auth })).status,
    ).toBe(404);
    expect((await app.request(`/v1/sites/st_demo/preview?token=${plaintext}`)).status).toBe(401);
  });
});
