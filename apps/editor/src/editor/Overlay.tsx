import { findNode, parseNodeType, type Rect } from "@builder/core";
import { GripVertical } from "lucide-react";
import type { CSSProperties } from "react";
import { useEditor } from "../store/editor";
import { cx } from "../ui";
import { beginDrag } from "./drag";

const at = (rect: Rect): CSSProperties => ({
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height,
});

/**
 * Drawn by the editor over the iframe, from the host's layout boxes. It ignores
 * the pointer except during a drag (when it takes every event so the iframe
 * cannot) and on the selection handle.
 */
export function Overlay() {
  const layout = useEditor((s) => s.layout);
  const selectedId = useEditor((s) => s.selectedId);
  const hoveredId = useEditor((s) => s.hoveredId);
  const drag = useEditor((s) => s.drag);
  const nodeErrors = useEditor((s) => s.nodeErrors);
  const document = useEditor((s) => s.document);
  const manifests = useEditor((s) => s.manifests);
  const host = useEditor((s) => s.host);

  const box = (nodeId: string | null) =>
    nodeId ? layout?.boxes.find((b) => b.nodeId === nodeId) : undefined;
  const selected = box(selectedId);
  const hovered = hoveredId !== selectedId ? box(hoveredId) : undefined;
  const componentOf = (nodeId: string) => {
    const type = document ? findNode(document, nodeId)?.node.type : undefined;
    return type ? parseNodeType(type)?.componentId : undefined;
  };
  const label = (nodeId: string) => {
    const componentId = componentOf(nodeId);
    return (componentId && manifests.get(componentId)?.label) ?? componentId ?? nodeId;
  };

  return (
    <div
      data-testid="canvas-overlay"
      className={cx(
        "absolute inset-0 overflow-hidden",
        drag ? "pointer-events-auto cursor-grabbing" : "pointer-events-none",
      )}
    >
      {host.status === "connecting" && (
        <div className="absolute inset-x-0 top-0 bg-white/80 p-2 text-center text-xs text-muted">
          Connecting to the host app…
        </div>
      )}
      {!drag &&
        layout?.boxes
          .filter((b) => nodeErrors[b.nodeId])
          .map((b) => (
            <div
              key={b.nodeId}
              className="absolute border-2 border-dashed border-danger"
              style={at(b.rect)}
            />
          ))}
      {hovered && !drag && (
        <div className="absolute border border-accent" style={at(hovered.rect)} />
      )}
      {selected && !drag && (
        <div className="absolute border-2 border-accent" style={at(selected.rect)}>
          {selected.parentId !== null ? (
            <button
              type="button"
              data-testid="selection-handle"
              aria-label={`Drag ${label(selected.nodeId)}`}
              onPointerDown={(event) => {
                const componentId = componentOf(selected.nodeId);
                if (componentId)
                  beginDrag(
                    event,
                    { componentId, nodeId: selected.nodeId },
                    label(selected.nodeId),
                  );
              }}
              className="pointer-events-auto absolute -top-6 left-[-2px] flex h-6 cursor-grab items-center gap-1 rounded-t bg-accent px-1.5 text-[11px] font-medium text-white"
            >
              <GripVertical size={12} />
              {label(selected.nodeId)}
            </button>
          ) : (
            <span className="absolute -top-6 left-[-2px] h-6 rounded-t bg-accent px-1.5 text-[11px] leading-6 font-medium text-white">
              {label(selected.nodeId)}
            </span>
          )}
        </div>
      )}
      {drag?.target && (
        <div
          data-testid="drop-indicator"
          className={cx(
            "absolute rounded-sm",
            drag.target.kind === "line" ? "bg-accent" : "border-2 border-accent bg-accent/10",
          )}
          style={at(drag.target.indicator)}
        />
      )}
      {drag?.pointer && (
        <div
          className="absolute rounded bg-ink px-2 py-1 text-[11px] text-white shadow"
          style={{ left: drag.pointer.x + 12, top: drag.pointer.y + 12 }}
        >
          {drag.label}
          {!drag.target && <span className="ml-1 text-slate-400">— can't drop here</span>}
        </div>
      )}
    </div>
  );
}
