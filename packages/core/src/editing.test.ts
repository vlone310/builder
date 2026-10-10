import { describe, expect, it, vi } from "vitest";
import {
  applyPatch,
  createMessenger,
  duplicateNodeOps,
  findNode,
  insertNodeOps,
  type JsonPatchOp,
  manifestHash,
  moveNodeOps,
  type PageDocument,
  PatchError,
  removeNodeOps,
  setPropsOps,
  stableStringify,
} from "./index";

describe("applyPatch", () => {
  const cases: Array<[string, unknown, JsonPatchOp[], unknown]> = [
    [
      "add member",
      { foo: "bar" },
      [{ op: "add", path: "/baz", value: "qux" }],
      { foo: "bar", baz: "qux" },
    ],
    [
      "add array element",
      { foo: ["bar", "baz"] },
      [{ op: "add", path: "/foo/1", value: "qux" }],
      { foo: ["bar", "qux", "baz"] },
    ],
    ["append with -", { a: [1] }, [{ op: "add", path: "/a/-", value: 2 }], { a: [1, 2] }],
    ["remove member", { baz: "qux", foo: "bar" }, [{ op: "remove", path: "/baz" }], { foo: "bar" }],
    [
      "remove element",
      { foo: ["bar", "qux", "baz"] },
      [{ op: "remove", path: "/foo/1" }],
      { foo: ["bar", "baz"] },
    ],
    [
      "replace",
      { baz: "qux", foo: "bar" },
      [{ op: "replace", path: "/baz", value: "boo" }],
      { baz: "boo", foo: "bar" },
    ],
    [
      "move member",
      { foo: { bar: "baz", waldo: "fred" }, qux: { corge: "grault" } },
      [{ op: "move", from: "/foo/waldo", path: "/qux/thud" }],
      { foo: { bar: "baz" }, qux: { corge: "grault", thud: "fred" } },
    ],
    [
      "move element",
      { foo: ["all", "grass", "cows", "eat"] },
      [{ op: "move", from: "/foo/1", path: "/foo/3" }],
      { foo: ["all", "cows", "eat", "grass"] },
    ],
    [
      "copy",
      { a: { b: 1 } },
      [{ op: "copy", from: "/a", path: "/c" }],
      { a: { b: 1 }, c: { b: 1 } },
    ],
    [
      "escaped keys",
      { "a/b": 1, "m~n": 2 },
      [
        { op: "replace", path: "/a~1b", value: 3 },
        { op: "remove", path: "/m~0n" },
      ],
      { "a/b": 3 },
    ],
    [
      "test passes",
      { a: [1, { b: 2 }] },
      [{ op: "test", path: "/a", value: [1, { b: 2 }] }],
      { a: [1, { b: 2 }] },
    ],
    ["replace root", { a: 1 }, [{ op: "replace", path: "", value: [1] }], [1]],
  ];

  it.each(cases)("%s", (_, doc, ops, expected) => {
    const frozen = structuredClone(doc);
    const result = applyPatch(doc, ops);
    expect(result.doc).toEqual(expected);
    expect(doc).toEqual(frozen);
    expect(applyPatch(result.doc, result.inverse).doc).toEqual(doc);
  });

  it.each<[string, unknown, JsonPatchOp]>([
    ["missing path", { a: 1 }, { op: "remove", path: "/b" }],
    ["index past end", { a: [1] }, { op: "add", path: "/a/3", value: 1 }],
    ["bad index", { a: [1] }, { op: "replace", path: "/a/01", value: 1 }],
    ["failed test", { a: 1 }, { op: "test", path: "/a", value: 2 }],
    ["move into itself", { a: { b: {} } }, { op: "move", from: "/a", path: "/a/b/c" }],
  ])("rejects %s", (_, doc, op) => {
    expect(() => applyPatch(doc, [op])).toThrow(PatchError);
  });

  it("is all-or-nothing", () => {
    const doc = { a: 1 };
    expect(() =>
      applyPatch(doc, [
        { op: "replace", path: "/a", value: 2 },
        { op: "remove", path: "/nope" },
      ]),
    ).toThrow();
    expect(doc).toEqual({ a: 1 });
  });

  it("shares untouched branches", () => {
    const doc = { left: { deep: [1] }, right: { x: 1 } };
    const { doc: next } = applyPatch(doc, [{ op: "replace", path: "/right/x", value: 2 }]);
    expect(next.left).toBe(doc.left);
    expect(next.right).not.toBe(doc.right);
  });
});

function doc(): PageDocument {
  return {
    schemaVersion: 1,
    page: { id: "pg", siteId: "st", kind: "page", locale: "en", slug: "/" },
    root: {
      id: "root",
      type: "core/section@1",
      props: {},
      slots: {
        children: [
          { id: "a", type: "core/heading@1", props: { text: "A" } },
          { id: "b", type: "core/heading@1", props: { text: "B" } },
          {
            id: "c",
            type: "core/section@1",
            props: {},
            slots: { children: [{ id: "c1", type: "core/heading@1", props: {} }] },
          },
        ],
      },
    },
  };
}

const childIds = (d: PageDocument, id = "root") =>
  findNode(d, id)?.node.slots?.children?.map((n) => n.id);

