import { type BuilderPages, createBuilderPages } from "@builder/next";
import { builderConfig } from "@/builder/config";

export const locale = process.env.BUILDER_LOCALE ?? "en";

// Created on first use, so `next build` does not need the delivery key.
let pages: BuilderPages | undefined;
const builder = () => {
  pages ??= createBuilderPages(builderConfig());
  return pages;
};

/**
 * Page fetches tagged by address and site and cached for an hour; the publish
 * webhook (app/api/builder/revalidate) refreshes them the moment a page changes.
 * Deduplicated per request, so metadata and the page share one fetch.
 */
export const fetchPage: BuilderPages["fetchPage"] = (slug, pageLocale) =>
  builder().fetchPage(slug, pageLocale);
export const fetchRegion: BuilderPages["fetchRegion"] = (name, regionLocale) =>
  builder().fetchRegion(name, regionLocale);
