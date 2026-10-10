import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createDeliveryClient,
  createRegistry,
  defineComponent,
  FIELD_KEYWORD,
  fields,
  isSafeUrl,
  normalizeSlug,
  type PageDocument,
  parseNodeType,
  prepareNode,
  toManifest,
  validatePage,
} from "./index";

const render = () => null;

const section = defineComponent({
  id: "core/section",
  version: "1.0.0",
  label: "Section",
  props: z.object({ padding: z.enum(["sm", "md", "lg"]).default("md") }),
  slots: { children: {} },
  render,
});

const oddsTable = defineComponent({
  id: "igaming/odds-table",
  version: "2.1.0",
  label: "Odds Table",
  category: "Sports",
  props: z.object({
    league: fields.dynamicSelect({ source: "leagues" }),
    rows: z.number().int().min(1).max(50).default(10),
    title: fields.richText().optional(),
  }),
  slots: { footer: { allow: ["core/*", "igaming/disclaimer"], max: 2 } },
  constraints: { placement: "section", maxPerPage: 1 },
  loader: async ({ props }) => ({ league: props.league }),
  migrations: { 1: (old) => ({ ...old, rows: old.limit }) },
  render,
});

const disclaimer = defineComponent({
  id: "igaming/disclaimer",
  version: "2.0.0",
  label: "Disclaimer",
  props: z.object({ variant: z.enum(["uk", "eu"]) }),
  migrations: { 1: (old) => ({ variant: old.region }) },
  render,
});

const registry = createRegistry([section, oddsTable, disclaimer]);

function page(root: PageDocument["root"]): PageDocument {
  return {
    schemaVersion: 1,
    page: { id: "pg_1", siteId: "st_1", kind: "page", locale: "en", slug: "/" },
    root,
  };
}

describe("defineComponent", () => {
  it("derives the major from the version", () => {
    expect(oddsTable.major).toBe(2);
  });

  it("rejects bad ids and versions", () => {
    expect(() =>
      defineComponent({ id: "Bad", version: "1.0.0", label: "x", props: z.object({}), render }),
    ).toThrow(/Invalid component id/);
    expect(() =>
      defineComponent({ id: "a/b", version: "1.0", label: "x", props: z.object({}), render }),
    ).toThrow(/semver/);
  });

  it("requires a migration from every older major", () => {
    expect(() =>
      defineComponent({
        id: "a/b",
        version: "3.0.0",
        label: "x",
        props: z.object({}),
        migrations: { 1: (p) => p },
        render,
      }),
    ).toThrow(/missing a migration from major 2/);
  });
});

describe("toManifest", () => {
  it("exports props as JSON Schema with field hints", () => {
    const manifest = toManifest(oddsTable);
    const schema = manifest.propsSchema as {
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    expect(schema.properties.league).toMatchObject({
      type: "string",
      [FIELD_KEYWORD]: "dynamicSelect",
      source: "leagues",
    });
    expect(schema.properties.rows).toMatchObject({ type: "integer", default: 10, maximum: 50 });
    expect(schema.properties.title).toMatchObject({ [FIELD_KEYWORD]: "richText" });
    expect(schema.required).toEqual(["league"]);
    expect(manifest).toMatchObject({
      major: 2,
      hasLoader: true,
      migratesFrom: [1],
      constraints: { placement: "section" },
    });
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});

describe("parseNodeType / normalizeSlug", () => {
  it("parses node types", () => {
    expect(parseNodeType("igaming/odds-table@1")).toEqual({
      componentId: "igaming/odds-table",
      major: 1,
    });
    expect(parseNodeType("odds-table@1")).toBeNull();
    expect(parseNodeType("a/b")).toBeNull();
  });

  it("normalizes slugs", () => {
    expect(normalizeSlug(undefined)).toBe("/");
    expect(normalizeSlug(["sports", "football"])).toBe("/sports/football");
    expect(normalizeSlug("/sports//football/")).toBe("/sports/football");
    expect(normalizeSlug("/../etc")).toBe("/etc");
  });
});

describe("isSafeUrl", () => {
  it.each(["https://a.com", "/path", "#top", "mailto:a@b.c", "tel:+1", "page?x=1"])(
    "allows %s",
    (url) => {
      expect(isSafeUrl(url)).toBe(true);
    },
  );
  it.each([
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "",
  ])("rejects %s", (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });
});

describe("prepareNode", () => {
  it("applies defaults", () => {
    const result = prepareNode({ type: "core/section@1", props: {} }, registry);
    expect(result).toMatchObject({ ok: true, props: { padding: "md" } });
  });

  it("migrates props from an older major", () => {
    const result = prepareNode(
      { type: "igaming/odds-table@1", props: { league: "epl", limit: 5 } },
      registry,
    );
    expect(result).toMatchObject({ ok: true, props: { league: "epl", rows: 5 } });
  });

  it("refuses a major newer than the host", () => {
    expect(prepareNode({ type: "core/section@2", props: {} }, registry)).toMatchObject({
      ok: false,
      code: "unsupported_version",
    });
  });

  it("reports unknown components and invalid props", () => {
    expect(prepareNode({ type: "x/y@1", props: {} }, registry)).toMatchObject({
      ok: false,
      code: "unknown_component",
    });
    expect(
      prepareNode({ type: "igaming/odds-table@2", props: { league: "epl", rows: 99 } }, registry),
    ).toMatchObject({
      ok: false,
      code: "invalid_props",
      issues: [{ path: ["rows"] }],
    });
  });

  it("rejects unsafe URLs inside rich text", () => {
    const title = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "link", href: "javascript:alert(1)", content: [] }],
        },
      ],
    };
    expect(
      prepareNode({ type: "igaming/odds-table@2", props: { league: "epl", title } }, registry),
    ).toMatchObject({
      ok: false,
      code: "invalid_props",
    });
  });
});

