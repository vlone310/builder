import { expect, type FrameLocator, type Locator, type Page, test } from "@playwright/test";
import { openPage, reseed, signIn, waitSaved } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(reseed);

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Drags with real pointer input, pausing at the target so the indicator can be checked. */
async function drag(
  page: Page,
  from: Locator,
  to: { x: number; y: number },
  beforeDrop?: () => Promise<void>,
) {
  const start = await center(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 10, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await beforeDrop?.();
  await page.mouse.up();
}

/** Text of the section's direct child headings and tables, in DOM order. */
async function outline(canvas: FrameLocator) {
  return canvas
    .locator("h1, h2, h3, .odds-table, .disclaimer")
    .evaluateAll((elements) =>
      elements.map((el) =>
        el.classList.contains("odds-table")
          ? "[odds]"
          : el.classList.contains("disclaimer")
            ? "[disclaimer]"
            : el.textContent,
      ),
    );
}

test("inserts a component from the palette between two existing ones", async ({ page }) => {
  await signIn(page);
  const canvas = await openPage(page, "/sports/football");
  const odds = await center(canvas.locator(".odds-table"));

  await drag(
    page,
    page.getByTestId("palette-core/heading"),
    { x: odds.x, y: odds.box.y + 4 },
    async () => {
      await expect(page.getByTestId("drop-indicator")).toBeVisible();
    },
  );

  await expect.poll(() => outline(canvas)).toContain("Heading");
  const order = await outline(canvas);
  expect(order.indexOf("Heading")).toBe(order.indexOf("Football odds") + 1);
  // The new node is selected and editable straight away.
  await expect(page.getByTestId("props-panel").getByLabel(/^Text/)).toHaveValue("Heading");
  await waitSaved(page);
});

test("respects slot allow-lists and fills dynamic options from the host", async ({ page }) => {
  await signIn(page);
  const canvas = await openPage(page, "/sports/football");
  const footer = await center(canvas.locator(".disclaimer"));

  // The odds table footer accepts igaming/disclaimer: it lands inside the footer.
  await drag(page, page.getByTestId("palette-igaming/disclaimer"), {
    x: footer.x,
    y: footer.box.y + footer.box.height - 2,
  });
  await expect(canvas.locator(".odds-table .disclaimer")).toHaveCount(2);
  const panel = page.getByTestId("props-panel");
  await panel.getByLabel(/^Variant/).click();
  await page.getByRole("option", { name: "eu" }).click();
  await expect(canvas.getByText("Play responsibly")).toBeVisible();

  // An odds table is not allowed in that footer (core/* and disclaimers only), so the
  // same spot places it next to the table instead.
  await drag(page, page.getByTestId("palette-igaming/odds-table"), {
    x: footer.x,
    y: footer.box.y + 4,
  });
  await expect(canvas.locator(".odds-table .odds-table")).toHaveCount(0);

  // The new odds table has no league yet: the host reports invalid props, the panel shows why,
  // and the league list comes from the host app (resolveOptions).
  await expect(panel.getByRole("alert")).toContainText(/league/i);
  await panel.getByLabel(/^League/).click();
  await page.getByRole("option", { name: "La Liga" }).click();
  await expect(canvas.getByText("Real Madrid vs Sevilla")).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await waitSaved(page);
});

test("moves a node with the selection handle and with the keyboard", async ({ page }) => {
  await signIn(page);
  const canvas = await openPage(page, "/sports/football");

  await canvas.getByRole("heading", { name: "Football odds" }).click();
  const odds = await center(canvas.locator(".odds-table"));
  await drag(page, page.getByTestId("selection-handle"), {
    x: odds.x,
    y: odds.box.y + odds.box.height + 2,
  });
  // Rendering crosses the iframe asynchronously, so poll the order rather than read it once.
  const headingAfterTable = async () => {
    const order = await outline(canvas);
    return order.indexOf("Football odds") > order.indexOf("[odds]");
  };
  await expect.poll(headingAfterTable).toBe(true);

  // Alt+ArrowUp moves it back one step.
  await page.locator("body").press("Alt+ArrowUp");
  await expect.poll(headingAfterTable).toBe(false);
  await waitSaved(page);
});

test("Escape cancels a drag", async ({ page }) => {
  await signIn(page);
  const canvas = await openPage(page, "/sports/football");
  const before = await outline(canvas);
  const odds = await center(canvas.locator(".odds-table"));
  await drag(
    page,
    page.getByTestId("palette-core/heading"),
    { x: odds.x, y: odds.box.y + 4 },
    async () => {
      await page.keyboard.press("Escape");
    },
  );
  await expect(page.getByTestId("drop-indicator")).toHaveCount(0);
  expect(await outline(canvas)).toEqual(before);
});

test("publishes the draft to the Delivery API", async ({ page, request }) => {
  await signIn(page);
  const canvas = await openPage(page, "/sports/football");
  await canvas.getByRole("heading", { name: "Football odds" }).click();
  await page.getByTestId("props-panel").getByLabel(/^Text/).fill("Published from the editor");
  await waitSaved(page);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();

  const response = await request.get(
    "http://localhost:4001/v1/sites/st_demo/pages?slug=/sports/football&locale=en",
    {
      headers: { authorization: "Bearer bk_dlv_local_dev_only_000000000000" },
    },
  );
  expect(JSON.stringify(await response.json())).toContain("Published from the editor");
});
