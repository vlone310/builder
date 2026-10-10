import { createDb, type DbHandle, newId, orgs, runMigrations, withOrg } from "@builder/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContentApp } from "./app";
import { signSessionToken } from "./auth";
import { createEditTokenSigner } from "./edit-tokens";

const url = process.env.TEST_DATABASE_URL;
const secret = "test-secret-that-is-at-least-32-characters";

describe.skipIf(!url)("Content API", () => {
  let handle: DbHandle;
  let app: ReturnType<typeof createContentApp>;
  const orgId = newId("org");
  const otherOrgId = newId("org");
  const tokens: Record<string, string> = {};

  async function call(token: string, method: string, path: string, body?: unknown) {
    const response = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  const root = (text: string) => ({
    id: "n1",
    type: "core/section@1",
    props: {},
    slots: { children: [{ id: "n2", type: "core/heading@1", props: { text } }] },
  });

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    app = createContentApp({
      db: handle.db,
      jwtSecret: secret,
      editTokens: await createEditTokenSigner({ issuer: "http://content.test" }),
    });
    for (const id of [orgId, otherOrgId]) {
      await withOrg(handle.db, id, (tx) => tx.insert(orgs).values({ id, name: id }));
    }
    tokens.admin = await signSessionToken({ orgId, userId: "u_admin", role: "admin" }, secret);
    tokens.editor = await signSessionToken({ orgId, userId: "u_editor", role: "editor" }, secret);
    tokens.viewer = await signSessionToken({ orgId, userId: "u_viewer", role: "viewer" }, secret);
    tokens.other = await signSessionToken(
      { orgId: otherOrgId, userId: "u_other", role: "admin" },
      secret,
    );
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      await withOrg(handle.db, id, (tx) => tx.delete(orgs).where(eq(orgs.id, id)));
    }
    await handle.close();
  });

  it("rejects missing and forged tokens", async () => {
    expect((await app.request("/v1/sites")).status).toBe(401);
    const forged = await signSessionToken(
      { orgId, userId: "x", role: "admin" },
      "another-secret-of-32-characters-xx",
    );
    expect((await call(forged, "GET", "/v1/sites")).status).toBe(401);
  });

  it("runs the page lifecycle: create, draft, conflict, lock, publish", async () => {
    const admin = tokens.admin as string;
    const editor = tokens.editor as string;

    const site = await call(admin, "POST", "/v1/sites", { name: "Main" });
    expect(site.status).toBe(201);
    const siteId = site.body.id as string;

    const env = await call(admin, "POST", `/v1/sites/${siteId}/environments`, {
      name: "dev",
      hostUrl: "http://localhost:3000/some/path",
    });
    expect(env.body).toMatchObject({ name: "dev", allowedOrigin: "http://localhost:3000" });
    expect(
      (
        await call(admin, "POST", `/v1/sites/${siteId}/environments`, {
          name: "dev",
          hostUrl: "http://x.test",
        })
      ).status,
    ).toBe(409);

    const key = await call(admin, "POST", `/v1/sites/${siteId}/api-keys`, { kind: "delivery" });
    expect(key.body.key).toMatch(/^bk_dlv_/);
    const keys = await call(admin, "GET", `/v1/sites/${siteId}/api-keys`);
    expect(JSON.stringify(keys.body)).not.toContain(key.body.key);

    const created = await call(editor, "POST", `/v1/sites/${siteId}/pages`, {
      kind: "page",
      locale: "en",
      slug: "promo/summer/",
      content: { root: root("v1"), seo: { title: "Summer" } },
    });
    expect(created.status).toBe(201);
    expect(created.body.page).toMatchObject({ slug: "/promo/summer", publishedRevisionId: null });
    const pageId = created.body.page.id as string;
    const rev1 = created.body.revisionId as string;

    const duplicate = await call(editor, "POST", `/v1/sites/${siteId}/pages`, {
      kind: "page",
      locale: "en",
      slug: "/promo/summer",
    });
    expect(duplicate.status).toBe(409);

    const saved = await call(editor, "PUT", `/v1/pages/${pageId}/draft`, {
      baseRevisionId: rev1,
      content: { root: root("v2") },
    });
    expect(saved.status).toBe(201);
    const rev2 = saved.body.revisionId as string;
    expect(saved.body.document.page).toMatchObject({
      id: pageId,
      slug: "/promo/summer",
      kind: "page",
    });

    const stale = await call(admin, "PUT", `/v1/pages/${pageId}/draft`, {
      baseRevisionId: rev1,
      content: { root: root("v3") },
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { error: { code: "stale_revision", details: { latestRevisionId: rev2 } } },
    });

    const invalid = await call(editor, "PUT", `/v1/pages/${pageId}/draft`, {
      baseRevisionId: rev2,
      content: {
        root: {
          id: "n1",
          type: "core/section@1",
          props: {},
          slots: { children: [{ id: "n1", type: "core/heading@1", props: {} }] },
        },
      },
    });
    expect(invalid).toMatchObject({ status: 422, body: { error: { code: "invalid_document" } } });

    expect((await call(editor, "POST", `/v1/pages/${pageId}/lock`, {})).body.lock).toMatchObject({
      holder: "u_editor",
    });
    expect(
      (
        await call(admin, "PUT", `/v1/pages/${pageId}/draft`, {
          baseRevisionId: rev2,
          content: { root: root("x") },
        })
      ).status,
    ).toBe(423);
    expect((await call(admin, "POST", `/v1/pages/${pageId}/lock`, {})).status).toBe(423);
    expect(
      (await call(admin, "POST", `/v1/pages/${pageId}/lock`, { force: true })).body.lock,
    ).toMatchObject({ holder: "u_admin" });
    expect((await call(admin, "DELETE", `/v1/pages/${pageId}/lock`)).status).toBe(204);

    const draft = await call(editor, "GET", `/v1/pages/${pageId}/draft`);
    expect(draft.body).toMatchObject({ revisionId: rev2, status: "draft" });

    const published = await call(editor, "POST", `/v1/pages/${pageId}/publish`, {
      revisionId: rev1,
    });
    expect(published.body.publishedRevisionId).toBe(rev1);
    await call(editor, "POST", `/v1/pages/${pageId}/publish`, { revisionId: rev2 });
    const history = await call(editor, "GET", `/v1/pages/${pageId}/revisions`);
    expect(history.body.items.map((r: { id: string; status: string }) => [r.id, r.status])).toEqual(
      [
        [rev2, "published"],
        [rev1, "archived"],
      ],
    );

    const renamed = await call(editor, "PATCH", `/v1/pages/${pageId}`, { slug: "/promo/autumn" });
    expect(renamed.body.slug).toBe("/promo/autumn");

    expect((await call(tokens.viewer as string, "GET", `/v1/pages/${pageId}`)).status).toBe(200);
    expect(
      (await call(tokens.viewer as string, "POST", `/v1/pages/${pageId}/unpublish`)).status,
    ).toBe(403);
    expect((await call(editor, "POST", "/v1/sites", { name: "Nope" })).status).toBe(403);

    // Another org sees none of it.
    expect((await call(tokens.other as string, "GET", `/v1/pages/${pageId}`)).status).toBe(404);
    expect(
      (await call(tokens.other as string, "GET", `/v1/sites/${siteId}/pages`)).body.items,
    ).toEqual([]);
    expect(
      (
        await call(tokens.other as string, "POST", `/v1/sites/${siteId}/pages`, {
          kind: "region",
          locale: "en",
          name: "x",
        })
      ).status,
    ).toBe(404);

    expect(
      (await call(editor, "POST", `/v1/pages/${pageId}/unpublish`)).body.publishedRevisionId,
    ).toBeNull();
    expect((await call(editor, "DELETE", `/v1/pages/${pageId}`)).status).toBe(204);
    expect((await call(editor, "GET", `/v1/pages/${pageId}`)).status).toBe(404);
  });

  it("validates request bodies", async () => {
    const response = await call(tokens.admin as string, "POST", "/v1/sites", { name: "" });
    expect(response).toMatchObject({ status: 400, body: { error: { code: "bad_request" } } });
  });
});
