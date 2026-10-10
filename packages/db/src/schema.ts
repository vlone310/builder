import type { PageDocument } from "@builder/core";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Every table carries org_id, and row-level security (see the rls migration)
 * limits the builder_app role to rows of the org set in app.org_id.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const orgId = () =>
  text("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" });
const siteId = () =>
  text("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" });

export const roles = ["admin", "developer", "editor", "viewer"] as const;
export type Role = (typeof roles)[number];
export const pageKinds = ["page", "region"] as const;
export const revisionStatuses = ["draft", "published", "archived"] as const;
export type RevisionStatus = (typeof revisionStatuses)[number];
export const apiKeyKinds = ["delivery", "preview", "cli"] as const;
export type ApiKeyKind = (typeof apiKeyKinds)[number];

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: orgId(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: roles }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const sites = pgTable(
  "sites",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    name: text("name").notNull(),
    defaultLocale: text("default_locale").notNull().default("en"),
    createdAt: createdAt(),
  },
  (t) => [index("sites_org_idx").on(t.orgId)],
);

export const environments = pgTable(
  "environments",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    siteId: siteId(),
    name: text("name").notNull(),
    hostUrl: text("host_url").notNull(),
    allowedOrigin: text("allowed_origin").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("environments_site_name_uq").on(t.siteId, t.name)],
);

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    siteId: siteId(),
    kind: text("kind", { enum: pageKinds }).notNull(),
    slug: text("slug"),
    name: text("name"),
    locale: text("locale").notNull(),
    publishedRevisionId: text("published_revision_id").references((): AnyPgColumn => revisions.id, {
      onDelete: "set null",
    }),
    lockHolder: text("lock_holder"),
    lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pages_site_locale_slug_uq")
      .on(t.siteId, t.locale, t.slug)
      .where(sql`${t.kind} = 'page'`),
    uniqueIndex("pages_site_locale_name_uq")
      .on(t.siteId, t.locale, t.name)
      .where(sql`${t.kind} = 'region'`),
    check(
      "pages_kind_key_ck",
      sql`(${t.kind} = 'page' AND ${t.slug} IS NOT NULL AND ${t.name} IS NULL) OR (${t.kind} = 'region' AND ${t.name} IS NOT NULL AND ${t.slug} IS NULL)`,
    ),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    /** The full page document as saved; page meta is refreshed from the pages row on read. */
    tree: jsonb("tree").$type<PageDocument>().notNull(),
    schemaVersion: integer("schema_version").notNull(),
    status: text("status", { enum: revisionStatuses }).notNull().default("draft"),
    authorId: text("author_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("revisions_page_created_idx").on(t.pageId, t.createdAt)],
);

export const componentManifests = pgTable(
  "component_manifests",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    siteId: siteId(),
    envId: text("env_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    componentId: text("component_id").notNull(),
    version: text("version").notNull(),
    manifest: jsonb("manifest").notNull(),
    gitSha: text("git_sha").notNull(),
    pushedAt: timestamp("pushed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("component_manifests_env_component_idx").on(t.envId, t.componentId, t.pushedAt)],
);

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    url: text("url").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    meta: jsonb("meta").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("assets_org_idx").on(t.orgId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    orgId: orgId(),
    siteId: siteId(),
    kind: text("kind", { enum: apiKeyKinds }).notNull(),
    /** SHA-256 of the key; the plaintext is shown once at creation. */
    hash: text("hash").notNull(),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.hash)],
);

export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  siteId: siteId(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().notNull(),
  createdAt: createdAt(),
});

export const tenantTables = [
  "orgs",
  "memberships",
  "sites",
  "environments",
  "pages",
  "revisions",
  "component_manifests",
  "assets",
  "api_keys",
  "webhooks",
] as const;
