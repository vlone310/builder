import { migrateDocument, normalizeSlug, type PageDocument } from "./document";

export interface DeliveryClientOptions {
  /** Delivery API origin, e.g. https://delivery.example.com */
  baseUrl: string;
  /** The site the delivery key belongs to; part of every URL, so CDN caches never mix sites. */
  siteId: string;
  /** The site's delivery key. */
  deliveryKey: string;
  /** Override for tests or runtimes without a global fetch. */
  fetch?: typeof fetch;
}

/**
 * Extra fetch options are passed through untouched, so framework adapters can add
 * their own (Next.js uses { next: { tags, revalidate } }).
 */
export type DeliveryRequestInit = RequestInit & Record<string, unknown>;

export interface DeliveryClient {
  getPage(
    query: { slug: string | readonly string[] | undefined; locale: string },
    init?: DeliveryRequestInit,
  ): Promise<PageDocument | null>;
  getRegion(
    query: { name: string; locale: string },
    init?: DeliveryRequestInit,
  ): Promise<PageDocument | null>;
  /** The draft revision a preview link points at; null when the link is invalid or expired. */
  getPreview(token: string, init?: DeliveryRequestInit): Promise<PreviewDocument | null>;
}

export interface PreviewDocument extends PageDocument {
  preview: { revisionId: string; expiresAt: string };
}

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}

export function createDeliveryClient(options: DeliveryClientOptions): DeliveryClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = `${options.baseUrl.replace(/\/+$/, "")}/v1/sites/${encodeURIComponent(options.siteId)}`;

  async function get(path: string, params: Record<string, string>, init?: DeliveryRequestInit) {
    const url = `${baseUrl}${path}?${new URLSearchParams(params).toString()}`;
    const response = await doFetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.headers as Record<string, string> | undefined),
        authorization: `Bearer ${options.deliveryKey}`,
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new DeliveryError(`Delivery API ${response.status} for ${path}`, response.status);
    }
    return migrateDocument(await response.json());
  }

  return {
    getPage: ({ slug, locale }, init) => get("/pages", { slug: normalizeSlug(slug), locale }, init),
    getRegion: ({ name, locale }, init) =>
      get(`/regions/${encodeURIComponent(name)}`, { locale }, init),
    getPreview: async (token, init) => {
      const document = await get("/preview", { token }, { cache: "no-store", ...init });
      return document as PreviewDocument | null;
    },
  };
}
