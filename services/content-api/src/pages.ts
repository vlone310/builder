import {
  CURRENT_SCHEMA_VERSION,
  migrateDocument,
  normalizeSlug,
  type PageDocument,
  pageCacheTags,
  pageNodeSchema,
  pageSeoSchema,
  validatePage,
} from "@builder/core";
import {
  type Db,
  enqueuePageEvent,
  newId,
  pageKinds,
  pages,
  revisions,
  type Tx,
  withOrg,
} from "@builder/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError, type AppEnv, isUniqueViolation, notFound, parseJson, requireRole } from "./http";
import { requireSite } from "./sites";

/** How long a soft page lock lasts without renewal. */
export const LOCK_TTL_MS = 2 * 60 * 1000;

const localeSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "Invalid locale");

/** The editable part of a document; page meta comes from the pages row. */
const contentSchema = z.object({
  root: pageNodeSchema,
  seo: pageSeoSchema.optional(),
});

const createPageSchema = z
  .object({
    kind: z.enum(pageKinds),
    locale: localeSchema,
    slug: z.string().max(500).optional(),
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use lowercase letters, digits and dashes")
      .optional(),
    content: contentSchema.optional(),
  })
  .refine(
    (v) =>
      v.kind === "page"
        ? v.slug !== undefined && v.name === undefined
        : v.name !== undefined && v.slug === undefined,
    {
      message: "Pages need a slug, regions need a name",
    },
  );

const updatePageSchema = z.object({ slug: z.string().max(500).optional() });

const saveDraftSchema = z.object({
  /** The revision the edit was based on; null for the first save. */
  baseRevisionId: z.string().nullable(),
  content: contentSchema,
});

const publishSchema = z.object({ revisionId: z.string() });
const lockSchema = z.object({ force: z.boolean().default(false) });

type PageRow = typeof pages.$inferSelect;

function pageView(page: PageRow) {
  const lockActive = page.lockHolder !== null && (page.lockExpiresAt?.getTime() ?? 0) > Date.now();
  return {
    id: page.id,
    siteId: page.siteId,
    kind: page.kind,
    slug: page.slug,
    name: page.name,
    locale: page.locale,
    publishedRevisionId: page.publishedRevisionId,
    lock: lockActive ? { holder: page.lockHolder, expiresAt: page.lockExpiresAt } : null,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

function buildDocument(page: PageRow, content: z.output<typeof contentSchema>): PageDocument {
  const document: PageDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    page: {
      id: page.id,
      siteId: page.siteId,
      kind: page.kind,
      locale: page.locale,
      ...(page.slug !== null ? { slug: page.slug } : {}),
      ...(page.name !== null ? { name: page.name } : {}),
      ...(content.seo ? { seo: content.seo } : {}),
    },
    root: content.root,
  };
  // Structure, ids and limits. Props are checked against component schemas by
  // builder check once the Registry holds manifests.
  const result = validatePage(document);
  if (!result.valid) {
    throw new ApiError(422, "invalid_document", "Page document is invalid", result.issues);
  }
  return document;
}

function taggable(page: PageRow) {
  return {
    id: page.id,
    siteId: page.siteId,
    kind: page.kind,
    locale: page.locale,
    slug: page.slug,
    name: page.name,
  };
}

async function lockPage(tx: Tx, pageId: string): Promise<PageRow> {
  const [page] = await tx.select().from(pages).where(eq(pages.id, pageId)).for("update");
  if (!page) throw notFound("Page");
  return page;
}

function assertNotLockedByOther(page: PageRow, userId: string) {
  if (
    page.lockHolder &&
    page.lockHolder !== userId &&
    (page.lockExpiresAt?.getTime() ?? 0) > Date.now()
  ) {
    throw new ApiError(423, "locked", `Page is being edited by ${page.lockHolder}`, {
      holder: page.lockHolder,
      expiresAt: page.lockExpiresAt,
    });
  }
}

async function latestRevisionId(tx: Tx, pageId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: revisions.id })
    .from(revisions)
    .where(eq(revisions.pageId, pageId))
    .orderBy(desc(revisions.createdAt), desc(revisions.id))
    .limit(1);
  return row?.id ?? null;
}

