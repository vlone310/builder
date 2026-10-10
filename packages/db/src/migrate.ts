import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const MIGRATION_LOCK_ID = 7_314_002;

/** Applies pending migrations; concurrent callers wait on an advisory lock. */
export async function runMigrations(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error("DATABASE_URL is not set");
  // Migrations are idempotent, so Postgres NOTICEs ("already exists, skipping") are noise.
  const quiet = { onnotice: () => {} };
  const lock = postgres(url, { max: 1, ...quiet });
  const client = postgres(url, { max: 1, ...quiet });
  try {
    await lock`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
    await lock.end();
  }
}
