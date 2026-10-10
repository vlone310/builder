import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createDb, runMigrations } from "@builder/db";
import { seedDemo } from "@builder/db/seed";
import { EMAIL_OUTBOX } from "./playwright.config";

export default async function globalSetup() {
  const url =
    process.env.E2E_DATABASE_URL ?? "postgres://builder:builder@localhost:5432/builder_e2e";
  await mkdir(dirname(EMAIL_OUTBOX), { recursive: true });
  await writeFile(EMAIL_OUTBOX, "");
  await runMigrations(url);
  const { db, close } = createDb(url);
  try {
    await seedDemo(db);
  } finally {
    await close();
  }
}
