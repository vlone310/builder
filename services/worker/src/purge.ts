/** CDN purge by cache tag. Adapters stay small so other CDNs slot in later. */
export interface CdnPurger {
  readonly name: string;
  purgeTags(tags: string[]): Promise<void>;
}

/** No CDN in front of the Delivery API: nothing to purge. */
export const noopPurger: CdnPurger = {
  name: "none",
  async purgeTags() {},
};

const CLOUDFLARE_TAGS_PER_REQUEST = 30;

/** Cloudflare's purge-by-tag API; the Delivery API sets matching Cache-Tag headers. */
export function cloudflarePurger(options: {
  zoneId: string;
  apiToken: string;
  fetch?: typeof fetch;
}): CdnPurger {
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    name: "cloudflare",
    async purgeTags(tags) {
      for (let i = 0; i < tags.length; i += CLOUDFLARE_TAGS_PER_REQUEST) {
        const response = await doFetch(
          `https://api.cloudflare.com/client/v4/zones/${options.zoneId}/purge_cache`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${options.apiToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ tags: tags.slice(i, i + CLOUDFLARE_TAGS_PER_REQUEST) }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
        if (!response.ok || !result?.success) {
          throw new Error(`Cloudflare purge failed with ${response.status}`);
        }
      }
    },
  };
}
