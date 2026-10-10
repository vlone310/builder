import { writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { reseed, signIn, waitSaved } from "./helpers";

/**
 * Phase 2 gate: drag-and-drop across the iframe. Builds a long page, performs
 * inserts and moves (some needing auto-scroll), and records what the editor
 * measures: drag frame intervals, drop-target compute time, and the time from
 * sending a drop patch to the host confirming it rendered.
 */

const SECTIONS = 30;

function spikeContent() {
  const children = Array.from({ length: SECTIONS }, (_, i) => ({
    id: `s${i}`,
    type: "core/section@1",
    props: { padding: "sm", background: i % 2 ? "muted" : "default" },
    slots: {
      children: [
        { id: `s${i}-h`, type: "core/heading@1", props: { text: `Section ${i}`, level: 2 } },
        {
          id: `s${i}-t`,
          type: "core/rich-text@1",
          props: {
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: `Body copy for section ${i}.` }],
                },
              ],
            },
          },
        },
        ...(i % 3 === 0
          ? [
              {
                id: `s${i}-o`,
                type: "igaming/odds-table@1",
                props: { league: i % 2 ? "laliga" : "epl", rows: 3 },
                slots: { footer: [] },
              },
            ]
          : []),
      ],
    },
  }));
  return {
    root: { id: "root", type: "core/section@1", props: { padding: "md" }, slots: { children } },
  };
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing`);
  return value;
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const value = sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
  return Math.round(value * 100) / 100;
};
const summary = (values: number[]) => ({
  count: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: values.length ? Math.round(Math.max(...values) * 100) / 100 : null,
});

async function dragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  holdMs = 0,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 30 });
  if (holdMs) await page.waitForTimeout(holdMs);
  await page.mouse.move(to.x + 1, to.y + 1, { steps: 2 });
  const indicator = page.getByTestId("drop-indicator");
  await expect(indicator).toBeVisible();
  await page.mouse.up();
}

test.beforeEach(reseed);

test("drag-and-drop spike", async ({ page, request }) => {
  test.setTimeout(180_000);
  const login = await request.post("http://localhost:4000/auth/dev-login", {
    data: { orgId: "org_demo", userId: "spike", role: "editor" },
  });
  const token = (await login.json()).token as string;
  const created = await request.post("http://localhost:4000/v1/sites/st_demo/pages", {
    headers: { authorization: `Bearer ${token}` },
    data: { kind: "page", locale: "en", slug: "/spike", content: spikeContent() },
  });
  expect(created.status()).toBe(201);

  await signIn(page);
  await page.getByRole("link", { name: /Demo site/ }).click();
  await page.getByRole("button", { name: /^\s*\/spike\s/ }).click();
  const canvas = page.frameLocator('iframe[title="Page canvas"]');
  await expect(canvas.getByRole("heading", { name: "Section 29" })).toBeAttached({
    timeout: 30_000,
  });
  await expect(canvas.getByText("Real Madrid vs Sevilla").first()).toBeAttached();

  const iframe = page.locator('iframe[title="Page canvas"]');
  const frame = must(await iframe.boundingBox(), "canvas iframe box");
  const palette = async (id: string) => {
    const box = must(await page.getByTestId(`palette-${id}`).boundingBox(), `palette ${id}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const insideFrame = (fx: number, fy: number) => ({
    x: frame.x + frame.width * fx,
    y: frame.y + frame.height * fy,
  });

  const scenarios: string[] = [];
  // 1. Inserts from the palette at different heights of the visible canvas.
  for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    await dragTo(page, await palette("core/heading"), insideFrame(0.5, fy));
    scenarios.push(`insert heading at ${Math.round(fy * 100)}% height`);
  }
  for (const fy of [0.3, 0.6]) {
    await dragTo(page, await palette("igaming/odds-table"), insideFrame(0.5, fy));
    scenarios.push(`insert odds table (loader) at ${Math.round(fy * 100)}% height`);
  }
  // 2. Moves with the selection handle.
  for (let i = 0; i < 5; i++) {
    await canvas.getByRole("heading", { name: `Section ${i + 1}`, exact: true }).click();
    // Selecting can smooth-scroll the node into view; grab the handle once it settles.
    let handle = must(await page.getByTestId("selection-handle").boundingBox(), "selection handle");
    await expect
      .poll(async () => {
        const next = must(
          await page.getByTestId("selection-handle").boundingBox(),
          "selection handle",
        );
        const settled = next.y === handle.y;
        handle = next;
        return settled;
      })
      .toBe(true);
    await dragTo(
      page,
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      insideFrame(0.5, 0.25 + i * 0.12),
    );
    scenarios.push(`move Section ${i + 1} heading`);
  }
  // 3. Inserts that auto-scroll: hold near the bottom edge, then drop.
  const hostFrame = must(await (await iframe.elementHandle())?.contentFrame(), "host frame");
  const scrollY = () => hostFrame.evaluate(() => window.scrollY);
  for (let i = 0; i < 3; i++) {
    const before = await scrollY();
    await dragTo(
      page,
      await palette("core/rich-text"),
      { x: frame.x + frame.width / 2, y: frame.y + frame.height - 20 },
      900,
    );
    expect(await scrollY()).toBeGreaterThan(before);
    scenarios.push("insert rich text after auto-scrolling down");
  }
  await waitSaved(page);

  const metrics = must(await page.evaluate(() => window.__builderMetrics?.()), "editor metrics");
  const result = {
    measuredAt: new Date().toISOString(),
    page: { sections: SECTIONS, nodes: await canvas.locator("[data-node-id]").count() },
    drops: metrics.drops,
    unchangedDrops: metrics.noopDrops,
    scenarios,
    patchToRenderedMs: summary(metrics.patchToRendered),
    dropTargetComputeMs: summary(metrics.dropTargetCompute),
    dragFrameIntervalMs: summary(metrics.dragFrames),
  };
  writeFileSync("results/spike.json", `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));

  // Gate thresholds (see docs/phase-2-spike.md).
  expect(metrics.drops).toBe(scenarios.length);
  // Every drop that changed the page was rendered by the host and confirmed.
  expect(metrics.patchToRendered.length).toBe(metrics.drops - metrics.noopDrops);
  expect(must(result.patchToRenderedMs.p95, "p95")).toBeLessThan(100);
  expect(must(result.dropTargetComputeMs.p95, "p95")).toBeLessThan(4);
  expect(must(result.dragFrameIntervalMs.p50, "p50")).toBeLessThan(20);
});
