import {
  type ComponentManifest,
  indexNodes,
  type NodeBox,
  type PageDocument,
  parseNodeType,
  type Rect,
  type SlotBox,
} from "@builder/core";

export interface DragSpec {
  /** Component being placed. */
  componentId: string;
  /** Set when an existing node is moved rather than a new one inserted. */
  nodeId?: string;
}

export interface DropTarget {
  parentId: string;
  slot: string;
  index: number;
  /** Where to draw the indicator: a line between children, or the whole empty slot. */
  indicator: Rect;
  kind: "line" | "slot";
}

export interface Layout {
  boxes: NodeBox[];
  slots: SlotBox[];
}

const SLOT_MARGIN = 8;
const LINE = 4;
/** Within this distance of a container's edge, a drop goes next to it rather than into it. */
const EDGE = 12;

const contains = (rect: Rect, x: number, y: number, margin = 0) =>
  x >= rect.x - margin &&
  x <= rect.x + rect.width + margin &&
  y >= rect.y - margin &&
  y <= rect.y + rect.height + margin;

const area = (rect: Rect) => Math.max(rect.width, 1) * Math.max(rect.height, 1);

function distance(rect: Rect, x: number, y: number) {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function matches(componentId: string, pattern: string) {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) return componentId.startsWith(pattern.slice(0, -1));
  return componentId === pattern;
}

/**
 * Why a slot cannot take the dragged component, or null when it can. Mirrors the
 * checks validatePage runs, so a drop never creates an invalid page.
 */
export function rejectReason(
  document: PageDocument,
  manifests: ReadonlyMap<string, ComponentManifest>,
  drag: DragSpec,
  target: { parentId: string; slot: string },
): string | null {
  const nodes = indexNodes(document);
  const owner = nodes.get(target.parentId);
  if (!owner) return "unknown parent";
  if (drag.nodeId) {
    // The target must not be the moved node or anything inside it.
    let current: string | null = target.parentId;
    while (current) {
      if (current === drag.nodeId) return "cannot drop a component into itself";
      current = nodes.get(current)?.parentId ?? null;
    }
  }
  const ownerManifest = manifests.get(parseNodeType(owner.node.type)?.componentId ?? "");
  const slotConfig = ownerManifest?.slots[target.slot];
  if (!slotConfig) return "no such slot";
  if (slotConfig.allow && !slotConfig.allow.some((pattern) => matches(drag.componentId, pattern))) {
    return `${drag.componentId} is not allowed here`;
  }
  const children = owner.node.slots?.[target.slot] ?? [];
  const movingWithin =
    drag.nodeId !== undefined && children.some((child) => child.id === drag.nodeId);
  if (slotConfig.max !== undefined && children.length - (movingWithin ? 1 : 0) >= slotConfig.max) {
    return "slot is full";
  }
  const manifest = manifests.get(drag.componentId);
  if (manifest?.constraints.placement === "root") return "can only be the page root";
  const maxPerPage = manifest?.constraints.maxPerPage;
  if (maxPerPage !== undefined && !drag.nodeId) {
    let count = 0;
    for (const location of nodes.values()) {
      if (parseNodeType(location.node.type)?.componentId === drag.componentId) count++;
    }
    if (count >= maxPerPage) return `at most ${maxPerPage} per page`;
  }
  return null;
}

/**
 * Finds where a drop at (x, y) would land, in iframe viewport coordinates.
 * Prefers the innermost slot under the pointer that accepts the component; when
 * the pointer is over a container's padding rather than a slot, uses that
 * container's nearest accepting slot.
 */
export function computeDropTarget(
  point: { x: number; y: number },
  layout: Layout,
  drag: DragSpec,
  document: PageDocument,
  manifests: ReadonlyMap<string, ComponentManifest>,
): DropTarget | null {
  const accepts = (slot: SlotBox) =>
    rejectReason(document, manifests, drag, { parentId: slot.nodeId, slot: slot.slot }) === null;

  let chosen: SlotBox | undefined = layout.slots
    .filter((slot) => contains(slot.rect, point.x, point.y, SLOT_MARGIN) && accepts(slot))
    .sort((a, b) => area(a.rect) - area(b.rect))[0];

  // Containers under the pointer that are smaller than the chosen slot: the pointer
  // is in their padding, so drop into them, unless it hugs their edge, which means
  // "before or after this container".
  const owners = layout.boxes
    .filter(
      (box) =>
        contains(box.rect, point.x, point.y, -EDGE) &&
        box.nodeId !== chosen?.nodeId &&
        (!chosen || area(box.rect) < area(chosen.rect)) &&
        layout.slots.some((slot) => slot.nodeId === box.nodeId),
    )
    .sort((a, b) => area(a.rect) - area(b.rect));
  for (const owner of owners) {
    const nearest = layout.slots
      .filter((slot) => slot.nodeId === owner.nodeId && accepts(slot))
      .sort((a, b) => distance(a.rect, point.x, point.y) - distance(b.rect, point.x, point.y))[0];
    if (nearest) {
      chosen = nearest;
      break;
    }
  }
  if (!chosen) return null;

  const slot = chosen;
  if (slot.empty) {
    return { parentId: slot.nodeId, slot: slot.slot, index: 0, indicator: slot.rect, kind: "slot" };
  }

  const children = layout.boxes
    .filter((box) => box.parentId === slot.nodeId && box.slot === slot.slot)
    .sort((a, b) => a.index - b.index);
  const horizontal = slot.direction === "horizontal";
  const before = children.find((child) =>
    horizontal
      ? point.x < child.rect.x + child.rect.width / 2
      : point.y < child.rect.y + child.rect.height / 2,
  );
  const index = before ? before.index : (children[children.length - 1]?.index ?? -1) + 1;
  const anchor = before ?? children[children.length - 1];
  if (!anchor) {
    return { parentId: slot.nodeId, slot: slot.slot, index: 0, indicator: slot.rect, kind: "slot" };
  }
  const r = anchor.rect;
  const edge = before ? (horizontal ? r.x : r.y) : horizontal ? r.x + r.width : r.y + r.height;
  const indicator = horizontal
    ? { x: edge - LINE / 2, y: r.y, width: LINE, height: r.height }
    : { x: r.x, y: edge - LINE / 2, width: r.width, height: LINE };
  return { parentId: slot.nodeId, slot: slot.slot, index, indicator, kind: "line" };
}
