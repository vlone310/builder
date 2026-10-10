import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb } from "./client";

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const MIGRATION_LOCK_ID = 7_314_002;

/** Applies pending migrations; concurrent callers wait on an advisory lock. */
export async function runMigrations(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error("DATABASE_URL is not set");
  const lock = postgres(url, { max: 1 });
  const { db, close } = createDb(url);
  try {
    await lock`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
    await lock.end();
  }
}
