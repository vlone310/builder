import { expect, test } from "@playwright/test";
import { lastEmailTo, signIn } from "./helpers";

const CONTENT_API = "http://localhost:4000";

test("an invited person signs in with an email link, joins the org and is signed out", async ({
  page,
  request,
}) => {
  const email = `pilot-${Date.now()}@example.com`;

  // An admin invites them (the dev login stands in for the admin's own sign-in).
  const login = await request.post(`${CONTENT_API}/auth/dev-login`, {
    data: { orgId: "org_demo", userId: "e2e-admin", role: "admin" },
  });
  const { token } = (await login.json()) as { token: string };
  const invite = await request.post(`${CONTENT_API}/v1/invites`, {
    headers: { authorization: `Bearer ${token}` },
    data: { email, role: "editor" },
  });
  expect(invite.status()).toBe(201);
  const { url, emailed } = (await invite.json()) as { url: string; emailed: boolean };
  expect(emailed).toBe(true);
  const inviteEmail = await lastEmailTo(email);
  expect(inviteEmail.text).toContain(url);

  // The invite link asks them to sign in as the invited address.
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Join Demo" })).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveValue(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText(`Check your inbox at ${email}`)).toBeVisible();

  // The magic link signs them in and brings them back to the invite.
  const signInEmail = await lastEmailTo(email);
  expect(signInEmail.subject).toBe("Sign in to Builder");
  const link = /(http\S+\/auth\/magic-link\/verify\S+)/.exec(signInEmail.text)?.[1];
  expect(link).toBeTruthy();
  await page.goto(link as string);
  await page.getByRole("button", { name: "Join Demo" }).click();

  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(page.getByText(`${email} · editor`)).toBeVisible();

  // The sign-in survives a new tab (cookie), and they appear as a member.
  const second = await page.context().newPage();
  await second.goto("/#/members");
  await expect(second.getByRole("heading", { name: "Members" })).toBeVisible();
  await expect(second.getByText(email, { exact: true })).toBeVisible();
  await second.close();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Builder" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to Builder" })).toBeVisible();
});

test("an uninvited address gets no email and a used link is refused", async ({ page }) => {
  const email = `stranger-${Date.now()}@example.com`;
  await page.goto("/");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  // Same answer as for a real account, so the form reveals nothing.
  await expect(page.getByText(`Check your inbox at ${email}`)).toBeVisible();

  await page.goto(
    `${CONTENT_API}/auth/magic-link/verify?token=not-a-real-token&callbackURL=${encodeURIComponent("http://localhost:5173/#/")}`,
  );
  await expect(page.getByText(/invalid or was already used/)).toBeVisible();
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
