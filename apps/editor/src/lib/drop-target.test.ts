import type { ComponentManifest, PageDocument } from "@builder/core";
import { describe, expect, it } from "vitest";
import { computeDropTarget, type Layout, rejectReason } from "./drop-target";

const manifest = (id: string, extra: Partial<ComponentManifest> = {}): ComponentManifest => ({
  id,
  version: "1.0.0",
  major: 1,
  label: id,
  propsSchema: {},
  slots: {},
  constraints: {},
  hasLoader: false,
  migratesFrom: [],
  ...extra,
});

const manifests = new Map(
  [
    manifest("core/section", { slots: { children: {} } }),
    manifest("core/heading", { constraints: { placement: "section" } }),
    manifest("core/root-only", { constraints: { placement: "root" } }),
    manifest("core/once", { constraints: { maxPerPage: 1 } }),
    manifest("igaming/odds", { slots: { footer: { allow: ["igaming/disclaimer"], max: 1 } } }),
    manifest("igaming/disclaimer"),
  ].map((m) => [m.id, m]),
);

const document: PageDocument = {
  schemaVersion: 1,
  page: { id: "pg", siteId: "st", kind: "page", locale: "en", slug: "/" },
  root: {
    id: "root",
    type: "core/section@1",
    props: {},
    slots: {
      children: [
        { id: "h1", type: "core/heading@1", props: {} },
        { id: "odds", type: "igaming/odds@1", props: {}, slots: { footer: [] } },
        {
          id: "inner",
          type: "core/section@1",
          props: {},
          slots: { children: [{ id: "h2", type: "core/heading@1", props: {} }] },
        },
        { id: "once", type: "core/once@1", props: {} },
      ],
    },
  },
};

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

// root section 0..800 x 0..1000, children stacked vertically
const layout: Layout = {
  boxes: [
    { nodeId: "root", rect: rect(0, 0, 800, 1000), parentId: null, slot: null, index: 0 },
    { nodeId: "h1", rect: rect(20, 20, 760, 60), parentId: "root", slot: "children", index: 0 },
    { nodeId: "odds", rect: rect(20, 100, 760, 300), parentId: "root", slot: "children", index: 1 },
    {
      nodeId: "inner",
      rect: rect(20, 420, 760, 300),
      parentId: "root",
      slot: "children",
      index: 2,
    },
    { nodeId: "h2", rect: rect(60, 460, 680, 60), parentId: "inner", slot: "children", index: 0 },
    { nodeId: "once", rect: rect(20, 740, 760, 60), parentId: "root", slot: "children", index: 3 },
  ],
  slots: [
    {
      nodeId: "root",
      slot: "children",
      rect: rect(20, 20, 760, 780),
      direction: "vertical",
      empty: false,
    },
    {
      nodeId: "odds",
      slot: "footer",
      rect: rect(40, 330, 720, 56),
      direction: "vertical",
      empty: true,
    },
    {
      nodeId: "inner",
      slot: "children",
      rect: rect(60, 460, 680, 60),
      direction: "vertical",
      empty: false,
    },
  ],
};

const heading = { componentId: "core/heading" };

describe("computeDropTarget", () => {
  it("places before the child whose midpoint is below the pointer", () => {
    expect(
      computeDropTarget({ x: 400, y: 30 }, layout, heading, document, manifests),
    ).toMatchObject({
      parentId: "root",
      slot: "children",
      index: 0,
      kind: "line",
      indicator: { y: 18 },
    });
    expect(
      computeDropTarget({ x: 400, y: 90 }, layout, heading, document, manifests),
    ).toMatchObject({ index: 1 });
    expect(
      computeDropTarget({ x: 400, y: 795 }, layout, heading, document, manifests),
    ).toMatchObject({ parentId: "root", index: 4, indicator: { y: 798 } });
  });

  it("prefers the innermost accepting slot", () => {
    expect(
      computeDropTarget({ x: 400, y: 500 }, layout, heading, document, manifests),
    ).toMatchObject({ parentId: "inner", index: 1 });
  });

  it("uses a container's nearest slot when over its padding", () => {
    expect(
      computeDropTarget({ x: 400, y: 700 }, layout, heading, document, manifests),
    ).toMatchObject({ parentId: "inner", index: 1 });
    // Hugging the container's bottom edge means "after the container".
    expect(
      computeDropTarget({ x: 400, y: 715 }, layout, heading, document, manifests),
    ).toMatchObject({ parentId: "root", index: 3 });
  });

  it("targets empty slots as a whole and honours allow-lists", () => {
    expect(
      computeDropTarget(
        { x: 400, y: 350 },
        layout,
        { componentId: "igaming/disclaimer" },
        document,
        manifests,
      ),
    ).toMatchObject({ parentId: "odds", slot: "footer", kind: "slot" });
    // A heading is not allowed in the footer, so it falls through to the root slot.
    expect(
      computeDropTarget({ x: 400, y: 350 }, layout, heading, document, manifests),
    ).toMatchObject({ parentId: "root", slot: "children", index: 2 });
  });

  it("never drops a node into itself", () => {
    expect(
      computeDropTarget(
        { x: 400, y: 500 },
        layout,
        { componentId: "core/section", nodeId: "inner" },
        document,
        manifests,
      ),
    ).toMatchObject({ parentId: "root" });
  });

  it("returns null outside every slot", () => {
    expect(
      computeDropTarget({ x: 2000, y: 2000 }, layout, heading, document, manifests),
    ).toBeNull();
  });
});

describe("rejectReason", () => {
  it("checks placement, maxPerPage, slot limits and unknown slots", () => {
    const target = { parentId: "root", slot: "children" };
    expect(rejectReason(document, manifests, { componentId: "core/root-only" }, target)).toMatch(
      /root/,
    );
    expect(rejectReason(document, manifests, { componentId: "core/once" }, target)).toMatch(
      /at most 1/,
    );
    expect(
      rejectReason(document, manifests, { componentId: "core/once", nodeId: "once" }, target),
    ).toBeNull();
    expect(
      rejectReason(document, manifests, heading, { parentId: "h1", slot: "children" }),
    ).toMatch(/no such slot/);
    const full: PageDocument = structuredClone(document);
    const odds = full.root.slots?.children?.[1];
    if (odds?.slots) odds.slots.footer = [{ id: "d", type: "igaming/disclaimer@1", props: {} }];
    expect(
      rejectReason(
        full,
        manifests,
        { componentId: "igaming/disclaimer" },
        { parentId: "odds", slot: "footer" },
      ),
    ).toMatch(/full/);
  });
});
