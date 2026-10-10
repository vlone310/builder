import { expect, type Page, test } from "@playwright/test";
import { KEYCLOAK_URL } from "../playwright.config";
import { lastEmailTo, signIn } from "./helpers";

const CONTENT_API = "http://localhost:4000";
const PASSWORD = "e2e-Password-1";

/** Creates a verified user in the builder realm through Keycloak's admin API. */
async function keycloakUser(email: string) {
  const login = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: "admin",
      password: "admin",
    }),
  });
  const { access_token } = (await login.json()) as { access_token: string };
  const created = await fetch(`${KEYCLOAK_URL}/admin/realms/builder/users`, {
    method: "POST",
    headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
    body: JSON.stringify({
      username: email,
      email,
      emailVerified: true,
      enabled: true,
      firstName: "Pat",
      lastName: "Pilot",
      credentials: [{ type: "password", value: PASSWORD, temporary: false }],
    }),
  });
  expect(created.status).toBe(201);
}

/** Fills Keycloak's login form. */
async function keycloakLogin(page: Page, email: string) {
  await expect(page).toHaveURL(new RegExp(`^${KEYCLOAK_URL}/realms/builder/`));
  await page.locator("#username").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#kc-login").click();
}

async function adminInvite(request: import("@playwright/test").APIRequestContext, email: string) {
  // The dev login stands in for an admin's own sign-in.
  const login = await request.post(`${CONTENT_API}/auth/dev-login`, {
    data: { orgId: "org_demo", userId: "e2e-admin", role: "admin" },
  });
  const { token } = (await login.json()) as { token: string };
  const invite = await request.post(`${CONTENT_API}/v1/invites`, {
    headers: { authorization: `Bearer ${token}` },
    data: { email, role: "editor" },
  });
  expect(invite.status()).toBe(201);
  return (await invite.json()) as { url: string; emailed: boolean };
}

test("an invited person signs in with Keycloak, joins the org and signs out", async ({
  page,
  request,
}) => {
  const email = `pilot-${Date.now()}@example.com`;
  const { url, emailed } = await adminInvite(request, email);
  expect(emailed).toBe(true);
  expect((await lastEmailTo(email)).text).toContain(url);
  await keycloakUser(email);

  // The invite link sends them to Keycloak and back.
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Join Demo" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await keycloakLogin(page, email);
  await page.getByRole("button", { name: "Join Demo" }).click();

  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(page.getByText(`${email} · editor`)).toBeVisible();

  // A new tab signs in through Keycloak's session without the form, and lists them as a member.
  const second = await page.context().newPage();
  await second.goto("/#/members");
  await expect(second.getByRole("heading", { name: "Members" })).toBeVisible();
  await expect(second.getByText(email, { exact: true })).toBeVisible();
  await second.close();

  // Signing out ends the Keycloak session too.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Builder" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#username")).toBeVisible();
});

test("an invite for another address is refused", async ({ page, request }) => {
  const invited = `invited-${Date.now()}@example.com`;
  const other = `other-${Date.now()}@example.com`;
  const { url } = await adminInvite(request, invited);
  await keycloakUser(other);

  await page.goto(url);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await keycloakLogin(page, other);
  await expect(
    page.getByText(`This invite is for ${invited}, but you're signed in as ${other}.`),
  ).toBeVisible();
});

test("people without an account can register in Keycloak", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page).toHaveURL(new RegExp(`^${KEYCLOAK_URL}/realms/builder/`));
  await expect(page.getByRole("heading", { name: "Register" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
});

test("viewers see pages but no edit or publish controls", async ({ page }) => {
  await signIn(page, "viewer", "e2e-viewer");
  await page.getByRole("link", { name: /Demo site/ }).click();
  await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New page" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Publish webhooks" })).toHaveCount(0);
  await page.goto("/#/members");
  await expect(page.getByRole("heading", { name: "Invite people" })).toHaveCount(0);
});
