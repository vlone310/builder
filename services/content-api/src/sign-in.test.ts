import { randomUUID } from "node:crypto";
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
import { type CryptoKey, createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContentApp } from "./app";
import { createEditTokenSigner } from "./edit-tokens";

const url = process.env.TEST_DATABASE_URL;
const jwtSecret = "test-secret-that-is-at-least-32-characters";
const ISSUER = "http://keycloak.test/realms/builder";
const AUDIENCE = "builder-content-api";

describe.skipIf(!url)("sign-in with Keycloak", () => {
  let handle: DbHandle;
  let app: ReturnType<typeof createContentApp>;
  let privateKey: CryptoKey;
  let otherKey: CryptoKey;
  const orgId = newId("org");
  const run = randomUUID().slice(0, 8);
  const ada = { sub: randomUUID(), email: `ada-${run}@example.com`, name: "Ada Lovelace" };
  const bob = { sub: randomUUID(), email: `bob-${run}@example.com`, name: "Bob" };

  /** A Keycloak-style access token. */
  function accessToken(
    user: { sub: string; email: string; name: string },
    overrides: { verified?: boolean; issuer?: string; audience?: string; key?: CryptoKey } = {},
  ) {
    return new SignJWT({
      email: user.email,
      email_verified: overrides.verified ?? true,
      name: user.name,
      preferred_username: user.email,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(overrides.issuer ?? ISSUER)
      .setAudience(overrides.audience ?? AUDIENCE)
      .setSubject(user.sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(overrides.key ?? privateKey);
  }

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

  async function call(method: string, path: string, bearer?: string, body?: unknown) {
    const response = await app.request(path, {
      method,
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    // biome-ignore lint/suspicious/noExplicitAny: test responses
    return { status: response.status, body: (text ? JSON.parse(text) : null) as any };
  }

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair("RS256")).privateKey;
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test", alg: "RS256" };
    app = createContentApp({
      db: handle.db,
      jwtSecret,
      editTokens: await createEditTokenSigner({ issuer: "http://content.test" }),
      oidc: {
        issuer: ISSUER,
        audience: AUDIENCE,
        editorClientId: "builder-editor",
        keys: createLocalJWKSet({ keys: [publicJwk] }),
      },
    });
    await withOrg(handle.db, orgId, (tx) => tx.insert(orgs).values({ id: orgId, name: "Acme" }));
  });

  afterAll(async () => {
    await withOrg(handle.db, orgId, (tx) => tx.delete(orgs).where(eq(orgs.id, orgId)));
    for (const user of [ada, bob]) await handle.db.delete(users).where(eq(users.id, user.sub));
    await handle.close();
  });

  it("tells the editor how to sign in", async () => {
    expect((await call("GET", "/auth/providers")).body).toEqual({
      oidc: { issuer: ISSUER, clientId: "builder-editor" },
      devLogin: false,
    });
  });

  it("rejects tokens from another issuer, audience or key, and missing tokens", async () => {
    expect((await call("GET", "/auth/orgs")).status).toBe(401);
    for (const overrides of [
      { issuer: "http://evil.test/realms/builder" },
      { audience: "account" },
      { key: otherKey },
    ]) {
      expect((await call("GET", "/auth/orgs", await accessToken(ada, overrides))).status).toBe(401);
    }
    // A Keycloak token is not an org token.
    expect((await call("GET", "/v1/sites", await accessToken(ada))).status).toBe(401);
  });

  it("accepts an invite, records the profile and issues an org token", async () => {
    const token = await invite(ada.email, "admin");
    expect((await call("GET", `/auth/invites/${token}`)).body).toMatchObject({
      org: { id: orgId, name: "Acme" },
      email: ada.email,
      role: "admin",
    });

    const kc = await accessToken(ada);
    expect((await call("GET", "/auth/orgs", kc)).body).toEqual({
      user: { id: ada.sub, email: ada.email, name: ada.name },
      orgs: [],
    });

    const accepted = await call("POST", "/auth/invites/accept", kc, { token });
    expect(accepted).toMatchObject({ status: 200, body: { org: { id: orgId }, role: "admin" } });
    expect((await call("POST", "/auth/invites/accept", kc, { token })).status).toBe(404);

    expect((await call("GET", "/auth/orgs", kc)).body.orgs).toEqual([
      { id: orgId, name: "Acme", role: "admin" },
    ]);
    const issued = await call("POST", "/auth/token", kc, { orgId });
    expect(issued.body).toMatchObject({ role: "admin", org: { id: orgId, name: "Acme" } });
    expect((await call("GET", "/v1/sites", issued.body.token)).status).toBe(200);

    const members = await call("GET", "/v1/members", issued.body.token);
    expect(members.body.items).toMatchObject([
      { userId: ada.sub, email: ada.email, name: ada.name, role: "admin" },
    ]);
  });

  it("refuses invites for another address or an unverified email", async () => {
    const forBob = await invite(bob.email);
    const mismatch = await call("POST", "/auth/invites/accept", await accessToken(ada), {
      token: forBob,
    });
    expect(mismatch).toMatchObject({
      status: 403,
      body: { error: { code: "invite_email_mismatch" } },
    });

    const unverified = await call(
      "POST",
      "/auth/invites/accept",
      await accessToken(bob, { verified: false }),
      { token: forBob },
    );
    expect(unverified).toMatchObject({
      status: 403,
      body: { error: { code: "email_not_verified" } },
    });

    // An existing member keeps the higher role.
    const lower = await invite(ada.email, "editor");
    await call("POST", "/auth/invites/accept", await accessToken(ada), { token: lower });
    const [row] = await withOrg(handle.db, orgId, (tx) =>
      tx.select().from(memberships).where(eq(memberships.userId, ada.sub)),
    );
    expect(row?.role).toBe("admin");
  });

  it("refuses org tokens for orgs the user is not in", async () => {
    const kc = await accessToken(bob);
    expect((await call("POST", "/auth/token", kc, { orgId })).status).toBe(403);
  });

  it("has no dev login when it is off", async () => {
    const response = await call("POST", "/auth/dev-login", undefined, {
      orgId,
      userId: "x",
      role: "admin",
    });
    expect(response.status).toBe(404);
  });
});
