import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * Runs the built apps the way a tenant would: Content and Delivery APIs, the
 * outbox worker, the sample Next.js host and the editor, against E2E_DATABASE_URL (migrated and
 * seeded in global setup). Build first: pnpm turbo run build.
 */
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? "postgres://builder:builder@localhost:5432/builder_e2e";
const jwtSecret = "e2e-secret-that-is-at-least-32-characters-long";
/** The Content API writes sign-in and invite emails here; tests read the links. */
export const EMAIL_OUTBOX = fileURLToPath(new URL("results/outbox.jsonl", import.meta.url));
/** Keycloak with the builder realm: the local one if it runs, else a throwaway container. */
export const KEYCLOAK_URL = "http://localhost:8080";
const realmDir = fileURLToPath(new URL("../infra/keycloak/realm", import.meta.url));

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "results/report.json" }]],
  outputDir: "results/artifacts",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: [
    {
      command: [
        "docker run --rm --name builder-e2e-keycloak -p 8080:8080",
        "-e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin",
        "-e BUILDER_EDITOR_URL=http://localhost:5173",
        `-v ${realmDir}:/opt/keycloak/data/import:ro`,
        "keycloak/keycloak:26.7.5 start-dev --import-realm",
      ].join(" "),
      url: `${KEYCLOAK_URL}/realms/builder/.well-known/openid-configuration`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "node dist/server.js",
      cwd: "../services/content-api",
      url: "http://localhost:4000/health",
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: databaseUrl,
        PORT: "4000",
        CONTENT_API_JWT_SECRET: jwtSecret,
        CONTENT_API_PUBLIC_URL: "http://localhost:4000",
        EDITOR_ORIGIN: "http://localhost:5173",
        CONTENT_API_DEV_LOGIN: "1",
        KEYCLOAK_ISSUER: `${KEYCLOAK_URL}/realms/builder`,
        EMAIL_OUTBOX_FILE: EMAIL_OUTBOX,
      },
    },
    {
      command: "node dist/server.js",
      cwd: "../services/delivery-api",
      url: "http://localhost:4001/health",
      reuseExistingServer: !process.env.CI,
      env: { DATABASE_URL: databaseUrl, PORT: "4001" },
    },
    {
      command: "pnpm start",
      cwd: "../apps/sample-host",
      url: "http://localhost:3000/builder-edit",
      reuseExistingServer: !process.env.CI,
      env: {
        BUILDER_DELIVERY_URL: "http://localhost:4001",
        BUILDER_DELIVERY_KEY: "bk_dlv_local_dev_only_000000000000",
        BUILDER_CONTENT_API_URL: "http://localhost:4000",
        BUILDER_SITE_ID: "st_demo",
        BUILDER_ENV: "dev",
        BUILDER_EDITOR_ORIGIN: "http://localhost:5173",
        BUILDER_WEBHOOK_SECRET: "whsec_local_dev_only_00000000000000",
      },
    },
    {
      command: "node dist/server.js",
      cwd: "../services/worker",
      url: "http://localhost:4002/health",
      reuseExistingServer: !process.env.CI,
      // The demo webhook targets the host on localhost.
      env: {
        DATABASE_URL: databaseUrl,
        PORT: "4002",
        WORKER_POLL_MS: "300",
        WEBHOOK_ALLOW_PRIVATE: "1",
      },
    },
    {
      command: "pnpm preview",
      cwd: "../apps/editor",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
