import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ApiKeyKind } from "./schema";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

export function createDb(url = process.env.DATABASE_URL): DbHandle {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

/**
 * Runs fn in a transaction scoped to one org. The transaction switches to the
 * builder_app role, so row-level security applies even when the connection
 * user owns the tables.
 */
export async function withOrg<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE builder_app`);
    await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += ID_ALPHABET[byte % 32];
  return out;
}

export type IdPrefix =
  | "org"
  | "st"
  | "env"
  | "pg"
  | "rev"
  | "cm"
  | "ast"
  | "key"
  | "wh"
  | "job"
  | "pvw"
  | "inv"
  | "usr";

/** Prefixed random id, e.g. "pg_3k9x...". */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomToken(20)}`;
}

const KEY_PREFIX: Record<ApiKeyKind, string> = {
  delivery: "bk_dlv_",
  preview: "bk_prv_",
  cli: "bk_cli_",
};

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** A new API key; store the hash and show the plaintext once. */
export function generateApiKey(kind: ApiKeyKind): { plaintext: string; hash: string } {
  const plaintext = `${KEY_PREFIX[kind]}${randomToken(32)}`;
  return { plaintext, hash: hashApiKey(plaintext) };
}

export interface ResolvedApiKey {
  id: string;
  orgId: string;
  siteId: string;
  kind: ApiKeyKind;
  scopes: string[];
}

/** Finds an unrevoked key by its plaintext, across all orgs. */
export async function resolveApiKey(db: Db, plaintext: string): Promise<ResolvedApiKey | null> {
  const rows = await db.execute<{
    id: string;
    org_id: string;
    site_id: string;
    kind: ApiKeyKind;
    scopes: string[];
  }>(sql`SELECT * FROM builder_resolve_api_key(${hashApiKey(plaintext)})`);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, orgId: row.org_id, siteId: row.site_id, kind: row.kind, scopes: row.scopes };
}
