import { createRegistry, defineComponent, fields, type PageDocument } from "@builder/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type BuilderComponentProps, ResolvedPageView, RichText, resolvePage } from "./index";

const sectionProps = z.object({ padding: z.enum(["sm", "lg"]).default("sm") });

function Section({
  props,
  slots,
}: BuilderComponentProps<typeof sectionProps, undefined, "children">) {
  return <section className={`pad-${props.padding}`}>{slots.children}</section>;
}

const section = defineComponent({
  id: "core/section",
  version: "1.0.0",
  label: "Section",
  props: sectionProps,
  slots: { children: {} },
  render: Section,
});

const odds = defineComponent({
  id: "igaming/odds-table",
  version: "1.0.0",
  label: "Odds",
  props: z.object({
    league: fields.dynamicSelect({ source: "leagues" }),
    title: fields.richText().optional(),
  }),
  loader: async ({ props, ctx }) =>
    (ctx.odds as (league: string) => Promise<number[]>)(props.league),
  render: ({ props, data }) => (
    <div>
      <RichText value={props.title} />
      <ol>
        {data.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ol>
    </div>
  ),
});

const slow = defineComponent({
  id: "core/slow",
  version: "1.0.0",
  label: "Slow",
  props: z.object({}),
  loader: ({ signal }) =>
    new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("late"), 1000);
      signal.addEventListener("abort", () => clearTimeout(timer));
    }),
  render: ({ data }) => <p>{data}</p>,
});

const registry = createRegistry(section, odds, slow);

function doc(children: PageDocument["root"][]): PageDocument {
  return {
    schemaVersion: 1,
    page: { id: "pg_1", siteId: "st_1", kind: "page", locale: "en", slug: "/" },
    root: { id: "n1", type: "core/section@1", props: { padding: "lg" }, slots: { children } },
  };
}

const ctx = { odds: async (league: string) => (league === "epl" ? [1.5, 2.25] : []) };

async function render(page: PageDocument, options: Parameters<typeof resolvePage>[2] = {}) {
  const resolved = await resolvePage(page, registry, { ctx, onNodeError: () => {}, ...options });
  return renderToStaticMarkup(<ResolvedPageView page={resolved} />);
}

describe("resolvePage + ResolvedPageView", () => {
  it("renders nested slots with loader data and defaults", async () => {
    const html = await render(
      doc([{ id: "n2", type: "igaming/odds-table@1", props: { league: "epl" } }]),
    );
    expect(html).toBe(
      '<section class="pad-lg"><div><ol><li>1.5</li><li>2.25</li></ol></div></section>',
    );
  });

  it("drops broken nodes on the live site and reports them", async () => {
    const onNodeError = vi.fn();
    const html = await render(
      doc([
        { id: "n2", type: "acme/unknown@1", props: {} },
        { id: "n3", type: "igaming/odds-table@1", props: {} },
      ]),
      { onNodeError },
    );
    expect(html).toBe('<section class="pad-lg"></section>');
    expect(onNodeError.mock.calls.map(([error]) => error.code)).toEqual([
      "unknown_component",
      "invalid_props",
    ]);
  });

  it("shows placeholders and node ids in edit mode", async () => {
    const html = await render(doc([{ id: "n2", type: "acme/unknown@1", props: {} }]), {
      mode: "edit",
    });
    expect(html).toContain('data-node-id="n1"');
    expect(html).toContain('data-builder-placeholder="unknown_component"');
  });

  it("times out slow loaders without failing the page", async () => {
    const onNodeError = vi.fn();
    const html = await render(doc([{ id: "n2", type: "core/slow@1", props: {} }]), {
      loaderTimeoutMs: 20,
      onNodeError,
    });
    expect(html).toBe('<section class="pad-lg"></section>');
    expect(onNodeError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "loader_failed", nodeId: "n2" }),
    );
  });
});

describe("RichText", () => {
  it("renders marks, links and lists as plain elements", () => {
    const html = renderToStaticMarkup(
      <RichText
        value={{
          type: "doc",
          content: [
            { type: "heading", level: 2, content: [{ type: "text", text: "Hi", marks: ["bold"] }] },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "<script>x</script>" },
                {
                  type: "link",
                  href: "https://a.com",
                  newTab: true,
                  content: [{ type: "text", text: "a" }],
                },
                {
                  type: "link",
                  href: "javascript:alert(1)",
                  content: [{ type: "text", text: "b" }],
                },
              ],
            },
            { type: "list", items: [{ content: [{ type: "text", text: "one" }] }] },
          ],
        }}
      />,
    );
    expect(html).toBe(
      '<div><h2><strong>Hi</strong></h2><p>&lt;script&gt;x&lt;/script&gt;<a href="https://a.com" target="_blank" rel="noopener noreferrer">a</a><span>b</span></p><ul><li>one</li></ul></div>',
    );
  });
});
