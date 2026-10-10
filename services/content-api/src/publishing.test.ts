import { createDb, type DbHandle, jobs, newId, orgs, runMigrations, withOrg } from "@builder/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContentApp } from "./app";
import { signSessionToken } from "./auth";
import { createEditTokenSigner } from "./edit-tokens";

const url = process.env.TEST_DATABASE_URL;
const secret = "test-secret-that-is-at-least-32-characters";

describe.skipIf(!url)("webhooks, publish events and preview links", () => {
  let handle: DbHandle;
  let app: ReturnType<typeof createContentApp>;
  const orgId = newId("org");
  let admin: string;
  let editor: string;
  let siteId: string;
  let envId: string;

  async function call(token: string, method: string, path: string, body?: unknown) {
    const response = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    // biome-ignore lint/suspicious/noExplicitAny: test responses
    return { status: response.status, body: (text ? JSON.parse(text) : null) as any };
  }

  const jobsFor = () =>
    withOrg(handle.db, orgId, (tx) =>
      tx.select().from(jobs).where(eq(jobs.orgId, orgId)).orderBy(jobs.createdAt),
    );

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    app = createContentApp({
      db: handle.db,
      jwtSecret: secret,
      editTokens: await createEditTokenSigner({ issuer: "http://content.test" }),
    });
    await withOrg(handle.db, orgId, (tx) => tx.insert(orgs).values({ id: orgId, name: "Org" }));
    admin = await signSessionToken({ orgId, userId: "u_admin", role: "admin" }, secret);
    editor = await signSessionToken({ orgId, userId: "u_editor", role: "editor" }, secret);
    siteId = (await call(admin, "POST", "/v1/sites", { name: "S" })).body.id;
    envId = (
      await call(admin, "POST", `/v1/sites/${siteId}/environments`, {
        name: "dev",
        hostUrl: "http://host.test",
      })
    ).body.id;
  });

  afterAll(async () => {
    await withOrg(handle.db, orgId, (tx) => tx.delete(orgs).where(eq(orgs.id, orgId)));
    await handle.close();
  });

  it("manages webhooks and shows the secret once", async () => {
    expect(
      (await call(admin, "POST", `/v1/sites/${siteId}/webhooks`, { url: "http://evil.test/hook" }))
        .status,
    ).toBe(400);
    expect(
      (await call(editor, "POST", `/v1/sites/${siteId}/webhooks`, { url: "https://a.test/hook" }))
        .status,
    ).toBe(403);
    const created = await call(admin, "POST", `/v1/sites/${siteId}/webhooks`, {
      url: "https://host.test/api/builder/revalidate",
    });
    expect(created).toMatchObject({
      status: 201,
      body: { events: ["page.published", "page.unpublished"] },
    });
    expect(created.body.secret).toMatch(/^whsec_/);
    const listed = await call(admin, "GET", `/v1/sites/${siteId}/webhooks`);
    expect(listed.body.items).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.secret);
    expect(
      (
        await call(admin, "POST", `/v1/sites/${siteId}/webhooks`, {
          url: "http://localhost:3000/hook",
          events: ["page.unpublished"],
        })
      ).status,
    ).toBe(201);
  });

  it("queues signed webhooks and a CDN purge on publish, slug change and unpublish", async () => {
    const created = await call(editor, "POST", `/v1/sites/${siteId}/pages`, {
      kind: "page",
      locale: "en",
      slug: "/promo",
      content: { root: { id: "n1", type: "core/section@1", props: {} } },
    });
    const pageId = created.body.page.id as string;
    // Drafts send nothing.
    expect(await jobsFor()).toHaveLength(0);

    await call(editor, "POST", `/v1/pages/${pageId}/publish`, {
      revisionId: created.body.revisionId,
    });
    let rows = await jobsFor();
    expect(rows.map((row) => row.kind).sort()).toEqual(["cdn_purge", "webhook"]);
    expect(rows.find((row) => row.kind === "webhook")?.payload).toMatchObject({
      type: "page.published",
      page: { id: pageId, slug: "/promo" },
      tags: [`builder:page:${pageId}`, `builder:slug:${siteId}:en:/promo`],
    });

    await call(editor, "PATCH", `/v1/pages/${pageId}`, { slug: "/promo-2" });
    rows = await jobsFor();
    const moved = rows.filter((row) => row.kind === "webhook").at(-1);
    expect(moved?.payload).toMatchObject({
      type: "page.published",
      tags: [
        `builder:page:${pageId}`,
        `builder:slug:${siteId}:en:/promo-2`,
        `builder:slug:${siteId}:en:/promo`,
      ],
    });

    await call(editor, "POST", `/v1/pages/${pageId}/unpublish`);
    rows = await jobsFor();
    // Both endpoints listen for unpublish.
    expect(
      rows.filter((row) => (row.payload as { type?: string }).type === "page.unpublished"),
    ).toHaveLength(2);

    const webhookId = (await call(admin, "GET", `/v1/sites/${siteId}/webhooks`)).body.items[0].id;
    const deliveries = await call(admin, "GET", `/v1/webhooks/${webhookId}/deliveries`);
    expect(deliveries.body.items.length).toBeGreaterThanOrEqual(3);
    expect(deliveries.body.items[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("creates, lists and revokes preview links bound to a revision", async () => {
    const created = await call(editor, "POST", `/v1/sites/${siteId}/pages`, {
      kind: "page",
      locale: "en",
      slug: "/draft-only",
      content: { root: { id: "n1", type: "core/section@1", props: {} } },
    });
    const pageId = created.body.page.id as string;
    const link = await call(editor, "POST", `/v1/pages/${pageId}/preview-links`, {
      envId,
      expiresInHours: 2,
    });
    expect(link.status).toBe(201);
    expect(link.body).toMatchObject({ revisionId: created.body.revisionId });
    expect(link.body.token).toMatch(/^bk_pvw_/);
    expect(link.body.url).toBe(`http://host.test/draft-only?builder.preview=${link.body.token}`);

    const listed = await call(editor, "GET", `/v1/pages/${pageId}/preview-links`);
    expect(listed.body.items.map((item: { id: string }) => item.id)).toEqual([link.body.id]);
    expect(JSON.stringify(listed.body)).not.toContain(link.body.token);

    expect((await call(editor, "POST", `/v1/preview-links/${link.body.id}/revoke`)).status).toBe(
      200,
    );
    expect((await call(editor, "GET", `/v1/pages/${pageId}/preview-links`)).body.items).toEqual([]);
    expect((await call(editor, "POST", `/v1/preview-links/${link.body.id}/revoke`)).status).toBe(
      404,
    );
    expect(
      (await call(editor, "POST", `/v1/pages/${pageId}/preview-links`, { revisionId: "rev_nope" }))
        .status,
    ).toBe(404);
  });
});
