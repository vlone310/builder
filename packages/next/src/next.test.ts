import { createRegistry, defineComponent } from "@builder/core";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { NextRequest } from "next/server.js";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createEditHandlers,
  EDIT_TOKEN_AUDIENCE,
  rewriteEditRequest,
  verifyEditToken,
} from "./index";

const contentApiUrl = "http://content.test";
let sign: (claims: JWTPayload, options?: { exp?: number; aud?: string }) => Promise<string>;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" }],
  });
  sign = (claims, options = {}) =>
    new SignJWT({
      org: "org_1",
      site: "st_1",
      env: "dev",
      envId: "env_1",
      scope: "edit",
      ...claims,
    })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer(contentApiUrl)
      .setAudience(options.aud ?? EDIT_TOKEN_AUDIENCE)
      .setSubject("u_1")
      .setIssuedAt()
      .setExpirationTime(options.exp ?? Math.floor(Date.now() / 1000) + 600)
      .sign(privateKey);
});

const config = () => ({ contentApiUrl, siteId: "st_1", env: "dev", keys });

describe("verifyEditToken", () => {
  it("accepts a token for this site and environment", async () => {
    expect(await verifyEditToken(await sign({}), config())).toMatchObject({
      userId: "u_1",
      orgId: "org_1",
      envId: "env_1",
    });
  });

  it.each([
    ["another site", { site: "st_2" }, {}, /another site/],
    ["another environment", { env: "prod" }, {}, /another environment/],
    ["a non-edit scope", { scope: "read" }, {}, /not an edit token/],
    ["the wrong audience", {}, { aud: "someone-else" }, /aud/],
    ["an expired token", {}, { exp: Math.floor(Date.now() / 1000) - 60 }, /exp/],
  ])("rejects %s", async (_, claims, options, message) => {
    await expect(verifyEditToken(await sign(claims, options), config())).rejects.toThrow(message);
  });

  it("rejects tokens signed by another key", async () => {
    const other = await generateKeyPair("ES256");
    const forged = await new SignJWT({ site: "st_1", env: "dev", scope: "edit" })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer(contentApiUrl)
      .setAudience(EDIT_TOKEN_AUDIENCE)
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await expect(verifyEditToken(forged, config())).rejects.toThrow(/signature/);
  });
});

describe("createEditHandlers", () => {
  const registry = createRegistry(
    defineComponent({
      id: "t/odds",
      version: "1.0.0",
      label: "Odds",
      props: z.object({ league: z.string(), rows: z.number().default(2) }),
      loader: ({ props, ctx }) =>
        (ctx.odds as (l: string, r: number) => number[])(props.league, props.rows),
      render: () => null,
    }),
    defineComponent({
      id: "t/slow",
      version: "1.0.0",
      label: "Slow",
      props: z.object({}),
      loader: () => new Promise(() => {}),
      render: () => null,
    }),
  );
  let POST: ReturnType<typeof createEditHandlers>["POST"];
  beforeAll(() => {
    ({ POST } = createEditHandlers({
      ...config(),
      registry,
      loaderTimeoutMs: 30,
      ctx: (session) => ({
        odds: (league: string, rows: number) =>
          Array.from({ length: rows }, () => `${league}:${session.userId}`),
      }),
      options: {
        leagues: ({ query }) =>
          [{ value: "epl", label: "Premier League" }].filter((o) => o.label.includes(query)),
      },
    }));
  });
  const call = async (body: unknown, token?: string) => {
    const response = await POST(
      new Request("http://host.test/builder-edit/api", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json() };
  };

  it("runs loaders per node key and isolates failures", async () => {
    const { status, body } = await call(
      {
        action: "load",
        nodes: [
          { key: "a", type: "t/odds@1", props: { league: "epl" } },
          { key: "b", type: "t/odds@1", props: {} },
          { key: "c", type: "t/slow@1", props: {} },
          { key: "d", type: "x/unknown@1", props: {} },
        ],
      },
      await sign({}),
    );
    expect(status).toBe(200);
    expect(body.results.a).toEqual({ ok: true, data: ["epl:u_1", "epl:u_1"] });
    expect(body.results.b).toMatchObject({ ok: false, code: "invalid_props" });
    expect(body.results.c).toMatchObject({ ok: false, code: "loader_failed" });
    expect(body.results.d).toMatchObject({ ok: false, code: "unknown_component" });
  });

  it("resolves options and requires a valid token", async () => {
    expect(
      (await call({ action: "options", source: "leagues", query: "Prem" }, await sign({}))).body
        .items,
    ).toHaveLength(1);
    expect(
      (await call({ action: "options", source: "nope", query: "" }, await sign({}))).body.items,
    ).toEqual([]);
    expect((await call({ action: "load", nodes: [] })).status).toBe(401);
    expect((await call({ action: "load", nodes: [] }, await sign({ site: "st_2" }))).status).toBe(
      401,
    );
  });
});

describe("rewriteEditRequest", () => {
  it("rewrites edit requests to the edit route with the slug", () => {
    const response = rewriteEditRequest(
      new NextRequest("http://host.test/sports/football/?builder.edit=tok&x=1"),
    );
    const target = new URL(response.headers.get("x-middleware-rewrite") ?? "");
    expect(target.pathname).toBe("/builder-edit");
    expect(Object.fromEntries(target.searchParams)).toEqual({
      token: "tok",
      slug: "/sports/football",
    });
  });

  it("passes other requests through", () => {
    expect(
      rewriteEditRequest(new NextRequest("http://host.test/a")).headers.get("x-middleware-rewrite"),
    ).toBeNull();
  });
});