describe("validatePage", () => {
  const valid = page({
    id: "n1",
    type: "core/section@1",
    props: { padding: "lg" },
    slots: {
      children: [
        {
          id: "n2",
          type: "igaming/odds-table@2",
          props: { league: "epl" },
          slots: { footer: [{ id: "n3", type: "igaming/disclaimer@1", props: { region: "uk" } }] },
        },
      ],
    },
  });

  it("accepts a valid page", () => {
    expect(validatePage(valid, registry)).toMatchObject({ valid: true });
  });

  it("checks structure without a registry", () => {
    expect(validatePage({ schemaVersion: 1, page: {}, root: {} })).toMatchObject({ valid: false });
    expect(validatePage(page({ id: "n1", type: "unknown/thing@1", props: {} }))).toMatchObject({
      valid: true,
    });
  });

  it("finds duplicate ids, bad slots, placement and limits", () => {
    const result = validatePage(
      page({
        id: "n1",
        type: "igaming/odds-table@2",
        props: { league: "epl" },
        slots: {
          footer: [
            { id: "n1", type: "igaming/odds-table@2", props: { league: "epl" } },
            { id: "n2", type: "core/section@1", props: {} },
            { id: "n3", type: "core/section@1", props: {} },
          ],
          other: [],
        },
      }),
      registry,
    );
    expect(result.valid).toBe(false);
    const codes = result.issues.map((issue) => issue.code).sort();
    expect(codes).toEqual([
      "duplicate_node_id",
      "max_per_page",
      "placement",
      "slot_full",
      "slot_not_allowed",
      "unknown_slot",
    ]);
  });
});

describe("createDeliveryClient", () => {
  it("fetches a page with the delivery key and passes extra options through", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(page({ id: "n1", type: "core/section@1", props: {} }))),
    );
    const client = createDeliveryClient({
      baseUrl: "https://d.test/",
      deliveryKey: "dk_1",
      fetch: fetchMock,
    });
    const result = await client.getPage(
      { slug: ["sports"], locale: "en" },
      { next: { tags: ["page"] } },
    );
    expect(result?.root.id).toBe("n1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe("https://d.test/v1/pages?slug=%2Fsports&locale=en");
    expect(init).toMatchObject({
      next: { tags: ["page"] },
      headers: { authorization: "Bearer dk_1" },
    });
  });

  it("returns null on 404 and throws on other errors", async () => {
    const client404 = createDeliveryClient({
      baseUrl: "https://d.test",
      deliveryKey: "k",
      fetch: async () => new Response("", { status: 404 }),
    });
    expect(await client404.getPage({ slug: "/", locale: "en" })).toBeNull();
    const client500 = createDeliveryClient({
      baseUrl: "https://d.test",
      deliveryKey: "k",
      fetch: async () => new Response("", { status: 500 }),
    });
    await expect(client500.getRegion({ name: "hero", locale: "en" })).rejects.toThrow(/500/);
  });
});
