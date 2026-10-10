import { randomBytes } from "node:crypto";
import { pageCacheTags, siteCacheTag, type TaggablePage, type WebhookPayload } from "@builder/core";
import { and, arrayContains, eq, sql } from "drizzle-orm";
import { type Db, hashApiKey, newId, type Tx } from "./client";
import { jobs, type WebhookEvent, webhooks } from "./schema";

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/** A preview token; store the hash, put the plaintext in the share link once. */
export function generatePreviewToken(): { plaintext: string; hash: string } {
  const plaintext = `bk_pvw_${randomBytes(24).toString("base64url")}`;
  return { plaintext, hash: hashApiKey(plaintext) };
}

/**
 * Queues what a publish or unpublish must trigger, inside the caller's
 * transaction: one signed webhook per subscribed endpoint and one CDN purge.
 * If the transaction rolls back, nothing is sent.
 */
export async function enqueuePageEvent(
  tx: Tx,
  input: {
    orgId: string;
    event: WebhookEvent;
    page: TaggablePage;
    revisionId: string | null;
    /** More tags to invalidate, e.g. the old address after a slug change. */
    extraTags?: string[];
  },
): Promise<{ jobIds: string[] }> {
  const pageTags = [...new Set([...pageCacheTags(input.page), ...(input.extraTags ?? [])])];
  const tags = [...pageTags, siteCacheTag(input.page.siteId)];
  const subscribed = await tx
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(
      and(eq(webhooks.siteId, input.page.siteId), arrayContains(webhooks.events, [input.event])),
    );

  const occurredAt = new Date().toISOString();
  const rows: Array<typeof jobs.$inferInsert> = subscribed.map((webhook) => {
    const id = newId("job");
    const payload: WebhookPayload = {
      id,
      type: input.event,
      occurredAt,
      page: input.page,
      revisionId: input.revisionId,
      tags: pageTags,
    };
    return {
      id,
      orgId: input.orgId,
      siteId: input.page.siteId,
      kind: "webhook",
      webhookId: webhook.id,
      payload,
    };
  });
  rows.push({
    id: newId("job"),
    orgId: input.orgId,
    siteId: input.page.siteId,
    kind: "cdn_purge",
    payload: { tags },
  });
  await tx.insert(jobs).values(rows);
  return { jobIds: rows.map((row) => row.id) };
}

export interface ResolvedPreviewLink {
  id: string;
  orgId: string;
  siteId: string;
  pageId: string;
  revisionId: string;
  expiresAt: Date;
}

/** Finds a live (unrevoked, unexpired) preview link by its token, across all orgs. */
export async function resolvePreviewLink(
  db: Db,
  token: string,
): Promise<ResolvedPreviewLink | null> {
  const rows = await db.execute<{
    id: string;
    org_id: string;
    site_id: string;
    page_id: string;
    revision_id: string;
    expires_at: string | Date;
  }>(sql`SELECT * FROM builder_resolve_preview_link(${hashApiKey(token)})`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    siteId: row.site_id,
    pageId: row.page_id,
    revisionId: row.revision_id,
    expiresAt: new Date(row.expires_at),
  };
}
