import { expect, type FrameLocator, type Page } from "@playwright/test";

export async function signIn(page: Page, role = "editor", userId = "e2e") {
  await page.goto("/");
  await page.getByLabel("Organization id").fill("org_demo");
  await page.getByLabel("User id").fill(userId);
  await page.getByLabel("Role").click();
  await page.getByRole("option", { name: role, exact: true }).click();
  await page.getByRole("button", { name: "Dev sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
}

/** Opens a page in the editor and waits until the host has rendered it. */
export async function openPage(page: Page, slug: string): Promise<FrameLocator> {
  await page.getByRole("link", { name: /Demo site/ }).click();
  await page
    .getByRole("button", { name: new RegExp(`^\\s*${slug.replace(/\//g, "\\/")}\\s`) })
    .click();
  const canvas = page.frameLocator('iframe[title="Page canvas"]');
  await expect(page.getByTestId("palette-core/heading")).toBeVisible({ timeout: 30_000 });
  await expect(canvas.locator("[data-node-id]").first()).toBeVisible();
  // Loader-backed nodes render a skeleton first; wait for their data so tests see the settled page.
  await expect(canvas.locator("[data-builder-loading]")).toHaveCount(0);
  return canvas;
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", {
    timeout: 15_000,
  });
}

/** The iframe's position on the page, for turning canvas coordinates into mouse positions. */
export async function canvasOrigin(page: Page) {
  const box = await page.locator('iframe[title="Page canvas"]').boundingBox();
  if (!box) throw new Error("Canvas iframe is not visible");
  return box;
}

/**
 * Puts the demo org back to its seeded state so each test starts clean, then
 * tells the host to drop its cached pages, as a publish would.
 */
export async function reseed() {
  const { createDb } = await import("@builder/db");
  const { DEMO_SITE_ID, DEMO_WEBHOOK_SECRET, DEMO_WEBHOOK_URL, seedDemo } = await import(
    "@builder/db/seed"
  );
  const { signWebhook, siteCacheTag } = await import("@builder/core");
  const { db, close } = createDb(
    process.env.E2E_DATABASE_URL ?? "postgres://builder:builder@localhost:5432/builder_e2e",
  );
  try {
    await seedDemo(db);
  } finally {
    await close();
  }
  const body = JSON.stringify({
    id: `reseed-${Date.now()}`,
    type: "page.published",
    tags: [siteCacheTag(DEMO_SITE_ID)],
  });
  const response = await fetch(DEMO_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "builder-signature": await signWebhook(DEMO_WEBHOOK_SECRET, body),
    },
    body,
  }).catch(() => null);
  // Before the host is up (global setup) there is nothing cached to drop.
  if (response && !response.ok) throw new Error(`Host revalidate failed: ${response.status}`);
}

/** The newest email to an address in the Content API's e2e outbox. */
export async function lastEmailTo(to: string): Promise<{ subject: string; text: string }> {
  const { readFile } = await import("node:fs/promises");
  const { EMAIL_OUTBOX } = await import("../playwright.config");
  let found: { to: string; subject: string; text: string } | undefined;
  await expect
    .poll(async () => {
      const lines = (await readFile(EMAIL_OUTBOX, "utf8")).split("\n").filter(Boolean);
      found = lines
        .map((line) => JSON.parse(line) as { to: string; subject: string; text: string })
        .reverse()
        .find((message) => message.to === to);
      return found !== undefined;
    })
    .toBe(true);
  return found as { subject: string; text: string };
}