export function pageRoutes(db: Db) {
  const app = new Hono<AppEnv>();

  app.get("/sites/:siteId/pages", async (c) => {
    const { orgId } = c.get("auth");
    const kind = c.req.query("kind");
    const locale = c.req.query("locale");
    const rows = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(pages)
        .where(
          and(
            eq(pages.siteId, c.req.param("siteId")),
            kind === "page" || kind === "region" ? eq(pages.kind, kind) : undefined,
            locale ? eq(pages.locale, locale) : undefined,
          ),
        )
        .orderBy(pages.kind, pages.slug, pages.name),
    );
    return c.json({ items: rows.map(pageView) });
  });

  app.post("/sites/:siteId/pages", async (c) => {
    const { orgId, userId } = requireRole(c, "edit");
    const input = await parseJson(c, createPageSchema);
    const siteId = c.req.param("siteId");
    try {
      const result = await withOrg(db, orgId, async (tx) => {
        await requireSite(tx, siteId);
        const [page] = await tx
          .insert(pages)
          .values({
            id: newId("pg"),
            orgId,
            siteId,
            kind: input.kind,
            locale: input.locale,
            slug: input.kind === "page" ? normalizeSlug(input.slug) : null,
            name: input.kind === "region" ? (input.name ?? null) : null,
          })
          .returning();
        if (!page) throw new Error("Insert returned no row");
        let revisionId: string | null = null;
        if (input.content) {
          const document = buildDocument(page, input.content);
          revisionId = newId("rev");
          await tx.insert(revisions).values({
            id: revisionId,
            orgId,
            pageId: page.id,
            tree: document,
            schemaVersion: document.schemaVersion,
            authorId: userId,
          });
        }
        return { page: pageView(page), revisionId };
      });
      return c.json(result, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(
          409,
          "conflict",
          "A page with this slug or name already exists for this locale",
        );
      }
      throw error;
    }
  });

  app.get("/pages/:pageId", async (c) => {
    const { orgId } = c.get("auth");
    const result = await withOrg(db, orgId, async (tx) => {
      const [page] = await tx
        .select()
        .from(pages)
        .where(eq(pages.id, c.req.param("pageId")));
      if (!page) throw notFound("Page");
      return { ...pageView(page), latestRevisionId: await latestRevisionId(tx, page.id) };
    });
    return c.json(result);
  });

  app.patch("/pages/:pageId", async (c) => {
    const { orgId, userId } = requireRole(c, "edit");
    const input = await parseJson(c, updatePageSchema);
    try {
      const page = await withOrg(db, orgId, async (tx) => {
        const page = await lockPage(tx, c.req.param("pageId"));
        assertNotLockedByOther(page, userId);
        if (input.slug !== undefined && page.kind !== "page") {
          throw new ApiError(400, "bad_request", "Only pages have a slug");
        }
        const [updated] = await tx
          .update(pages)
          .set({
            ...(input.slug !== undefined ? { slug: normalizeSlug(input.slug) } : {}),
            updatedAt: new Date(),
          })
          .where(eq(pages.id, page.id))
          .returning();
        const next = updated as PageRow;
        if (page.publishedRevisionId && next.slug !== page.slug) {
          // The live page moved: refresh the new address and drop the old one.
          await enqueuePageEvent(tx, {
            orgId,
            event: "page.published",
            page: taggable(next),
            revisionId: page.publishedRevisionId,
            extraTags: pageCacheTags(taggable(page)),
          });
        }
        return next;
      });
      return c.json(pageView(page));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, "conflict", "Slug already in use");
      throw error;
    }
  });

  app.delete("/pages/:pageId", async (c) => {
    const { orgId, userId } = requireRole(c, "edit");
    await withOrg(db, orgId, async (tx) => {
      const page = await lockPage(tx, c.req.param("pageId"));
      assertNotLockedByOther(page, userId);
      if (page.publishedRevisionId) {
        await enqueuePageEvent(tx, {
          orgId,
          event: "page.unpublished",
          page: taggable(page),
          revisionId: null,
        });
      }
      await tx.delete(pages).where(eq(pages.id, page.id));
    });
    return c.body(null, 204);
  });

  app.post("/pages/:pageId/lock", async (c) => {
    const { orgId, userId } = requireRole(c, "edit");
    const { force } = await parseJson(c, lockSchema);
    const page = await withOrg(db, orgId, async (tx) => {
      const page = await lockPage(tx, c.req.param("pageId"));
      // Taking over is allowed: the editor shows who holds the lock and asks first.
      if (!force) assertNotLockedByOther(page, userId);
      const [updated] = await tx
        .update(pages)
        .set({ lockHolder: userId, lockExpiresAt: new Date(Date.now() + LOCK_TTL_MS) })
        .where(eq(pages.id, page.id))
        .returning();
      return updated as PageRow;
    });
    return c.json(pageView(page));
  });

  app.delete("/pages/:pageId/lock", async (c) => {
    const { orgId, userId } = requireRole(c, "edit");
    await withOrg(db, orgId, async (tx) => {
      const page = await lockPage(tx, c.req.param("pageId"));
      if (page.lockHolder === userId) {
        await tx
          .update(pages)
          .set({ lockHolder: null, lockExpiresAt: null })
          .where(eq(pages.id, page.id));
      }
    });
    return c.body(null, 204);
  });

  app.get("/pages/:pageId/revisions", async (c) => {
    const { orgId } = c.get("auth");
    const rows = await withOrg(db, orgId, async (tx) => {
      const [page] = await tx
        .select({ id: pages.id })
        .from(pages)
        .where(eq(pages.id, c.req.param("pageId")));
      if (!page) throw notFound("Page");
      return tx
        .select({
          id: revisions.id,
          status: revisions.status,
          authorId: revisions.authorId,
          schemaVersion: revisions.schemaVersion,
          createdAt: revisions.createdAt,
        })
        .from(revisions)
        .where(eq(revisions.pageId, page.id))
        .orderBy(desc(revisions.createdAt), desc(revisions.id))
        .limit(100);
    });
    return c.json({ items: rows });
  });

  app.get("/revisions/:revisionId", async (c) => {
    const { orgId } = c.get("auth");
    const [row] = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(revisions)
        .where(eq(revisions.id, c.req.param("revisionId"))),
    );
    if (!row) throw notFound("Revision");
    return c.json({ ...row, tree: migrateDocument(row.tree) });
  });

  /** The latest revision of the page, whatever its status: what the editor opens. */
  app.get("/pages/:pageId/draft", async (c) => {
    const { orgId } = c.get("auth");
    const result = await withOrg(db, orgId, async (tx) => {
      const [page] = await tx
        .select({ id: pages.id })
        .from(pages)
        .where(eq(pages.id, c.req.param("pageId")));
      if (!page) throw notFound("Page");
      const [row] = await tx
        .select()
        .from(revisions)
        .where(eq(revisions.pageId, page.id))
        .orderBy(desc(revisions.createdAt), desc(revisions.id))
        .limit(1);
      return row ?? null;
    });
    if (!result) throw notFound("Draft");
    return c.json({
      revisionId: result.id,
      status: result.status,
      document: migrateDocument(result.tree),
    });
  });

  app.put("/pages/:pageId/draft", async (c) => {
    const { orgId, userId } = requireRole(c, "edit");
    const input = await parseJson(c, saveDraftSchema);
    const result = await withOrg(db, orgId, async (tx) => {
      const page = await lockPage(tx, c.req.param("pageId"));
      assertNotLockedByOther(page, userId);
      const latest = await latestRevisionId(tx, page.id);
      if (latest !== input.baseRevisionId) {
        throw new ApiError(409, "stale_revision", "The page changed since this edit started", {
          latestRevisionId: latest,
        });
      }
      const document = buildDocument(page, input.content);
      const revisionId = newId("rev");
      await tx.insert(revisions).values({
        id: revisionId,
        orgId,
        pageId: page.id,
        tree: document,
        schemaVersion: document.schemaVersion,
        authorId: userId,
      });
      await tx.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, page.id));
      return { revisionId, document };
    });
    return c.json(result, 201);
  });

  app.post("/pages/:pageId/publish", async (c) => {
    const { orgId } = requireRole(c, "edit");
    const { revisionId } = await parseJson(c, publishSchema);
    const page = await withOrg(db, orgId, async (tx) => {
      const page = await lockPage(tx, c.req.param("pageId"));
      const [revision] = await tx
        .select({ id: revisions.id })
        .from(revisions)
        .where(and(eq(revisions.id, revisionId), eq(revisions.pageId, page.id)));
      if (!revision) throw notFound("Revision of this page");
      if (page.publishedRevisionId && page.publishedRevisionId !== revisionId) {
        await tx
          .update(revisions)
          .set({ status: "archived" })
          .where(eq(revisions.id, page.publishedRevisionId));
      }
      await tx.update(revisions).set({ status: "published" }).where(eq(revisions.id, revisionId));
      const [updated] = await tx
        .update(pages)
        .set({ publishedRevisionId: revisionId, updatedAt: new Date() })
        .where(eq(pages.id, page.id))
        .returning();
      // Same transaction: the webhook and CDN purge go out only if the publish commits.
      await enqueuePageEvent(tx, {
        orgId,
        event: "page.published",
        page: taggable(updated as PageRow),
        revisionId,
      });
      return updated as PageRow;
    });
    return c.json(pageView(page));
  });

  app.post("/pages/:pageId/unpublish", async (c) => {
    const { orgId } = requireRole(c, "edit");
    const page = await withOrg(db, orgId, async (tx) => {
      const page = await lockPage(tx, c.req.param("pageId"));
      if (page.publishedRevisionId) {
        await tx
          .update(revisions)
          .set({ status: "archived" })
          .where(eq(revisions.id, page.publishedRevisionId));
      }
      const [updated] = await tx
        .update(pages)
        .set({ publishedRevisionId: null, updatedAt: new Date() })
        .where(eq(pages.id, page.id))
        .returning();
      if (page.publishedRevisionId) {
        await enqueuePageEvent(tx, {
          orgId,
          event: "page.unpublished",
          page: taggable(page),
          revisionId: null,
        });
      }
      return updated as PageRow;
    });
    return c.json(pageView(page));
  });

  return app;
}
