import {
  type Db,
  environments,
  generatePreviewToken,
  generateWebhookSecret,
  jobs,
  newId,
  pages,
  previewLinks,
  revisions,
  webhookEvents,
  webhooks,
  withOrg,
} from "@builder/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, notFound, parseJson, requirePermission } from "./http";
import { requireSite } from "./sites";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** HTTPS endpoints only, except plain HTTP to localhost for development. */
const webhookUrlSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  },
  { message: "Webhook URLs must use HTTPS (HTTP is allowed for localhost)" },
);

const createWebhookSchema = z.object({
  url: webhookUrlSchema,
  events: z
    .array(z.enum(webhookEvents))
    .min(1)
    .default([...webhookEvents]),
});

const createPreviewSchema = z.object({
  /** Defaults to the page's latest revision. */
  revisionId: z.string().optional(),
  /** Builds a ready-to-share URL on this environment's host. */
  envId: z.string().optional(),
  expiresInHours: z.number().int().min(1).max(720).default(168),
});

const webhookView = (row: typeof webhooks.$inferSelect) => ({
  id: row.id,
  siteId: row.siteId,
  url: row.url,
  events: row.events,
  createdAt: row.createdAt,
});

export function publishingRoutes(db: Db) {
  const app = new Hono<AppEnv>();

  app.get("/sites/:siteId/webhooks", async (c) => {
    const { orgId } = requirePermission(c, "site.configure");
    const rows = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(webhooks)
        .where(eq(webhooks.siteId, c.req.param("siteId")))
        .orderBy(webhooks.createdAt),
    );
    return c.json({ items: rows.map(webhookView) });
  });

  app.post("/sites/:siteId/webhooks", async (c) => {
    const { orgId } = requirePermission(c, "site.configure");
    const input = await parseJson(c, createWebhookSchema);
    const siteId = c.req.param("siteId");
    const secret = generateWebhookSecret();
    const [row] = await withOrg(db, orgId, async (tx) => {
      await requireSite(tx, siteId);
      return tx
        .insert(webhooks)
        .values({ id: newId("wh"), orgId, siteId, url: input.url, events: input.events, secret })
        .returning();
    });
    if (!row) throw new Error("Insert returned no row");
    // The signing secret is returned once; the host stores it as BUILDER_WEBHOOK_SECRET.
    return c.json({ ...webhookView(row), secret }, 201);
  });

  app.delete("/webhooks/:webhookId", async (c) => {
    const { orgId } = requirePermission(c, "site.configure");
    const deleted = await withOrg(db, orgId, (tx) =>
      tx
        .delete(webhooks)
        .where(eq(webhooks.id, c.req.param("webhookId")))
        .returning({ id: webhooks.id }),
    );
    if (deleted.length === 0) throw notFound("Webhook");
    return c.body(null, 204);
  });

  /** The delivery log: the most recent jobs for this endpoint, newest first. */
  app.get("/webhooks/:webhookId/deliveries", async (c) => {
    const { orgId } = requirePermission(c, "site.configure");
    const rows = await withOrg(db, orgId, async (tx) => {
      const [webhook] = await tx
        .select({ id: webhooks.id })
        .from(webhooks)
        .where(eq(webhooks.id, c.req.param("webhookId")));
      if (!webhook) throw notFound("Webhook");
      return tx
        .select({
          id: jobs.id,
          status: jobs.status,
          attempts: jobs.attempts,
          lastStatusCode: jobs.lastStatusCode,
          lastError: jobs.lastError,
          nextAttemptAt: jobs.nextAttemptAt,
          createdAt: jobs.createdAt,
          finishedAt: jobs.finishedAt,
          payload: jobs.payload,
        })
        .from(jobs)
        .where(eq(jobs.webhookId, webhook.id))
        .orderBy(desc(jobs.createdAt))
        .limit(50);
    });
    return c.json({ items: rows });
  });

  app.get("/pages/:pageId/preview-links", async (c) => {
    const { orgId } = c.get("auth");
    const rows = await withOrg(db, orgId, (tx) =>
      tx
        .select({
          id: previewLinks.id,
          revisionId: previewLinks.revisionId,
          createdBy: previewLinks.createdBy,
          expiresAt: previewLinks.expiresAt,
          createdAt: previewLinks.createdAt,
        })
        .from(previewLinks)
        .where(and(eq(previewLinks.pageId, c.req.param("pageId")), isNull(previewLinks.revokedAt)))
        .orderBy(desc(previewLinks.createdAt)),
    );
    const now = Date.now();
    return c.json({ items: rows.filter((row) => row.expiresAt.getTime() > now) });
  });

  app.post("/pages/:pageId/preview-links", async (c) => {
    const { orgId, userId } = requirePermission(c, "content.edit");
    const input = await parseJson(c, createPreviewSchema);
    const { plaintext, hash } = generatePreviewToken();
    const result = await withOrg(db, orgId, async (tx) => {
      const [page] = await tx
        .select()
        .from(pages)
        .where(eq(pages.id, c.req.param("pageId")));
      if (!page) throw notFound("Page");
      const [revision] = await tx
        .select({ id: revisions.id })
        .from(revisions)
        .where(
          input.revisionId
            ? and(eq(revisions.id, input.revisionId), eq(revisions.pageId, page.id))
            : eq(revisions.pageId, page.id),
        )
        .orderBy(desc(revisions.createdAt), desc(revisions.id))
        .limit(1);
      if (!revision) throw notFound("Revision of this page");

      let url: string | null = null;
      if (input.envId) {
        const [environment] = await tx
          .select()
          .from(environments)
          .where(and(eq(environments.id, input.envId), eq(environments.siteId, page.siteId)));
        if (!environment) throw notFound("Environment");
        if (page.kind === "page" && page.slug) {
          const target = new URL(page.slug, environment.hostUrl);
          target.searchParams.set("builder.preview", plaintext);
          url = target.toString();
        }
      }

      const [link] = await tx
        .insert(previewLinks)
        .values({
          id: newId("pvw"),
          orgId,
          siteId: page.siteId,
          pageId: page.id,
          revisionId: revision.id,
          hash,
          createdBy: userId,
          expiresAt: new Date(Date.now() + input.expiresInHours * 3600_000),
        })
        .returning({
          id: previewLinks.id,
          revisionId: previewLinks.revisionId,
          expiresAt: previewLinks.expiresAt,
        });
      return { ...link, url };
    });
    // The token is returned once, inside the URL; only its hash is stored.
    return c.json({ ...result, token: plaintext }, 201);
  });

  app.post("/preview-links/:linkId/revoke", async (c) => {
    const { orgId } = requirePermission(c, "content.edit");
    const [row] = await withOrg(db, orgId, (tx) =>
      tx
        .update(previewLinks)
        .set({ revokedAt: new Date() })
        .where(and(eq(previewLinks.id, c.req.param("linkId")), isNull(previewLinks.revokedAt)))
        .returning({ id: previewLinks.id, revokedAt: previewLinks.revokedAt }),
    );
    if (!row) throw notFound("Active preview link");
    return c.json(row);
  });

  return app;
}
