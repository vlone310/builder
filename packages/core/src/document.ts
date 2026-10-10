import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = 1;

/** "<library>/<name>", e.g. "igaming/odds-table". */
export const COMPONENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_TYPE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*)@(\d+)$/;
const SLOT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export type PageKind = "page" | "region";

export interface PageSeo {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
}

export interface PageMeta {
  id: string;
  siteId: string;
  kind: PageKind;
  locale: string;
  /** Set for kind "page". */
  slug?: string;
  /** Set for kind "region". */
  name?: string;
  seo?: PageSeo;
}

export interface PageNode {
  /** Stable and unique within the page. */
  id: string;
  /** Component id pinned to a major version: "igaming/odds-table@1". */
  type: string;
  props: Record<string, unknown>;
  slots?: Record<string, PageNode[]>;
}

export interface PageDocument {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  page: PageMeta;
  root: PageNode;
}

export const pageNodeSchema: z.ZodType<PageNode> = z.object({
  id: z.string().min(1).max(64),
  type: z.string().regex(NODE_TYPE_PATTERN, "Expected <library>/<name>@<major>"),
  props: z.record(z.string(), z.unknown()),
  get slots() {
    return z.record(z.string().regex(SLOT_NAME_PATTERN), z.array(pageNodeSchema)).optional();
  },
});

export const pageSeoSchema = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(1000).optional(),
  canonical: z.string().max(2048).optional(),
  noindex: z.boolean().optional(),
});

export const pageMetaSchema = z
  .object({
    id: z.string().min(1),
    siteId: z.string().min(1),
    kind: z.enum(["page", "region"]),
    locale: z.string().min(2).max(35),
    slug: z.string().optional(),
    name: z.string().optional(),
    seo: pageSeoSchema.optional(),
  })
  .superRefine((meta, ctx) => {
    if (meta.kind === "page" && meta.slug === undefined) {
      ctx.addIssue({ code: "custom", path: ["slug"], message: "A page needs a slug" });
    }
    if (meta.kind === "region" && meta.name === undefined) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "A region needs a name" });
    }
  });

export const pageDocumentSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  page: pageMetaSchema,
  root: pageNodeSchema,
});

export interface ParsedNodeType {
  componentId: string;
  major: number;
}

/** Splits "igaming/odds-table@1" into its component id and major version. */
export function parseNodeType(type: string): ParsedNodeType | null {
  const match = NODE_TYPE_PATTERN.exec(type);
  if (!match) return null;
  return { componentId: match[1] as string, major: Number(match[2]) };
}

export function formatNodeType(componentId: string, major: number): string {
  return `${componentId}@${major}`;
}

/** Depth-first walk over a node and all its slot children. */
export function* walkNodes(
  node: PageNode,
  parent: { node: PageNode; slot: string } | null = null,
  depth = 0,
): Generator<{ node: PageNode; parent: { node: PageNode; slot: string } | null; depth: number }> {
  yield { node, parent, depth };
  for (const [slot, children] of Object.entries(node.slots ?? {})) {
    for (const child of children) {
      yield* walkNodes(child, { node, slot }, depth + 1);
    }
  }
}

/**
 * Turns a route param into a canonical slug: "/" for the home page,
 * otherwise "/a/b" with no trailing slash.
 */
export function normalizeSlug(input: string | readonly string[] | undefined | null): string {
  const raw = Array.isArray(input) ? input.join("/") : ((input as string | undefined) ?? "");
  const segments = raw
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  return `/${segments.join("/")}`;
}

/**
 * Upgrades a stored document to the current page schema. The platform owns this
 * format; the Content API calls it on read so clients only see the current version.
 */
export function migrateDocument(input: unknown): PageDocument {
  if (typeof input !== "object" || input === null) {
    throw new Error("Page document must be an object");
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported page schemaVersion: ${String(version)}`);
  }
  return input as PageDocument;
}
