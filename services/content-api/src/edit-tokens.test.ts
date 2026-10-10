import { createDb, type DbHandle, newId, orgs, runMigrations, withOrg } from "@builder/db";
import { eq } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContentApp } from "./app";
import { signSessionToken } from "./auth";
import { createEditTokenSigner, EDIT_TOKEN_AUDIENCE } from "./edit-tokens";

const url = process.env.TEST_DATABASE_URL;
const secret = "test-secret-that-is-at-least-32-characters";
const issuer = "http://content.test";

describe.skipIf(!url)("edit tokens, JWKS, dev login, CORS", () => {
  let handle: DbHandle;
  let app: ReturnType<typeof createContentApp>;
  let locked: ReturnType<typeof createContentApp>;
  const orgId = newId("org");
  let admin: string;
  let siteId: string;
  let envId: string;

  async function call(
    token: string | null,
    method: string,
    path: string,
    body?: unknown,
    target = app,
  ) {
    const response = await target.request(path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        origin: "http://editor.test",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      headers: response.headers, // biome-ignore lint/suspicious/noExplicitAny: test responses
      body: (await response.json().catch(() => null)) as any,
    };
  }

  beforeAll(async () => {
    await runMigrations(url);
    handle = createDb(url);
    const editTokens = await createEditTokenSigner({ issuer });
    app = createContentApp({
      db: handle.db,
      jwtSecret: secret,
      editTokens,
      devLogin: true,
      corsOrigins: ["http://editor.test"],
    });
    locked = createContentApp({ db: handle.db, jwtSecret: secret, editTokens });
    await withOrg(handle.db, orgId, (tx) => tx.insert(orgs).values({ id: orgId, name: "Org" }));
    admin = await signSessionToken({ orgId, userId: "u_admin", role: "admin" }, secret);
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

  it("issues ES256 edit tokens that verify against the JWKS", async () => {
    const issued = await call(admin, "POST", "/v1/edit-tokens", { siteId, envId });
    expect(issued.status).toBe(201);
    expect(issued.body.environment).toMatchObject({ name: "dev", hostUrl: "http://host.test" });

    const jwks = await call(null, "GET", "/.well-known/jwks.json");
    expect(jwks.body.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256" });
    expect(jwks.body.keys[0].d).toBeUndefined();

    const { payload, protectedHeader } = await jwtVerify(
      issued.body.token,
      createLocalJWKSet(jwks.body),
      {
        issuer,
        audience: EDIT_TOKEN_AUDIENCE,
      },
    );
    expect(protectedHeader.alg).toBe("ES256");
    expect(payload).toMatchObject({
      sub: "u_admin",
      org: orgId,
      site: siteId,
      env: "dev",
      envId,
      scope: "edit",
    });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(600);
  });

  it("checks roles and that the environment belongs to the site", async () => {
    const viewer = await signSessionToken({ orgId, userId: "v", role: "viewer" }, secret);
    expect((await call(viewer, "POST", "/v1/edit-tokens", { siteId, envId })).status).toBe(403);
    expect(
      (await call(admin, "POST", "/v1/edit-tokens", { siteId: "st_other", envId })).status,
    ).toBe(404);
  });

  it("logs in without a password only when dev login is on", async () => {
    const login = await call(null, "POST", "/auth/dev-login", {
      orgId,
      userId: "me",
      role: "editor",
    });
    expect(login.status).toBe(200);
    expect((await call(login.body.token, "GET", "/v1/sites")).body.items).toHaveLength(1);
    expect(
      (
        await call(null, "POST", "/auth/dev-login", {
          orgId: "org_nope",
          userId: "me",
          role: "editor",
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(null, "POST", "/auth/dev-login", { orgId, userId: "me", role: "editor" }, locked))
        .status,
    ).toBe(404);
  });

  it("allows only configured origins", async () => {
    const preflight = await app.request("/v1/sites", {
      method: "OPTIONS",
      headers: { origin: "http://editor.test", "access-control-request-method": "GET" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://editor.test");
    const other = await app.request("/health", { headers: { origin: "http://evil.test" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("loads a configured private JWK", async () => {
    const { exportJWK, generateKeyPair } = await import("jose");
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const signer = await createEditTokenSigner({
      issuer,
      privateJwk: JSON.stringify({ ...(await exportJWK(privateKey)), kid: "k1" }),
    });
    expect(signer.kid).toBe("k1");
    expect(signer.publicJwk.d).toBeUndefined();
    await expect(
      createEditTokenSigner({ issuer, privateJwk: JSON.stringify({ kty: "oct", k: "x" }) }),
    ).rejects.toThrow(/P-256/);
  });
});
