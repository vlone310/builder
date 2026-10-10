/**
 * Creates a tenant: org, site, one environment, a delivery key and the publish
 * webhook pointing at the host app. Prints the secrets once.
 *
 *   pnpm --filter @builder/db bootstrap --org "Acme" --site "acme.com" \
 *     --host-url https://www.acme.com --env prod
 */
import { parseArgs } from "node:util";
import { createDb, generateApiKey, newId, withOrg } from "../client";
import { generateWebhookSecret } from "../publishing";
import { apiKeys, environments, orgs, sites, webhooks } from "../schema";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    org: { type: "string" },
    site: { type: "string" },
    "host-url": { type: "string" },
    env: { type: "string", default: "prod" },
    locale: { type: "string", default: "en" },
  },
});

if (!values.org || !values.site || !values["host-url"]) {
  console.error(
    "Usage: bootstrap --org <name> --site <name> --host-url <https://…> [--env prod] [--locale en]",
  );
  process.exit(1);
}
const hostUrl = new URL(values["host-url"]);

const orgId = newId("org");
const siteId = newId("st");
const envId = newId("env");
const deliveryKey = generateApiKey("delivery");
const webhookSecret = generateWebhookSecret();
const webhookUrl = new URL("/api/builder/revalidate", hostUrl).toString();

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
console.error("Store the delivery key and webhook secret now; they are not shown again.");
