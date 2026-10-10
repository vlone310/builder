import type { NodeBox, PageDocument, Rect, SlotBox } from "@builder/core";
import { indexNodes } from "@builder/core";

/** Wrapper elements use display: contents, so their box is the union of their children's. */
export const WRAPPER_ATTR = "data-builder-wrapper";

function union(rects: Rect[]): Rect | null {
  const visible = rects.filter((r) => r.width > 0 || r.height > 0);
  if (visible.length === 0) return null;
  const left = Math.min(...visible.map((r) => r.x));
  const top = Math.min(...visible.map((r) => r.y));
  const right = Math.max(...visible.map((r) => r.x + r.width));
  const bottom = Math.max(...visible.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function boxOf(element: Element): Rect | null {
  if (element.hasAttribute(WRAPPER_ATTR)) {
    return union(
      Array.from(element.children)
        .map(boxOf)
        .filter((r): r is Rect => r !== null),
    );
  }
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function direction(children: Rect[]): SlotBox["direction"] {
  const [first, second] = children;
  if (!first || !second) return "vertical";
  // Side by side when the second child starts right of the first and they overlap vertically.
  const overlapY =
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return second.x >= first.x + first.width - 1 && overlapY > 0 ? "horizontal" : "vertical";
}

const round = (r: Rect): Rect => ({
  x: Math.round(r.x * 10) / 10,
  y: Math.round(r.y * 10) / 10,
  width: Math.round(r.width * 10) / 10,
  height: Math.round(r.height * 10) / 10,
});

/** Measures every rendered node and slot, in viewport coordinates. */
export function measureLayout(
  root: ParentNode,
  document: PageDocument,
): { boxes: NodeBox[]; slots: SlotBox[] } {
  const locations = indexNodes(document);
  const boxes: NodeBox[] = [];
  for (const element of Array.from(root.querySelectorAll("[data-node-id]"))) {
    const nodeId = element.getAttribute("data-node-id") as string;
    const location = locations.get(nodeId);
    const rect = boxOf(element);
    if (!location || !rect) continue;
    boxes.push({
      nodeId,
      rect: round(rect),
      parentId: location.parentId,
      slot: location.slot,
      index: location.index,
    });
  }

  const slots: SlotBox[] = [];
  for (const element of Array.from(root.querySelectorAll("[data-slot-owner]"))) {
    const nodeId = element.getAttribute("data-slot-owner") as string;
    const slot = element.getAttribute("data-slot") as string;
    const empty = element.hasAttribute("data-empty-slot");
    const childRects = empty
      ? []
      : Array.from(element.children)
          .map(boxOf)
          .filter((r): r is Rect => r !== null);
    const rect = empty ? boxOf(element) : union(childRects);
    if (!rect) continue;
    slots.push({ nodeId, slot, rect: round(rect), direction: direction(childRects), empty });
  }
  return { boxes, slots };
}