describe("tree ops", () => {
  it("inserts into an existing and a missing slot", () => {
    const d = doc();
    let next = applyPatch(
      d,
      insertNodeOps(
        d,
        { parentId: "root", slot: "children", index: 1 },
        { id: "x", type: "core/heading@1", props: {} },
      ),
    ).doc;
    expect(childIds(next)).toEqual(["a", "x", "b", "c"]);
    next = applyPatch(
      next,
      insertNodeOps(
        next,
        { parentId: "a", slot: "footer", index: 9 },
        { id: "y", type: "core/heading@1", props: {} },
      ),
    ).doc;
    expect(findNode(next, "y")).toMatchObject({ parentId: "a", slot: "footer", index: 0 });
  });

  it.each([
    [0, ["c", "a", "b"]],
    [1, ["a", "c", "b"]],
    [2, []],
    [3, []],
  ])("moves c to index %i of the same slot", (index, expected) => {
    const d = doc();
    const ops = moveNodeOps(d, "c", { parentId: "root", slot: "children", index });
    if (expected.length === 0) {
      expect(ops).toEqual([]);
    } else {
      expect(childIds(applyPatch(d, ops).doc)).toEqual(expected);
    }
  });

  it("moves forward within a slot using the pre-removal index", () => {
    const d = doc();
    expect(
      childIds(
        applyPatch(d, moveNodeOps(d, "a", { parentId: "root", slot: "children", index: 2 })).doc,
      ),
    ).toEqual(["b", "a", "c"]);
  });

  it("moves between slots and refuses cycles", () => {
    const d = doc();
    const next = applyPatch(
      d,
      moveNodeOps(d, "a", { parentId: "c", slot: "children", index: 1 }),
    ).doc;
    expect(childIds(next, "c")).toEqual(["c1", "a"]);
    expect(() => moveNodeOps(d, "c", { parentId: "c1", slot: "x", index: 0 })).toThrow(
      /into itself/,
    );
    expect(() => moveNodeOps(d, "root", { parentId: "c", slot: "children", index: 0 })).toThrow(
      /root/,
    );
  });

  it("removes, sets props and duplicates with fresh ids", () => {
    const d = doc();
    expect(childIds(applyPatch(d, removeNodeOps(d, "b")).doc)).toEqual(["a", "c"]);
    expect(
      findNode(applyPatch(d, setPropsOps(d, "a", { text: "Z" })).doc, "a")?.node.props,
    ).toEqual({ text: "Z" });
    let n = 0;
    const { ops, newNodeId } = duplicateNodeOps(d, "c", () => `copy${n++}`);
    const next = applyPatch(d, ops).doc;
    expect(childIds(next)).toEqual(["a", "b", "c", newNodeId]);
    expect(childIds(next, newNodeId)).toEqual(["copy1"]);
  });
});

describe("createMessenger", () => {
  function pair() {
    const listeners = {
      editor: [] as Array<(e: MessageEvent) => void>,
      host: [] as Array<(e: MessageEvent) => void>,
    };
    const fakeWindow = (name: "editor" | "host", origin: string, other: () => Window) =>
      ({
        addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners[name].push(fn),
        removeEventListener: () => {},
        postMessage: (data: unknown) => {
          const source = other();
          queueMicrotask(() => {
            for (const fn of listeners[name]) fn({ data, origin, source } as MessageEvent);
          });
        },
      }) as unknown as Window;
    // A message posted TO the host window arrives with the editor's origin, and vice versa.
    const editorWin: Window = fakeWindow("editor", "https://host.test", () => hostWin);
    const hostWin: Window = fakeWindow("host", "https://editor.test", () => editorWin);
    return { editorWin, hostWin, listeners };
  }

  it("delivers messages, replies to requests and drops other origins", async () => {
    const { editorWin, hostWin, listeners } = pair();
    const editor = createMessenger<Record<string, unknown>, Record<string, unknown>>({
      target: () => hostWin,
      origin: "https://host.test",
      self: editorWin,
    });
    const host = createMessenger<Record<string, unknown>, Record<string, unknown>>({
      target: () => editorWin,
      origin: "https://editor.test",
      self: hostWin,
    });

    const onSelect = vi.fn();
    host.on("select", onSelect);
    host.on("resolveOptions", (_payload, envelope) =>
      host.send("options", { items: [{ value: "epl", label: "EPL" }] }, envelope.id),
    );

    editor.send("select", { nodeId: "a" });
    await expect(editor.request("resolveOptions", { query: "" })).resolves.toEqual({
      items: [{ value: "epl", label: "EPL" }],
    });
    expect(onSelect).toHaveBeenCalledWith(
      { nodeId: "a" },
      expect.objectContaining({ type: "select" }),
    );

    for (const fn of listeners.host) {
      fn({
        data: { protocol: "builder", v: 1, type: "select", payload: { nodeId: "evil" } },
        origin: "https://evil.test",
        source: editorWin,
      } as MessageEvent);
    }
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("requires an exact origin", () => {
    expect(() => createMessenger({ target: () => null, origin: "*" })).toThrow(/exact origin/);
  });
});

describe("manifestHash", () => {
  it("ignores order and key order", async () => {
    const a = {
      id: "a/x",
      version: "1.0.0",
      major: 1,
      label: "X",
      propsSchema: { type: "object" },
      slots: {},
      constraints: {},
      hasLoader: false,
      migratesFrom: [],
    };
    const b = { ...a, id: "a/y" };
    expect(await manifestHash([a, b])).toBe(await manifestHash([b, { ...a }]));
    expect(await manifestHash([a])).not.toBe(await manifestHash([b]));
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});
