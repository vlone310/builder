import { runMigrations } from "../migrate";

await runMigrations();
console.log("Migrations applied");
