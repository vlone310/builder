import { CURRENT_SCHEMA_VERSION, type PageDocument, richTextFromString } from "@builder/core";
import { eq } from "drizzle-orm";
import { type Db, hashApiKey, newId, withOrg } from "./client";
import { apiKeys, environments, orgs, pages, revisions, sites } from "./schema";

export const DEMO_ORG_ID = "org_demo";
export const DEMO_SITE_ID = "st_demo";
/** Only for local development; never use a fixed key anywhere else. */
export const DEMO_DELIVERY_KEY = "bk_dlv_local_dev_only_000000000000";

type Root = PageDocument["root"];

const homeRoot: Root = {
  id: "home-hero",
  type: "core/section@1",
  props: { padding: "lg", background: "dark" },
  slots: {
    children: [
      {
        id: "home-title",
        type: "core/heading@1",
        props: { text: "Bet smarter with live odds", level: 1 },
      },
      {
        id: "home-intro",
        type: "core/rich-text@1",
        props: {
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "This page is stored as JSON and rendered by the " },
                  { type: "text", text: "sample host app", marks: ["bold"] },
                  { type: "text", text: " with its own components." },
                ],
              },
            ],
          },
        },
      },
      {
        id: "home-cta",
        type: "core/button@1",
        props: {
          link: { href: "/sports/football", label: "See football odds" },
          variant: "primary",
        },
      },
    ],
  },
};

const footballRoot: Root = {
  id: "fb-section",
  type: "core/section@1",
  props: { padding: "md" },
  slots: {
    children: [
      { id: "fb-title", type: "core/heading@1", props: { text: "Football odds", level: 1 } },
      {
        id: "fb-epl",
        type: "igaming/odds-table@1",
        props: { league: "epl", rows: 5, title: richTextFromString("Premier League") },
        slots: {
          footer: [{ id: "fb-disclaimer", type: "igaming/disclaimer@1", props: { variant: "uk" } }],
        },
      },
      { id: "fb-missing", type: "acme/not-installed@1", props: {} },
    ],
  },
};

const demoPages: Array<{
  id: string;
  slug: string;
  title: string;
  description: string;
  root: Root;
}> = [
  {
    id: "pg_demo_home",
    slug: "/",
    title: "Demo Sportsbook",
    description: "A page rendered from JSON",
    root: homeRoot,
  },
  {
    id: "pg_demo_football",
    slug: "/sports/football",
    title: "Football odds",
    description: "Live odds for top leagues",
    root: footballRoot,
  },
];

/** Recreates the demo org with a site, a dev environment, a delivery key and two published pages. */
export async function seedDemo(db: Db): Promise<{ deliveryKey: string }> {
  await withOrg(db, DEMO_ORG_ID, async (tx) => {
    await tx.delete(orgs).where(eq(orgs.id, DEMO_ORG_ID));
    await tx.insert(orgs).values({ id: DEMO_ORG_ID, name: "Demo Sportsbook" });
    await tx.insert(sites).values({ id: DEMO_SITE_ID, orgId: DEMO_ORG_ID, name: "Demo site" });
    await tx.insert(environments).values({
      id: newId("env"),
      orgId: DEMO_ORG_ID,
      siteId: DEMO_SITE_ID,
      name: "dev",
      hostUrl: "http://localhost:3000",
      allowedOrigin: "http://localhost:5173",
    });
    await tx.insert(apiKeys).values({
      id: newId("key"),
      orgId: DEMO_ORG_ID,
      siteId: DEMO_SITE_ID,
      kind: "delivery",
      hash: hashApiKey(DEMO_DELIVERY_KEY),
    });

    for (const page of demoPages) {
      const revisionId = newId("rev");
      const document: PageDocument = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        page: {
          id: page.id,
          siteId: DEMO_SITE_ID,
          kind: "page",
          locale: "en",
          slug: page.slug,
          seo: { title: page.title, description: page.description },
        },
        root: page.root,
      };
      await tx.insert(pages).values({
        id: page.id,
        orgId: DEMO_ORG_ID,
        siteId: DEMO_SITE_ID,
        kind: "page",
        slug: page.slug,
        locale: "en",
      });
      await tx.insert(revisions).values({
        id: revisionId,
        orgId: DEMO_ORG_ID,
        pageId: page.id,
        tree: document,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        status: "published",
        authorId: "seed",
      });
      await tx.update(pages).set({ publishedRevisionId: revisionId }).where(eq(pages.id, page.id));
    }
  });
  return { deliveryKey: DEMO_DELIVERY_KEY };
}
