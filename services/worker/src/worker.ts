import { signWebhook, WEBHOOK_SIGNATURE_HEADER } from "@builder/core";
import { type Db, jobs, webhooks } from "@builder/db";
import { eq, inArray, sql } from "drizzle-orm";
import { assertPublicHost } from "./network";
import type { CdnPurger } from "./purge";

/**
 * The worker is a platform process: it reads the outbox of every org as the
 * table owner (outside row-level security) and only ever sends what the
 * Content API queued.
 */

export interface WorkerOptions {
  db: Db;
  purger: CdnPurger;
  /** Allow webhook URLs that resolve to private or loopback addresses (dev only). */
  allowPrivateAddresses?: boolean;
  fetch?: typeof fetch;
  batchSize?: number;
  requestTimeoutMs?: number;
  /** Only this org's jobs (per-tenant workers, tests). Default: every org. */
  orgId?: string;
  log?: (message: string) => void;
}

type JobRow = typeof jobs.$inferSelect;

const LEASE_SECONDS = 60;

/** Delay before retry n (1-based): 10 s, 20 s, 40 s … capped at an hour, with ±20% jitter. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(10_000 * 2 ** (attempt - 1), 3_600_000);
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Claims due jobs with a lease, so several workers never send the same job twice at once. */
async function claim(db: Db, batchSize: number, orgId: string | null): Promise<JobRow[]> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE jobs SET locked_until = now() + make_interval(secs => ${LEASE_SECONDS}), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'pending' AND next_attempt_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
        AND (${orgId}::text IS NULL OR org_id = ${orgId})
      ORDER BY next_attempt_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  return db.select().from(jobs).where(inArray(jobs.id, ids));
}

async function deliverWebhook(job: JobRow, options: WorkerOptions): Promise<number> {
  if (!job.webhookId) throw new Error("Webhook job has no webhook");
  const [webhook] = await options.db.select().from(webhooks).where(eq(webhooks.id, job.webhookId));
  if (!webhook) throw new Error("Webhook was deleted");
  const url = new URL(webhook.url);
  if (!options.allowPrivateAddresses) await assertPublicHost(url.hostname);

  const body = JSON.stringify(job.payload);
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "builder-webhooks/1",
      "builder-delivery": job.id,
      [WEBHOOK_SIGNATURE_HEADER]: await signWebhook(webhook.secret, body),
    },
    body,
    // A redirect could point anywhere, including private addresses: never follow.
    redirect: "manual",
    signal: AbortSignal.timeout(options.requestTimeoutMs ?? 10_000),
  });
  await response.body?.cancel();
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`Endpoint answered ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return response.status;
}

async function runJob(
  job: JobRow,
  options: WorkerOptions,
): Promise<"succeeded" | "retry" | "failed"> {
  try {
    let statusCode: number | null = null;
    if (job.kind === "webhook") {
      statusCode = await deliverWebhook(job, options);
    } else {
      await options.purger.purgeTags((job.payload as { tags: string[] }).tags);
    }
    await options.db
      .update(jobs)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        lockedUntil: null,
        lastStatusCode: statusCode,
        lastError: null,
      })
      .where(eq(jobs.id, job.id));
    return "succeeded";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = (error as { status?: number }).status ?? null;
    const exhausted = job.attempts >= job.maxAttempts;
    await options.db
      .update(jobs)
      .set({
        status: exhausted ? "failed" : "pending",
        lastError: message.slice(0, 1000),
        lastStatusCode: statusCode,
        lockedUntil: null,
        ...(exhausted
          ? { finishedAt: new Date() }
          : { nextAttemptAt: new Date(Date.now() + backoffMs(job.attempts)) }),
      })
      .where(eq(jobs.id, job.id));
    options.log?.(`job ${job.id} (${job.kind}) attempt ${job.attempts} failed: ${message}`);
    return exhausted ? "failed" : "retry";
  }
}

export interface RunResult {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
}

/** Sends every due job once. Safe to call from several processes or a cron. */
export async function runOnce(options: WorkerOptions): Promise<RunResult> {
  const claimed = await claim(options.db, options.batchSize ?? 25, options.orgId ?? null);
  const outcomes = await Promise.all(claimed.map((job) => runJob(job, options)));
  return {
    claimed: claimed.length,
    succeeded: outcomes.filter((o) => o === "succeeded").length,
    retried: outcomes.filter((o) => o === "retry").length,
    failed: outcomes.filter((o) => o === "failed").length,
  };
}
