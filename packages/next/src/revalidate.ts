import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookPayload,
} from "@builder/core";
import { revalidateTag } from "next/cache.js";

export interface RevalidateHandlerConfig {
  /** The webhook's signing secret; pass two during a rotation. */
  secret: string | readonly string[];
  /** Called after revalidating, e.g. for logging. */
  onEvent?: (payload: WebhookPayload) => void | Promise<void>;
  /** For tests: replaces next/cache's revalidateTag. */
  revalidate?: (tag: string) => void;
}

/**
 * Route handler for the platform's publish webhook. Mount it at the URL you
 * register as the site's webhook, e.g. app/api/builder/revalidate/route.ts:
 *   export const { POST } = createRevalidateHandler({ secret: process.env.BUILDER_WEBHOOK_SECRET! });
 */
export function createRevalidateHandler(config: RevalidateHandlerConfig) {
  // expire: 0 → the next visitor gets a fresh render, not one more stale one.
  const revalidate = config.revalidate ?? ((tag: string) => revalidateTag(tag, { expire: 0 }));

  async function POST(request: Request): Promise<Response> {
    const body = await request.text();
    const valid = await verifyWebhookSignature(
      config.secret,
      request.headers.get(WEBHOOK_SIGNATURE_HEADER),
      body,
    );
    if (!valid) return Response.json({ error: "Invalid or stale signature" }, { status: 401 });

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body) as WebhookPayload;
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const tags = Array.isArray(payload.tags)
      ? payload.tags.filter((tag) => typeof tag === "string")
      : [];
    for (const tag of tags) revalidate(tag);
    await config.onEvent?.(payload);
    return Response.json({ revalidated: tags });
  }

  return { POST };
}
