import { createEditHandlers } from "@builder/next";
import { builderConfig } from "@/builder/config";
import { dataServices, LEAGUES } from "@/builder/data";
import { registry } from "@/builder/registry";

export const dynamic = "force-dynamic";

export const { POST } = createEditHandlers({
  ...builderConfig(),
  registry,
  ctx: () => ({ data: dataServices, locale: process.env.BUILDER_LOCALE ?? "en" }),
  options: {
    leagues: ({ query }) =>
      LEAGUES.filter((league) => league.label.toLowerCase().includes(query.toLowerCase())),
  },
});
