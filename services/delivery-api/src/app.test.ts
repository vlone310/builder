import { createDb, type DbHandle, runMigrations } from "@builder/db";
import { DEMO_DELIVERY_KEY, seedDemo } from "@builder/db/seed";
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
    const response = await app.request("/v1/pages?slug=/sports/football&locale=en", {
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
    expect(response.headers.get("cache-tag")).toBe("site:st_demo,page:pg_demo_football");

    const etag = response.headers.get("etag") ?? "";
    const cached = await app.request("/v1/pages?slug=/sports/football&locale=en", {
      headers: { ...auth, "if-none-match": etag },
    });
    expect(cached.status).toBe(304);
  });

  it("normalizes the slug", async () => {
    const response = await app.request("/v1/pages?slug=sports/football/&locale=en", {
      headers: auth,
    });
    expect(response.status).toBe(200);
  });

  it("returns 404 for unknown pages and locales", async () => {
    expect((await app.request("/v1/pages?slug=/nope&locale=en", { headers: auth })).status).toBe(
      404,
    );
    expect((await app.request("/v1/pages?slug=/&locale=de", { headers: auth })).status).toBe(404);
    expect((await app.request("/v1/regions/home-hero?locale=en", { headers: auth })).status).toBe(
      404,
    );
  });

  it("requires a valid delivery key and locale", async () => {
    expect((await app.request("/v1/pages?slug=/&locale=en")).status).toBe(401);
    expect(
      (
        await app.request("/v1/pages?slug=/&locale=en", {
          headers: { authorization: "Bearer bk_dlv_nope" },
        })
      ).status,
    ).toBe(401);
    expect((await app.request("/v1/pages?slug=/", { headers: auth })).status).toBe(400);
  });
});
