import type { PageDocument, PageNode } from "./document";
import { applyPatch, type JsonPatchOp, toPointer } from "./patch";

/**
 * Tree edits expressed as JSON Patch against a PageDocument, so the editor can
 * send them to the host, keep them for undo, and save them.
 */

export interface NodeLocation {
  node: PageNode;
  /** JSON pointer tokens from the document root. */
  path: Array<string | number>;
  parentId: string | null;
  slot: string | null;
  index: number;
}

export function indexNodes(document: PageDocument): Map<string, NodeLocation> {
  const index = new Map<string, NodeLocation>();
  const visit = (
    node: PageNode,
    path: Array<string | number>,
    parentId: string | null,
    slot: string | null,
    position: number,
  ) => {
    index.set(node.id, { node, path, parentId, slot, index: position });
    for (const [name, children] of Object.entries(node.slots ?? {})) {
      children.forEach((child, i) => {
        visit(child, [...path, "slots", name, i], node.id, name, i);
      });
    }
  };
  visit(document.root, ["root"], null, null, 0);
  return index;
}

export function findNode(document: PageDocument, nodeId: string): NodeLocation | null {
  return indexNodes(document).get(nodeId) ?? null;
}

/** True when nodeId is ancestorId or sits anywhere below it. */
export function isWithin(document: PageDocument, ancestorId: string, nodeId: string): boolean {
  const nodes = indexNodes(document);
  let current: string | null = nodeId;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = nodes.get(current)?.parentId ?? null;
  }
  return false;
}

/** Short random id, unique enough within one page. */
export function createNodeId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `n_${Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12)}`;
}

function requireNode(nodes: Map<string, NodeLocation>, nodeId: string): NodeLocation {
  const location = nodes.get(nodeId);
  if (!location) throw new Error(`Node "${nodeId}" is not in the page`);
  return location;
}

/** Ops that create parent.slots and parent.slots[slot] when they are missing. */
function ensureSlotOps(parent: NodeLocation, slot: string): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  if (!parent.node.slots) {
    ops.push({ op: "add", path: toPointer([...parent.path, "slots"]), value: {} });
  }
  if (!parent.node.slots?.[slot]) {
    ops.push({ op: "add", path: toPointer([...parent.path, "slots", slot]), value: [] });
  }
  return ops;
}

export interface SlotTarget {
  parentId: string;
  slot: string;
  /** Position among the slot's current children (before any removal). */
  index: number;
}

export function insertNodeOps(
  document: PageDocument,
  target: SlotTarget,
  node: PageNode,
): JsonPatchOp[] {
  const nodes = indexNodes(document);
  const parent = requireNode(nodes, target.parentId);
  const length = parent.node.slots?.[target.slot]?.length ?? 0;
  const index = Math.max(0, Math.min(target.index, length));
  return [
    ...ensureSlotOps(parent, target.slot),
    { op: "add", path: toPointer([...parent.path, "slots", target.slot, index]), value: node },
  ];
}

export function moveNodeOps(
  document: PageDocument,
  nodeId: string,
  target: SlotTarget,
): JsonPatchOp[] {
  const nodes = indexNodes(document);
  const source = requireNode(nodes, nodeId);
  if (source.parentId === null) throw new Error("The page root cannot be moved");
  if (isWithin(document, nodeId, target.parentId)) {
    throw new Error("A node cannot be moved into itself");
  }
  const parent = requireNode(nodes, target.parentId);
  const length = parent.node.slots?.[target.slot]?.length ?? 0;
  let index = Math.max(0, Math.min(target.index, length));
  const sameSlot = source.parentId === target.parentId && source.slot === target.slot;
  if (sameSlot) {
    // The node leaves its old position first, so later positions shift down.
    if (source.index < index) index -= 1;
    if (index === source.index) return [];
  }
  const ensure = ensureSlotOps(parent, target.slot);
  // A move's path is resolved after its source is removed, which can shift the
  // target parent's own position, so look the parent up in that document.
  const prepared = applyPatch(document, ensure).doc;
  const removed = applyPatch(prepared, [{ op: "remove", path: toPointer(source.path) }]).doc;
  const parentAfter = requireNode(indexNodes(removed), target.parentId);
  return [
    ...ensure,
    {
      op: "move",
      from: toPointer(source.path),
      path: toPointer([...parentAfter.path, "slots", target.slot, index]),
    },
  ];
}

export function removeNodeOps(document: PageDocument, nodeId: string): JsonPatchOp[] {
  const location = requireNode(indexNodes(document), nodeId);
  if (location.parentId === null) throw new Error("The page root cannot be removed");
  return [{ op: "remove", path: toPointer(location.path) }];
}

export function setPropsOps(
  document: PageDocument,
  nodeId: string,
  props: Record<string, unknown>,
): JsonPatchOp[] {
  const location = requireNode(indexNodes(document), nodeId);
  return [{ op: "replace", path: toPointer([...location.path, "props"]), value: props }];
}

/** A copy of the node and its subtree with fresh ids, inserted right after it. */
export function duplicateNodeOps(
  document: PageDocument,
  nodeId: string,
  newId: () => string = createNodeId,
): { ops: JsonPatchOp[]; newNodeId: string } {
  const location = requireNode(indexNodes(document), nodeId);
  if (location.parentId === null || location.slot === null) {
    throw new Error("The page root cannot be duplicated");
  }
  const clone = (node: PageNode): PageNode => ({
    ...structuredClone(node),
    id: newId(),
    ...(node.slots
      ? {
          slots: Object.fromEntries(
            Object.entries(node.slots).map(([name, children]) => [name, children.map(clone)]),
          ),
        }
      : {}),
  });
  const copy = clone(location.node);
  return {
    ops: insertNodeOps(
      document,
      { parentId: location.parentId, slot: location.slot, index: location.index + 1 },
      copy,
    ),
    newNodeId: copy.id,
  };
}
