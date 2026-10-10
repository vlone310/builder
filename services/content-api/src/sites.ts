import {
  apiKeyKinds,
  apiKeys,
  type Db,
  environments,
  generateApiKey,
  newId,
  orgs,
  sites,
  type Tx,
  withOrg,
} from "@builder/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  ApiError,
  type AppEnv,
  isUniqueViolation,
  notFound,
  parseJson,
  requirePermission,
} from "./http";

const localeSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "Invalid locale");

const createSiteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  defaultLocale: localeSchema.default("en"),
});

const createEnvironmentSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "Use lowercase letters, digits and dashes"),
  hostUrl: z.url({ protocol: /^https?$/ }),
  /** Origin the host app's messages come from; defaults to the host URL's origin. */
  allowedOrigin: z.url({ protocol: /^https?$/ }).optional(),
});

const createApiKeySchema = z.object({ kind: z.enum(apiKeyKinds) });

export function siteRoutes(db: Db) {
  const app = new Hono<AppEnv>();

  app.get("/org", async (c) => {
    const { orgId } = c.get("auth");
    const [org] = await withOrg(db, orgId, (tx) =>
      tx.select().from(orgs).where(eq(orgs.id, orgId)),
    );
    if (!org) throw notFound("Org");
    return c.json(org);
  });

  app.get("/sites", async (c) => {
    const { orgId } = c.get("auth");
    const rows = await withOrg(db, orgId, (tx) =>
      tx.select().from(sites).orderBy(asc(sites.createdAt)),
    );
    return c.json({ items: rows });
  });

  app.post("/sites", async (c) => {
    const { orgId } = requirePermission(c, "site.create");
    const input = await parseJson(c, createSiteSchema);
    const [site] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(sites)
        .values({ id: newId("st"), orgId, ...input })
        .returning(),
    );
    return c.json(site, 201);
  });

  app.get("/sites/:siteId", async (c) => {
    const { orgId } = c.get("auth");
    const [site] = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(sites)
        .where(eq(sites.id, c.req.param("siteId"))),
    );
    if (!site) throw notFound("Site");
    return c.json(site);
  });

  app.get("/sites/:siteId/environments", async (c) => {
    const { orgId } = c.get("auth");
    const rows = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(environments)
        .where(eq(environments.siteId, c.req.param("siteId")))
        .orderBy(asc(environments.createdAt)),
    );
    return c.json({ items: rows });
  });

  app.post("/sites/:siteId/environments", async (c) => {
    const { orgId } = requirePermission(c, "site.configure");
    const input = await parseJson(c, createEnvironmentSchema);
    const siteId = c.req.param("siteId");
    try {
      const [environment] = await withOrg(db, orgId, async (tx) => {
        await requireSite(tx, siteId);
        return tx
          .insert(environments)
          .values({
            id: newId("env"),
            orgId,
            siteId,
            name: input.name,
            hostUrl: input.hostUrl,
            allowedOrigin: new URL(input.allowedOrigin ?? input.hostUrl).origin,
          })
          .returning();
      });
      return c.json(environment, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "conflict", `Environment "${input.name}" already exists`);
      }
      throw error;
    }
  });

  app.get("/sites/:siteId/api-keys", async (c) => {
    const { orgId } = requirePermission(c, "site.configure");
    const rows = await withOrg(db, orgId, (tx) =>
      tx
        .select({
          id: apiKeys.id,
          kind: apiKeys.kind,
          scopes: apiKeys.scopes,
          createdAt: apiKeys.createdAt,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.siteId, c.req.param("siteId")))
        .orderBy(asc(apiKeys.createdAt)),
    );
    return c.json({ items: rows });
  });

  app.post("/sites/:siteId/api-keys", async (c) => {
    const { orgId } = requirePermission(c, "site.configure");
    const { kind } = await parseJson(c, createApiKeySchema);
    const siteId = c.req.param("siteId");
    const { plaintext, hash } = generateApiKey(kind);
    const [row] = await withOrg(db, orgId, async (tx) => {
      await requireSite(tx, siteId);
      return tx
        .insert(apiKeys)
        .values({ id: newId("key"), orgId, siteId, kind, hash })
        .returning({ id: apiKeys.id, kind: apiKeys.kind, createdAt: apiKeys.createdAt });
    });
    // The plaintext is returned once and never stored.
    return c.json({ ...row, key: plaintext }, 201);
  });

  app.post("/api-keys/:keyId/revoke", async (c) => {
    const { orgId } = requirePermission(c, "site.configure");
    const [row] = await withOrg(db, orgId, (tx) =>
      tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, c.req.param("keyId")), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id, revokedAt: apiKeys.revokedAt }),
    );
    if (!row) throw notFound("Active API key");
    return c.json(row);
  });

  return app;
}

export async function requireSite(tx: Tx, siteId: string) {
  const [site] = await tx.select().from(sites).where(eq(sites.id, siteId));
  if (!site) throw notFound("Site");
  return site;
}
