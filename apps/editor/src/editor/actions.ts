import { duplicateNodeOps, findNode, moveNodeOps, removeNodeOps } from "@builder/core";
import { useEditor } from "../store/editor";

/** Selection commands shared by the layers panel, props panel and shortcuts. */

export function removeNode(nodeId: string) {
  const { document, apply } = useEditor.getState();
  const location = document ? findNode(document, nodeId) : null;
  if (!document || !location || location.parentId === null) return;
  apply(removeNodeOps(document, nodeId), { select: location.parentId });
}

export function duplicateNode(nodeId: string) {
  const { document, apply } = useEditor.getState();
  const location = document ? findNode(document, nodeId) : null;
  if (!document || !location || location.parentId === null) return;
  const { ops, newNodeId } = duplicateNodeOps(document, nodeId);
  apply(ops, { select: newNodeId });
}

/** Moves a node one step within its slot. */
export function shiftNode(nodeId: string, delta: -1 | 1) {
  const { document, apply } = useEditor.getState();
  const location = document ? findNode(document, nodeId) : null;
  if (!document || !location?.parentId || !location.slot) return;
  const siblings = findNode(document, location.parentId)?.node.slots?.[location.slot] ?? [];
  const index = location.index + delta;
  if (index < 0 || index >= siblings.length) return;
  // Targets use pre-removal positions, so moving down skips over the next sibling.
  apply(
    moveNodeOps(document, nodeId, {
      parentId: location.parentId,
      slot: location.slot,
      index: delta > 0 ? index + 1 : index,
    }),
    {
      select: nodeId,
    },
  );
}
