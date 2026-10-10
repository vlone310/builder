import {
  isSafeUrl,
  type RichText,
  type RichTextBlock,
  type RichTextInline,
  type RichTextText,
  type TextMark,
  textMarks,
} from "@builder/core";

/** ProseMirror/TipTap JSON, as much of it as the rich text field uses. */
export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

const MARKS = new Set<string>(textMarks);

export function toProseMirror(value: RichText | undefined): PmNode {
  const inline = (nodes: RichTextInline[]): PmNode[] =>
    nodes.flatMap((node): PmNode[] => {
      switch (node.type) {
        case "text":
          return node.text
            ? [
                {
                  type: "text",
                  text: node.text,
                  ...(node.marks?.length ? { marks: node.marks.map((type) => ({ type })) } : {}),
                },
              ]
            : [];
        case "break":
          return [{ type: "hardBreak" }];
        case "link":
          return node.content
            .filter((text) => text.text)
            .map((text) => ({
              type: "text",
              text: text.text,
              marks: [
                ...(text.marks ?? []).map((type) => ({ type })),
                { type: "link", attrs: { href: node.href, target: node.newTab ? "_blank" : null } },
              ],
            }));
        default:
          return [];
      }
    });
  const paragraph = (content: RichTextInline[]): PmNode => {
    const children = inline(content);
    return children.length ? { type: "paragraph", content: children } : { type: "paragraph" };
  };
  const blocks = (value?.content ?? []).map((block): PmNode => {
    switch (block.type) {
      case "paragraph":
        return paragraph(block.content);
      case "heading": {
        const children = inline(block.content);
        return {
          type: "heading",
          attrs: { level: block.level },
          ...(children.length ? { content: children } : {}),
        };
      }
      case "list":
        return {
          type: block.ordered ? "orderedList" : "bulletList",
          content: block.items.map((item) => ({
            type: "listItem",
            content: [paragraph(item.content)],
          })),
        };
      default:
        return paragraph([]);
    }
  });
  return { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] };
}

function fromInline(nodes: PmNode[] = []): RichTextInline[] {
  const out: RichTextInline[] = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      out.push({ type: "break" });
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const marks = (node.marks ?? []).map((m) => m.type).filter((m): m is TextMark => MARKS.has(m));
    const text: RichTextText = {
      type: "text",
      text: node.text,
      ...(marks.length ? { marks } : {}),
    };
    const link = node.marks?.find((m) => m.type === "link");
    const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
    if (!href || !isSafeUrl(href)) {
      out.push(text);
      continue;
    }
    const newTab = link?.attrs?.target === "_blank";
    // Consecutive text runs with the same link become one link node.
    const previous = out[out.length - 1];
    if (
      previous?.type === "link" &&
      previous.href === href &&
      Boolean(previous.newTab) === newTab
    ) {
      previous.content.push(text);
    } else {
      out.push({ type: "link", href, ...(newTab ? { newTab } : {}), content: [text] });
    }
  }
  return out;
}

export function fromProseMirror(doc: PmNode): RichText {
  const blocks: RichTextBlock[] = [];
  for (const node of doc.content ?? []) {
    switch (node.type) {
      case "paragraph":
        blocks.push({ type: "paragraph", content: fromInline(node.content) });
        break;
      case "heading":
        blocks.push({
          type: "heading",
          level: Math.min(6, Math.max(1, Number(node.attrs?.level ?? 2))),
          content: fromInline(node.content),
        });
        break;
      case "bulletList":
      case "orderedList":
        blocks.push({
          type: "list",
          ...(node.type === "orderedList" ? { ordered: true } : {}),
          items: (node.content ?? []).map((item) => ({
            content: (item.content ?? []).flatMap((child) => fromInline(child.content)),
          })),
        });
        break;
    }
  }
  return { type: "doc", content: blocks };
}
