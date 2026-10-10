import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { openPage, reseed, signIn, waitSaved } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeEach(reseed);

const HOST = "http://localhost:3000";
const CONTENT_API = "http://localhost:4000";

/** Reads the live page the way a visitor would: a fresh request, no cookies. */
async function live(request: APIRequestContext, path: string) {
  const response = await request.get(`${HOST}${path}`, {
    headers: { cookie: "" },
    maxRedirects: 0,
  });
  return { status: response.status(), html: await response.text() };
}

async function editorToken(request: APIRequestContext) {
  const login = await request.post(`${CONTENT_API}/auth/dev-login`, {
    data: { orgId: "org_demo", userId: "e2e-api", role: "editor" },
  });
  return (await login.json()).token as string;
}

async function editHeading(page: Page, from: string, to: string) {
  const canvas = await openPage(page, "/sports/football");
  await canvas.getByRole("heading", { name: from, exact: true }).click();
  await page.getByTestId("props-panel").getByLabel(/^Text/).fill(to);
  await expect(canvas.getByRole("heading", { name: to })).toBeVisible();
  await waitSaved(page);
}

test("a publish reaches the live site through the signed webhook, without waiting for ISR", async ({
  page,
  request,
}) => {
  // Warm the host's cache with the published version.
  expect((await live(request, "/sports/football")).html).toContain("Football odds");
  expect((await live(request, "/sports/football")).html).toContain("Football odds");

  await signIn(page);
  await editHeading(page, "Football odds", "Odds updated live");
  // Saving a draft changes nothing live.
  expect((await live(request, "/sports/football")).html).not.toContain("Odds updated live");

  const published = Date.now();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  // Worker → signed webhook → revalidateTag. The ISR window is an hour, so only
  // the webhook can make this pass.
  await expect
    .poll(async () => (await live(request, "/sports/football")).html, {
      timeout: 15_000,
      intervals: [250],
    })
    .toContain("Odds updated live");
  console.log(`publish → live in ${Date.now() - published} ms`);
});

test("a first publish replaces a cached 404, metadata included", async ({ request }) => {
  const token = await editorToken(request);
  const auth = { authorization: `Bearer ${token}` };

  // The slug is visited (and its 404 cached) before the page exists.
  expect((await live(request, "/launch")).status).toBe(404);
  expect((await live(request, "/launch")).status).toBe(404);

  const created = await request.post(`${CONTENT_API}/v1/sites/st_demo/pages`, {
    headers: auth,
    data: {
      kind: "page",
      locale: "en",
      slug: "/launch",
      content: {
        seo: { title: "Launch day" },
        root: {
          id: "n1",
          type: "core/section@1",
          props: {},
          slots: {
            children: [{ id: "n2", type: "core/heading@1", props: { text: "We are live" } }],
          },
        },
      },
    },
  });
  const { page, revisionId } = await created.json();
  await request.post(`${CONTENT_API}/v1/pages/${page.id}/publish`, {
    headers: auth,
    data: { revisionId },
  });

  await expect
    .poll(async () => (await live(request, "/launch")).status, {
      timeout: 15_000,
      intervals: [250],
    })
    .toBe(200);
  const { html } = await live(request, "/launch");
  expect(html).toContain("We are live");
  // The phase 1 follow-up: no stale 404 head after the page appears.
  expect(html).toContain("<title>Launch day</title>");
  expect(html).not.toContain('name="robots" content="noindex"');
});

test("a preview link shows the draft only to its holder, until revoked", async ({
  page,
  browser,
  request,
}) => {
  await signIn(page);
  await editHeading(page, "Football odds", "Draft for review");

  await page.getByRole("button", { name: "Share preview" }).click();
  const urlField = page.getByLabel("Preview URL");
  await expect(urlField).toHaveValue(/builder\.preview=bk_pvw_/);
  const previewUrl = await urlField.inputValue();

  // A reviewer without an editor account opens the link.
  const reviewer = await browser.newContext();
  const reviewerPage = await reviewer.newPage();
  await reviewerPage.goto(previewUrl);
  await expect(reviewerPage).toHaveURL(`${HOST}/sports/football`);
  await expect(reviewerPage.getByRole("heading", { name: "Draft for review" })).toBeVisible();
  await expect(reviewerPage.getByRole("status")).toContainText("Previewing an unpublished draft");

  // Everyone else still gets the published page.
  const visitor = await live(request, "/sports/football");
  expect(visitor.html).toContain("<h1>Football odds</h1>");
  expect(visitor.html).not.toContain("Draft for review");

  // Exit returns the reviewer to the live page.
  await reviewerPage.getByRole("link", { name: "Exit preview" }).click();
  await expect(reviewerPage.getByRole("heading", { name: "Football odds" })).toBeVisible();

  // After revoking, the link stops working.
  await page.getByRole("button", { name: "Revoke link" }).click();
  const revoked = await reviewer.newPage();
  const response = await revoked.goto(previewUrl);
  expect(response?.status()).toBe(401);
  await reviewer.close();
});
