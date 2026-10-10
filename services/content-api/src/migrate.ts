/** Applies pending database migrations; the deploy's pre-deploy step runs it. */
import { runMigrations } from "@builder/db";

await runMigrations();
console.log("Migrations applied");
