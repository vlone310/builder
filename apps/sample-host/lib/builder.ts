import { createDeliveryClient } from "@builder/core";
import { cache } from "react";

export const locale = process.env.BUILDER_LOCALE ?? "en";

function client() {
  const baseUrl = process.env.BUILDER_DELIVERY_URL;
  const deliveryKey = process.env.BUILDER_DELIVERY_KEY;
  if (!baseUrl || !deliveryKey) {
    throw new Error("BUILDER_DELIVERY_URL and BUILDER_DELIVERY_KEY must be set");
  }
  return createDeliveryClient({ baseUrl, deliveryKey });
}

/**
 * Deduplicated per request, so metadata and the page share one fetch. Caching is
 * left to the route (ISR) so there is one staleness window, not a fetch cache
 * stacked on top of it. Publish webhooks will revalidate on demand (phase 3).
 */
export const fetchPage = cache(async (slug: string[] | undefined) =>
  client().getPage({ slug, locale }),
);
