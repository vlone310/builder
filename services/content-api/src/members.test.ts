import { type Role, roles } from "@builder/core";
import {
  createDb,
  type DbHandle,
  memberships,
  newId,
  orgs,
  resolveInvite,
  runMigrations,
  withOrg,
} from "@builder/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContentApp } from "./app";
import { signSessionToken } from "./auth";
import { createEditTokenSigner } from "./edit-tokens";
import type { EmailMessage } from "./email";

const url = process.env.TEST_DATABASE_URL;
const secret = "test-secret-that-is-at-least-32-characters";

describe.skipIf(!url)("roles and members", () => {
  let handle: DbHandle;
  let app: ReturnType<typeof createContentApp>;
  const outbox: EmailMessage[] = [];
  const orgId = newId("org");
  const tokens = {} as Record<Role, string>;
  let siteId: string;
  let pageId: string;

  async function call(role: Role | string, method: string, path: string, body?: unknown) {
    const token = role in tokens ? tokens[role as Role] : role;
    const response = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    app = createContentApp({
      db: handle.db,
      jwtSecret: secret,
      editTokens: await createEditTokenSigner({ issuer: "http://content.test" }),
      corsOrigins: ["http://editor.test"],
      signIn: {
        secret: "another-test-secret-of-32-characters!",
        baseUrl: "http://content.test",
        email: async (message) => {
          outbox.push(message);
        },
      },
    });
    await withOrg(handle.db, orgId, async (tx) => {
      await tx.insert(orgs).values({ id: orgId, name: "Acme" });
      await tx
        .insert(memberships)
        .values(roles.map((role) => ({ orgId, userId: `u_${role}`, role })));
    });
    for (const role of roles) {
      tokens[role] = await signSessionToken({ orgId, userId: `u_${role}`, role }, secret);
    }
    siteId = (await call("admin", "POST", "/v1/sites", { name: "Main" })).body.id;
    const page = await call("admin", "POST", `/v1/sites/${siteId}/pages`, {
      kind: "page",
      locale: "en",
      slug: "/",
    });
    pageId = page.body.page.id;
  });

  afterAll(async () => {
    await withOrg(handle.db, orgId, (tx) => tx.delete(orgs).where(eq(orgs.id, orgId)));
    await handle.close();
  });

  it("enforces the permission matrix on representative routes", async () => {
    // Each write tried by every role; allowed roles must not get 403.
    const writes: { permission: string; allowed: Role[]; run: (role: Role) => Promise<number> }[] =
      [
        {
          permission: "site.create",
          allowed: ["admin"],
          run: async (role) =>
            (await call(role, "POST", "/v1/sites", { name: `S ${role}` })).status,
        },
        {
          permission: "site.configure",
          allowed: ["admin", "developer"],
          run: async (role) =>
            (await call(role, "POST", `/v1/sites/${siteId}/api-keys`, { kind: "delivery" })).status,
        },
        {
          permission: "content.edit",
          allowed: ["admin", "developer", "editor"],
          run: async (role) =>
            (
              await call(role, "POST", `/v1/sites/${siteId}/pages`, {
                kind: "page",
                locale: "en",
                slug: `/by-${role}`,
              })
            ).status,
        },
        {
          permission: "content.publish",
          allowed: ["admin", "developer", "editor"],
          run: async (role) => (await call(role, "POST", `/v1/pages/${pageId}/unpublish`)).status,
        },
        {
          permission: "members.manage",
          allowed: ["admin"],
          run: async (role) => (await call(role, "GET", "/v1/invites")).status,
        },
      ];
    for (const write of writes) {
      for (const role of roles) {
        const status = await write.run(role);
        if (write.allowed.includes(role)) {
          expect(status, `${role} → ${write.permission}`).not.toBe(403);
        } else {
          expect(status, `${role} → ${write.permission}`).toBe(403);
        }
      }
    }
    // Reads are open to every member.
    for (const role of roles) {
      expect((await call(role, "GET", `/v1/sites/${siteId}/pages`)).status).toBe(200);
      expect((await call(role, "GET", "/v1/members")).status).toBe(200);
    }
  });

  it("invites by email, replaces a live invite, and revokes", async () => {
    outbox.length = 0;
    const first = await call("admin", "POST", "/v1/invites", {
      email: "New.Person@Example.com",
      role: "editor",
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      email: "new.person@example.com",
      role: "editor",
      emailed: true,
    });
    expect(first.body.url).toMatch(/^http:\/\/editor\.test\/#\/invite\/bk_inv_/);
    expect(outbox[0]?.to).toBe("new.person@example.com");
    expect(outbox[0]?.text).toContain(first.body.url);

    const second = await call("admin", "POST", "/v1/invites", {
      email: "new.person@example.com",
      role: "developer",
    });
    const token = (u: string) => u.split("/invite/")[1] as string;
    expect(await resolveInvite(handle.db, token(first.body.url))).toBeNull();
    expect(await resolveInvite(handle.db, token(second.body.url))).toMatchObject({
      role: "developer",
    });

    const listed = await call("admin", "GET", "/v1/invites");
    expect(listed.body.items.map((i: { id: string }) => i.id)).toEqual([second.body.id]);

    expect((await call("admin", "POST", `/v1/invites/${second.body.id}/revoke`)).status).toBe(204);
    expect((await call("admin", "GET", "/v1/invites")).body.items).toEqual([]);
    expect(
      (await call("editor", "POST", "/v1/invites", { email: "x@y.z", role: "admin" })).status,
    ).toBe(403);
  });

  it("changes roles and removes members, but never the last admin", async () => {
    const members = await call("viewer", "GET", "/v1/members");
    expect(members.body.items.map((m: { userId: string }) => m.userId).sort()).toEqual(
      roles.map((r) => `u_${r}`).sort(),
    );

    expect((await call("admin", "PATCH", "/v1/members/u_admin", { role: "editor" })).status).toBe(
      409,
    );
    expect((await call("admin", "DELETE", "/v1/members/u_admin")).status).toBe(409);

    expect(
      (await call("admin", "PATCH", "/v1/members/u_developer", { role: "admin" })).status,
    ).toBe(200);
    expect((await call("admin", "PATCH", "/v1/members/u_admin", { role: "viewer" })).status).toBe(
      200,
    );
    // Roles live in the 15-minute org token, so the promotion shows on the next token.
    expect((await call("developer", "DELETE", "/v1/members/u_viewer")).status).toBe(403);
    const promoted = await signSessionToken(
      { orgId, userId: "u_developer", role: "admin" },
      secret,
    );
    expect((await call(promoted, "DELETE", "/v1/members/u_viewer")).status).toBe(204);
    expect((await call(promoted, "DELETE", "/v1/members/u_nobody")).status).toBe(404);
    expect((await call("editor", "DELETE", "/v1/members/u_admin")).status).toBe(403);
  });
});
