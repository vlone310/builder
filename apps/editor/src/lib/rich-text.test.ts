import type { RichText } from "@builder/core";
import { describe, expect, it } from "vitest";
import { fromProseMirror, toProseMirror } from "./rich-text";

describe("rich text conversion", () => {
  it("round-trips paragraphs, headings, lists, marks, links and breaks", () => {
    const value: RichText = {
      type: "doc",
      content: [
        { type: "heading", level: 2, content: [{ type: "text", text: "Title", marks: ["bold"] }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            {
              type: "link",
              href: "https://a.com",
              newTab: true,
              content: [
                { type: "text", text: "the " },
                { type: "text", text: "terms", marks: ["italic"] },
              ],
            },
            { type: "break" },
            { type: "text", text: "end" },
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            { content: [{ type: "text", text: "one" }] },
            { content: [{ type: "text", text: "two" }] },
          ],
        },
      ],
    };
    expect(fromProseMirror(toProseMirror(value))).toEqual(value);
  });

  it("drops unsafe links and unknown nodes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
        { type: "blockquote", content: [] },
      ],
    };
    expect(fromProseMirror(doc)).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    });
  });

  it("gives the editor at least one paragraph", () => {
    expect(toProseMirror(undefined)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});
