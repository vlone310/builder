import { expect, test } from "@playwright/test";
import { openPage, reseed, signIn, waitSaved } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(reseed);

test("edits props live on the host canvas and saves a draft", async ({ page }) => {
  await signIn(page);
  const canvas = await openPage(page, "/sports/football");

  // The host renders the stored page with real loader data.
  await expect(canvas.getByRole("heading", { name: "Football odds" })).toBeVisible();
  await expect(canvas.getByText("Arsenal vs Chelsea")).toBeVisible();
  // The unknown component shows a placeholder in edit mode only.
  await expect(canvas.getByText(/acme\/not-installed@1/)).toBeVisible();

  // Clicking content selects it; the props panel edits it.
  await canvas.getByRole("heading", { name: "Football odds" }).click();
  const panel = page.getByTestId("props-panel");
  await expect(panel.getByText("Heading", { exact: true })).toBeVisible();
  await panel.getByLabel(/^Text/).fill("Football odds today");
  await expect(canvas.getByRole("heading", { name: "Football odds today" })).toBeVisible();
  await waitSaved(page);

  // Undo goes back through the host too.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(canvas.getByRole("heading", { name: "Football odds", exact: true })).toBeVisible();
  await waitSaved(page);
});
