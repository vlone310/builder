import { migrateDocument, normalizeSlug, type PageDocument } from "@builder/core";
import {
  type Db,
  pages,
  type ResolvedApiKey,
  resolveApiKey,
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

  app.use("/v1/*", async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    const apiKey = token ? await resolveApiKey(db, token) : null;
    if (apiKey?.kind !== "delivery") {
      throw new HTTPException(401, { message: "A valid delivery key is required" });
    }
    c.set("apiKey", apiKey);
    await next();
  });

  app.get("/v1/pages", async (c) => {
    const locale = requireLocale(c.req.query("locale"));
    const slug = normalizeSlug(c.req.query("slug"));
    const apiKey = c.get("apiKey");
    const document = await findPublished(db, apiKey, { kind: "page", locale, slug });
    return respond(c, document, apiKey.siteId);
  });

  app.get("/v1/regions/:name", async (c) => {
    const locale = requireLocale(c.req.query("locale"));
    const apiKey = c.get("apiKey");
    const document = await findPublished(db, apiKey, {
      kind: "region",
      locale,
      name: c.req.param("name"),
    });
    return respond(c, document, apiKey.siteId);
  });

  function respond(
    c: Context<Env>,
    found: { document: PageDocument; revisionId: string } | null,
    siteId: string,
  ) {
    c.header("Vary", "Authorization");
    if (!found) {
      c.header("Cache-Control", "public, max-age=0, s-maxage=60");
      return c.json({ error: { code: "not_found", message: "No published content" } }, 404);
    }
    const etag = `"${found.revisionId}"`;
    c.header("ETag", etag);
    c.header("Cache-Control", `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=60`);
    // Surrogate keys let the platform purge one page on publish.
    c.header("Cache-Tag", `site:${siteId},page:${found.document.page.id}`);
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
    const stored = migrateDocument(row.tree);
    // Page meta comes from the pages row so renames apply without republishing.
    const document: PageDocument = {
      ...stored,
      page: {
        id: row.page.id,
        siteId: row.page.siteId,
        kind: row.page.kind,
        locale: row.page.locale,
        ...(row.page.slug !== null ? { slug: row.page.slug } : {}),
        ...(row.page.name !== null ? { name: row.page.name } : {}),
        ...(stored.page.seo ? { seo: stored.page.seo } : {}),
      },
    };
    return { document, revisionId: row.revisionId };
  });
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
