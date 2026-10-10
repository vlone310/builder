import {
  createDeliveryClient,
  normalizeSlug,
  type PageDocument,
  pageCacheTags,
  siteCacheTag,
} from "@builder/core";
import { cookies, draftMode } from "next/headers.js";
import { cache } from "react";

/** Cookie holding the preview link token while draft mode is on. */
export const PREVIEW_COOKIE = "builder_preview";

export interface BuilderPagesConfig {
  deliveryUrl: string;
  deliveryKey: string;
  siteId: string;
  /** Default locale for fetches. */
  locale: string;
  /**
   * Safety-net lifetime of cached pages in seconds. Publishing revalidates on
   * demand through the webhook, so this only matters if a webhook is lost.
   * Default 3600.
   */
  revalidateSeconds?: number;
}

export interface BuilderPages {
  /** The published page at a slug, or in draft mode the previewed revision of it. */
  fetchPage(
    slug: string | readonly string[] | undefined,
    locale?: string,
  ): Promise<PageDocument | null>;
  fetchRegion(name: string, locale?: string): Promise<PageDocument | null>;
}

/**
 * Data access for a Next.js host. Fetches carry cache tags for the page's
 * address and site, so a publish webhook (createRevalidateHandler) refreshes
 * exactly what changed, including a slug that used to be a 404.
 */
export function createBuilderPages(config: BuilderPagesConfig): BuilderPages {
  const client = createDeliveryClient({
    baseUrl: config.deliveryUrl,
    siteId: config.siteId,
    deliveryKey: config.deliveryKey,
  });
  const revalidate = config.revalidateSeconds ?? 3600;

  async function previewFor(
    match: (document: PageDocument) => boolean,
  ): Promise<PageDocument | null> {
    const draft = await draftMode();
    if (!draft.isEnabled) return null;
    // Reading cookies makes the render dynamic, which draft mode already is.
    const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
    if (!token) return null;
    const preview = await client.getPreview(token);
    // A preview link shows one page; other pages stay as published.
    return preview && match(preview) ? preview : null;
  }

  const fetchPage = cache(
    async (slug: string | readonly string[] | undefined, locale = config.locale) => {
      const normalized = normalizeSlug(slug);
      const preview = await previewFor(
        (document) => document.page.slug === normalized && document.page.locale === locale,
      );
      if (preview) return preview;
      const tags = [
        pageCacheTags({
          id: "",
          siteId: config.siteId,
          kind: "page",
          locale,
          slug: normalized,
        })[1] as string,
        siteCacheTag(config.siteId),
      ];
      return client.getPage({ slug: normalized, locale }, { next: { tags, revalidate } });
    },
  );

  const fetchRegion = cache(async (name: string, locale = config.locale) => {
    const preview = await previewFor(
      (document) =>
        document.page.kind === "region" &&
        document.page.name === name &&
        document.page.locale === locale,
    );
    if (preview) return preview;
    const tags = [
      pageCacheTags({ id: "", siteId: config.siteId, kind: "region", locale, name })[1] as string,
      siteCacheTag(config.siteId),
    ];
    return client.getRegion({ name, locale }, { next: { tags, revalidate } });
  });

  return { fetchPage, fetchRegion };
}
