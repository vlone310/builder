/**
 * Shared by the platform and host apps: the cache tags a published page is
 * stored under (CDN and host caches alike), and the signature on publish webhooks.
 */

export interface TaggablePage {
  id: string;
  siteId: string;
  kind: "page" | "region";
  locale: string;
  slug?: string | null;
  name?: string | null;
}

/**
 * Tags for one page: by id, and by the address it is fetched at. The address tag
 * lets a host drop a cached 404 for a slug when a page is first published there.
 */
export function pageCacheTags(page: TaggablePage): string[] {
  const address =
    page.kind === "page"
      ? `builder:slug:${page.siteId}:${page.locale}:${page.slug ?? "/"}`
      : `builder:region:${page.siteId}:${page.locale}:${page.name ?? ""}`;
  return [`builder:page:${page.id}`, address];
}

/** Tag for every page of a site, for a full purge. */
export function siteCacheTag(siteId: string): string {
  return `builder:site:${siteId}`;
}

export const WEBHOOK_SIGNATURE_HEADER = "builder-signature";
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface WebhookPayload {
  /** Unique per delivery; hosts can ignore repeats. */
  id: string;
  type: "page.published" | "page.unpublished";
  occurredAt: string;
  page: TaggablePage;
  revisionId: string | null;
  /** Cache tags to revalidate. */
  tags: string[];
}

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` */
export async function signWebhook(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a webhook's signature and age. Several secrets may be passed during a
 * rotation; any match is accepted.
 */
export async function verifyWebhookSignature(
  secrets: string | readonly string[],
  header: string | null | undefined,
  body: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isInteger(timestamp) || !signature) return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) {
    return false;
  }
  for (const secret of typeof secrets === "string" ? [secrets] : secrets) {
    if (constantTimeEqual(await hmacHex(secret, `${timestamp}.${body}`), signature)) return true;
  }
  return false;
}
