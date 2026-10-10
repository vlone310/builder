import {
  createDb,
  type DbHandle,
  generateInviteToken,
  invites,
  memberships,
  newId,
  orgs,
  runMigrations,
  users,
  withOrg,
} from "@builder/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContentApp } from "./app";
import { createEditTokenSigner } from "./edit-tokens";
import type { EmailMessage } from "./email";

const url = process.env.TEST_DATABASE_URL;
const jwtSecret = "test-secret-that-is-at-least-32-characters";
const EDITOR = "http://editor.test";

describe.skipIf(!url)("sign-in", () => {
  let handle: DbHandle;
  let app: ReturnType<typeof createContentApp>;
  const outbox: EmailMessage[] = [];
  const orgId = newId("org");
  const run = newId("usr").slice(4, 12);
  const adaEmail = `ada-${run}@example.com`;
  const bobEmail = `bob-${run}@example.com`;

  async function invite(email: string, role: "admin" | "editor" = "editor") {
    const token = generateInviteToken();
    await withOrg(handle.db, orgId, (tx) =>
      tx.insert(invites).values({
        id: newId("inv"),
        orgId,
        email,
        role,
        hash: token.hash,
        invitedBy: "test",
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    );
    return token.plaintext;
  }

  function req(method: string, path: string, init: { cookie?: string; body?: unknown } = {}) {
    return app.request(path, {
      method,
      redirect: "manual",
      headers: {
        origin: EDITOR,
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }

  /** Requests a magic link, follows it, and returns the sign-in cookie. */
  async function signIn(email: string): Promise<string | null> {
    outbox.length = 0;
    const sent = await req("POST", "/auth/sign-in/magic-link", {
      body: { email, callbackURL: `${EDITOR}/` },
    });
    expect(sent.status).toBe(200);
    const message = outbox.find((m) => m.to === email);
    if (!message) return null;
    const link = /(http\S+magic-link\/verify\S+)/.exec(message.text)?.[1] as string;
    const verified = await app.request(link.replace("http://content.test", ""), {
      redirect: "manual",
    });
    expect(verified.status).toBe(302);
    const cookies = verified.headers.getSetCookie().map((c) => c.split(";")[0]);
    const session = cookies.find((c) => c?.startsWith("builder.session_token="));
    return session ?? null;
  }

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    app = createContentApp({
      db: handle.db,
      jwtSecret,
      editTokens: await createEditTokenSigner({ issuer: "http://content.test" }),
      corsOrigins: [EDITOR],
      signIn: {
        secret: "another-test-secret-of-32-characters!",
        baseUrl: "http://content.test",
        email: async (message) => {
          outbox.push(message);
        },
      },
    });
    await withOrg(handle.db, orgId, (tx) => tx.insert(orgs).values({ id: orgId, name: "Acme" }));
  });

  afterAll(async () => {
    await withOrg(handle.db, orgId, (tx) => tx.delete(orgs).where(eq(orgs.id, orgId)));
    for (const email of [adaEmail, bobEmail]) {
      await handle.db.delete(users).where(eq(users.email, email));
    }
    await handle.close();
  });

  it("lists the sign-in methods", async () => {
    expect(await (await req("GET", "/auth/providers")).json()).toEqual({
      emailLink: true,
      google: false,
      devLogin: false,
    });
  });

  it("sends no link to an uninvited address and creates no user", async () => {
    expect(await signIn(`nobody-${run}@example.com`)).toBeNull();
    const rows = await handle.db
      .select()
      .from(users)
      .where(eq(users.email, `nobody-${run}@example.com`));
    expect(rows).toEqual([]);
  });

  it("signs an invited user in, accepts the invite and issues an org token", async () => {
    const token = await invite(adaEmail, "admin");

    const preview = await req("GET", `/auth/invites/${token}`);
    expect(await preview.json()).toMatchObject({
      org: { id: orgId, name: "Acme" },
      email: adaEmail,
      role: "admin",
    });

    const cookie = await signIn(adaEmail);
    expect(cookie).toBeTruthy();

    const before = await req("GET", "/auth/orgs", { cookie: cookie as string });
    expect(await before.json()).toMatchObject({ user: { email: adaEmail }, orgs: [] });

    const accepted = await req("POST", "/auth/invites/accept", {
      cookie: cookie as string,
      body: { token },
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ org: { id: orgId, name: "Acme" }, role: "admin" });

    // The invite works once.
    const again = await req("POST", "/auth/invites/accept", {
      cookie: cookie as string,
      body: { token },
    });
    expect(again.status).toBe(404);

    const orgList = (await (
      await req("GET", "/auth/orgs", { cookie: cookie as string })
    ).json()) as {
      orgs: unknown[];
    };
    expect(orgList.orgs).toEqual([{ id: orgId, name: "Acme", role: "admin" }]);

    const issued = await req("POST", "/auth/token", {
      cookie: cookie as string,
      body: { orgId },
    });
    expect(issued.status).toBe(200);
    const session = (await issued.json()) as { token: string };
    expect(session).toMatchObject({ role: "admin", org: { id: orgId, name: "Acme" } });

    const sites = await app.request("/v1/sites", {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(sites.status).toBe(200);
  });

  it("refuses an invite meant for someone else", async () => {
    const forBob = await invite(bobEmail);
    const adaToken = await invite(adaEmail);
    const cookie = (await signIn(adaEmail)) as string;
    const response = await req("POST", "/auth/invites/accept", { cookie, body: { token: forBob } });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "invite_email_mismatch",
    );
    // Accepting as an existing member keeps the higher role.
    await req("POST", "/auth/invites/accept", { cookie, body: { token: adaToken } });
    const [row] = await withOrg(handle.db, orgId, (tx) =>
      tx.select().from(memberships).where(eq(memberships.orgId, orgId)),
    );
    expect(row?.role).toBe("admin");
  });

  it("refuses tokens for orgs the user is not in, and cookie writes from other origins", async () => {
    const cookie = (await signIn(adaEmail)) as string;
    const foreign = await req("POST", "/auth/token", {
      cookie,
      body: { orgId: "org_somewhere_else" },
    });
    expect(foreign.status).toBe(403);

    const crossSite = await app.request("/auth/token", {
      method: "POST",
      headers: { origin: "https://evil.test", cookie, "content-type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    expect(crossSite.status).toBe(403);

    const signedOut = await req("POST", "/auth/token", { body: { orgId } });
    expect(signedOut.status).toBe(401);
  });
});
