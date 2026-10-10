import {
  migrateDocument,
  normalizeSlug,
  type PageDocument,
  pageCacheTags,
  siteCacheTag,
} from "@builder/core";
import {
  type Db,
  pages,
  type ResolvedApiKey,
  resolveApiKey,
  resolvePreviewLink,
  revisions,
  withOrg,
} from "@builder/db";
import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";

export interface DeliveryAppOptions {
  db: Db;
  /** Shared-cache lifetime for published content; purged on publish. Default 300 s. */
  sMaxAge?: number;
}

type Env = { Variables: { apiKey: ResolvedApiKey } };

const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function createDeliveryApp({ db, sMaxAge = 300 }: DeliveryAppOptions) {
  const app = new Hono<Env>();

  app.get("/health", (c) => c.json({ ok: true }));

  // The site is part of every URL, so a CDN caching by URL never mixes sites up.
  app.use("/v1/sites/:siteId/*", async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    const apiKey = token ? await resolveApiKey(db, token) : null;
    if (apiKey?.kind !== "delivery") {
      throw new HTTPException(401, { message: "A valid delivery key is required" });
    }
    if (apiKey.siteId !== c.req.param("siteId")) {
      throw new HTTPException(404, { message: "No such site for this key" });
    }
    c.set("apiKey", apiKey);
    await next();
  });

  app.get("/v1/sites/:siteId/pages", async (c) => {
    const locale = requireLocale(c.req.query("locale"));
    const slug = normalizeSlug(c.req.query("slug"));
    const apiKey = c.get("apiKey");
    const document = await findPublished(db, apiKey, { kind: "page", locale, slug });
    const tags = pageCacheTags({ id: "", siteId: apiKey.siteId, kind: "page", locale, slug });
    return respond(c, document, apiKey.siteId, tags[1] as string);
  });

  app.get("/v1/sites/:siteId/regions/:name", async (c) => {
    const locale = requireLocale(c.req.query("locale"));
    const apiKey = c.get("apiKey");
    const name = c.req.param("name");
    const document = await findPublished(db, apiKey, { kind: "region", locale, name });
    const tags = pageCacheTags({ id: "", siteId: apiKey.siteId, kind: "region", locale, name });
    return respond(c, document, apiKey.siteId, tags[1] as string);
  });

  /** One draft revision, by preview link token. Never cached. */
  app.get("/v1/sites/:siteId/preview", async (c) => {
    const apiKey = c.get("apiKey");
    c.header("Cache-Control", "private, no-store");
    const token = c.req.query("token") ?? "";
    const link = token ? await resolvePreviewLink(db, token) : null;
    // A link for another site is as good as no link: the key decides what is readable.
    if (!link || link.siteId !== apiKey.siteId) {
      return c.json(
        { error: { code: "not_found", message: "Preview link is invalid or expired" } },
        404,
      );
    }
    const found = await withOrg(db, link.orgId, async (tx) => {
      const rows = await tx
        .select({ page: pages, tree: revisions.tree, revisionId: revisions.id })
        .from(revisions)
        .innerJoin(pages, eq(pages.id, revisions.pageId))
        .where(and(eq(revisions.id, link.revisionId), eq(pages.id, link.pageId)))
        .limit(1);
      const row = rows[0];
      return row ? { document: toDocument(row.page, row.tree), revisionId: row.revisionId } : null;
    });
    if (!found) return c.json({ error: { code: "not_found", message: "Revision is gone" } }, 404);
    return c.json({
      ...found.document,
      preview: { revisionId: found.revisionId, expiresAt: link.expiresAt },
    });
  });

  function respond(
    c: Context<Env>,
    found: { document: PageDocument; revisionId: string } | null,
    siteId: string,
    addressTag: string,
  ) {
    c.header("Vary", "Authorization");
    if (!found) {
      // Tagged by address, so publishing a page here purges the cached 404.
      c.header("Cache-Control", "public, max-age=0, s-maxage=60");
      c.header("Cache-Tag", [addressTag, siteCacheTag(siteId)].join(","));
      return c.json({ error: { code: "not_found", message: "No published content" } }, 404);
    }
    const etag = `"${found.revisionId}"`;
    c.header("ETag", etag);
    c.header("Cache-Control", `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=60`);
    // Surrogate keys let the platform purge one page on publish.
    c.header("Cache-Tag", [...pageCacheTags(found.document.page), siteCacheTag(siteId)].join(","));
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    return c.json(found.document);
  }

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json(
        { error: { code: codeFor(error.status), message: error.message } },
        error.status,
      );
    }
    console.error(error);
    return c.json({ error: { code: "internal", message: "Internal error" } }, 500);
  });

  return app;
}

function requireLocale(locale: string | undefined): string {
  if (!locale || !LOCALE_PATTERN.test(locale)) {
    throw new HTTPException(400, {
      message: "Query parameter locale is required, e.g. en or en-GB",
    });
  }
  return locale;
}

async function findPublished(
  db: Db,
  apiKey: ResolvedApiKey,
  query:
    | { kind: "page"; locale: string; slug: string }
    | { kind: "region"; locale: string; name: string },
): Promise<{ document: PageDocument; revisionId: string } | null> {
  return withOrg(db, apiKey.orgId, async (tx) => {
    const rows = await tx
      .select({ page: pages, tree: revisions.tree, revisionId: revisions.id })
      .from(pages)
      .innerJoin(revisions, eq(revisions.id, pages.publishedRevisionId))
      .where(
        and(
          eq(pages.siteId, apiKey.siteId),
          eq(pages.kind, query.kind),
          eq(pages.locale, query.locale),
          query.kind === "page" ? eq(pages.slug, query.slug) : eq(pages.name, query.name),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { document: toDocument(row.page, row.tree), revisionId: row.revisionId };
  });
}

/** Page meta comes from the pages row, so renames apply without republishing. */
function toDocument(page: typeof pages.$inferSelect, tree: unknown): PageDocument {
  const stored = migrateDocument(tree);
  return {
    ...stored,
    page: {
      id: page.id,
      siteId: page.siteId,
      kind: page.kind,
      locale: page.locale,
      ...(page.slug !== null ? { slug: page.slug } : {}),
      ...(page.name !== null ? { name: page.name } : {}),
      ...(stored.page.seo ? { seo: stored.page.seo } : {}),
    },
  };
}

function codeFor(status: number): string {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 404:
      return "not_found";
    default:
      return "error";
  }
}
