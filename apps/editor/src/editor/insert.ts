import {
  type ComponentManifest,
  createNodeId,
  indexNodes,
  insertNodeOps,
  type PageNode,
} from "@builder/core";
import { rejectReason } from "../lib/drop-target";
import { defaultProps } from "../lib/schema";
import { useEditor } from "../store/editor";

export function newComponentNode(manifest: ComponentManifest): PageNode {
  return {
    id: createNodeId(),
    type: `${manifest.id}@${manifest.major}`,
    props: defaultProps(manifest.propsSchema, manifest.label),
    ...(Object.keys(manifest.slots).length > 0 ? { slots: {} } : {}),
  };
}

/**
 * Click-to-insert (and the keyboard path): right after the selected node when its
 * slot accepts the component, else into the selection's own slots, else at the
 * end of the root.
 */
export function insertComponent(componentId: string): string | null {
  const { document, manifests, selectedId, apply } = useEditor.getState();
  const manifest = manifests.get(componentId);
  if (!document || !manifest) return null;
  const nodes = indexNodes(document);
  const spec = { componentId };
  const candidates: Array<{ parentId: string; slot: string; index: number }> = [];

  const selected = selectedId ? nodes.get(selectedId) : undefined;
  if (selected?.parentId && selected.slot) {
    candidates.push({
      parentId: selected.parentId,
      slot: selected.slot,
      index: selected.index + 1,
    });
  }
  const ownSlots = (nodeId: string) => {
    const location = nodes.get(nodeId);
    const type = location?.node.type.split("@")[0] ?? "";
    for (const slot of Object.keys(manifests.get(type)?.slots ?? {})) {
      candidates.push({ parentId: nodeId, slot, index: location?.node.slots?.[slot]?.length ?? 0 });
    }
  };
  if (selected) ownSlots(selected.node.id);
  ownSlots(document.root.id);

  const target = candidates.find((c) => rejectReason(document, manifests, spec, c) === null);
  if (!target) return null;
  const node = newComponentNode(manifest);
  apply(insertNodeOps(document, target, node), { select: node.id });
  return node.id;
}
