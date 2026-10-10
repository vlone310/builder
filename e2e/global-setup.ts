import { createDb, runMigrations } from "@builder/db";
import { seedDemo } from "@builder/db/seed";

export default async function globalSetup() {
  const url =
    process.env.E2E_DATABASE_URL ?? "postgres://builder:builder@localhost:5432/builder_e2e";
  await runMigrations(url);
  const { db, close } = createDb(url);
  try {
    await seedDemo(db);
  } finally {
    await close();
  }
}
