import { createDb } from "../client";
import { DEMO_ORG_ID, DEMO_SITE_ID, seedDemo } from "../seed";

const { db, close } = createDb();
try {
  const { deliveryKey } = await seedDemo(db);
  console.log(`Seeded org ${DEMO_ORG_ID}, site ${DEMO_SITE_ID}`);
  console.log(`Delivery key: ${deliveryKey}`);
} finally {
  await close();
}
