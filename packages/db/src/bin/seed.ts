/**
 * Seeds the demo org. Optional settings:
 *   BUILDER_DEMO_WEBHOOK_URL   where the worker reaches the host (default http://localhost:3000/…)
 *   BUILDER_DEMO_ADMINS        comma-separated "<user id>:<email>" pairs made admins of the demo
 *                              org, e.g. a local Keycloak user (scripts/local/up.sh sets this)
 */
import { createDb } from "../client";
import { DEMO_ORG_ID, DEMO_SITE_ID, seedDemo } from "../seed";

const members = (process.env.BUILDER_DEMO_ADMINS ?? "")
  .split(",")
  .map((pair) => pair.trim())
  .filter(Boolean)
  .map((pair) => {
    const [userId, email] = pair.split(":");
    if (!userId || !email)
      throw new Error(`BUILDER_DEMO_ADMINS entry "${pair}" is not <id>:<email>`);
    return { userId, email, role: "admin" as const };
  });

const { db, close } = createDb();
try {
  const { deliveryKey } = await seedDemo(db, {
    members,
    ...(process.env.BUILDER_DEMO_WEBHOOK_URL
      ? { webhookUrl: process.env.BUILDER_DEMO_WEBHOOK_URL }
      : {}),
  });
  console.log(`Seeded org ${DEMO_ORG_ID}, site ${DEMO_SITE_ID}`);
  console.log(`Delivery key: ${deliveryKey}`);
  for (const member of members) console.log(`Admin: ${member.email}`);
} finally {
  await close();
}
