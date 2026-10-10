/**
 * Creates a tenant: org, site, one environment, a delivery key and the publish
 * webhook pointing at the host app, and an admin invite for the first person
 * to sign in. Prints the secrets and the invite link once.
 *
 *   pnpm --filter @builder/db bootstrap --org "Acme" --site "acme.com" \
 *     --host-url https://www.acme.com --env prod \
 *     --admin-email ada@acme.com --editor-url https://editor.example.com
 */
import { parseArgs } from "node:util";
import { createDb, generateApiKey, newId, withOrg } from "../client";
import { generateInviteToken, normalizeEmail } from "../identity";
import { generateWebhookSecret } from "../publishing";
import { apiKeys, environments, invites, orgs, sites, webhooks } from "../schema";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    org: { type: "string" },
    site: { type: "string" },
    "host-url": { type: "string" },
    env: { type: "string", default: "prod" },
    locale: { type: "string", default: "en" },
    "admin-email": { type: "string" },
    "editor-url": { type: "string", default: "http://localhost:5173" },
  },
});

if (!values.org || !values.site || !values["host-url"] || !values["admin-email"]) {
  console.error(
    "Usage: bootstrap --org <name> --site <name> --host-url <https://…> --admin-email <email>\n" +
      "                 [--editor-url <https://…>] [--env prod] [--locale en]",
  );
  process.exit(1);
}
const hostUrl = new URL(values["host-url"]);
const editorUrl = new URL(values["editor-url"] as string);

const orgId = newId("org");
const siteId = newId("st");
const envId = newId("env");
const deliveryKey = generateApiKey("delivery");
const webhookSecret = generateWebhookSecret();
const webhookUrl = new URL("/api/builder/revalidate", hostUrl).toString();
const invite = generateInviteToken();
const adminEmail = normalizeEmail(values["admin-email"]);
const inviteUrl = new URL(`#/invite/${invite.plaintext}`, editorUrl).toString();

const { db, close } = createDb();
try {
  await withOrg(db, orgId, async (tx) => {
    await tx.insert(orgs).values({ id: orgId, name: values.org as string });
    await tx
      .insert(sites)
      .values({ id: siteId, orgId, name: values.site as string, defaultLocale: values.locale });
    await tx.insert(environments).values({
      id: envId,
      orgId,
      siteId,
      name: values.env as string,
      hostUrl: hostUrl.toString(),
      allowedOrigin: hostUrl.origin,
    });
    await tx
      .insert(apiKeys)
      .values({ id: newId("key"), orgId, siteId, kind: "delivery", hash: deliveryKey.hash });
    await tx.insert(webhooks).values({
      id: newId("wh"),
      orgId,
      siteId,
      url: webhookUrl,
      secret: webhookSecret,
      events: ["page.published", "page.unpublished"],
    });
    await tx.insert(invites).values({
      id: newId("inv"),
      orgId,
      email: adminEmail,
      role: "admin",
      hash: invite.hash,
      invitedBy: "bootstrap",
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
  });
} finally {
  await close();
}

console.log(
  JSON.stringify(
    {
      orgId,
      siteId,
      envId,
      webhookUrl,
      adminInvite: { email: adminEmail, url: inviteUrl, expiresInDays: 7 },
      hostAppEnv: {
        BUILDER_SITE_ID: siteId,
        BUILDER_ENV: values.env,
        BUILDER_LOCALE: values.locale,
        BUILDER_DELIVERY_KEY: deliveryKey.plaintext,
        BUILDER_WEBHOOK_SECRET: webhookSecret,
      },
    },
    null,
    2,
  ),
);
console.error(
  "Store the delivery key and webhook secret now, and send the invite link to the admin; none of them are shown again.",
);
