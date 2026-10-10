import { findNode, parseNodeType, setPropsOps } from "@builder/core";
import { AlertTriangle, Copy, Trash2 } from "lucide-react";
import type { JsonSchema } from "../lib/schema";
import { useEditor } from "../store/editor";
import { Button } from "../ui";
import { duplicateNode, removeNode } from "./actions";
import { ObjectFields } from "./fields";

export function PropsPanel() {
  const document = useEditor((s) => s.document);
  const selectedId = useEditor((s) => s.selectedId);
  const manifests = useEditor((s) => s.manifests);
  const error = useEditor((s) => (s.selectedId ? s.nodeErrors[s.selectedId] : undefined));

  const location = document && selectedId ? findNode(document, selectedId) : null;
  if (!document || !location) {
    return (
      <p className="p-4 text-xs text-muted">
        Select a component on the canvas or in Layers to edit it.
      </p>
    );
  }
  const node = location.node;
  const parsed = parseNodeType(node.type);
  const manifest = parsed ? manifests.get(parsed.componentId) : undefined;

  const update = (props: Record<string, unknown>, field: string) => {
    const current = useEditor.getState().document;
    if (!current) return;
    useEditor
      .getState()
      .apply(setPropsOps(current, node.id, props), { coalesceKey: `props:${node.id}:${field}` });
  };

  return (
    <div data-testid="props-panel">
      <div className="flex items-start gap-2 border-b border-line p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {manifest?.label ?? parsed?.componentId ?? node.type}
          </div>
          <div className="truncate text-[11px] text-muted">
            {node.type}
            {manifest && parsed && manifest.major !== parsed.major
              ? ` → upgrades to @${manifest.major} on save`
              : ""}
          </div>
        </div>
        {location.parentId !== null && (
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Duplicate"
              title="Duplicate (Ctrl+D)"
              onClick={() => duplicateNode(node.id)}
            >
              <Copy size={14} />
            </Button>
            <Button
              size="icon"
              variant="danger"
              aria-label="Delete"
              title="Delete"
              onClick={() => removeNode(node.id)}
            >
              <Trash2 size={14} />
            </Button>
          </>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="flex gap-2 border-b border-red-100 bg-red-50 p-3 text-xs text-red-900"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}
      {!manifest ? (
        <p className="p-4 text-xs text-muted">
          The host app has no component <code>{parsed?.componentId ?? node.type}</code>. It renders
          nothing on the live site.
        </p>
      ) : (
        <div className="p-3">
          <ObjectFields
            key={node.id}
            schema={manifest.propsSchema as JsonSchema}
            value={node.props}
            onChange={update}
            context={{ nodeId: node.id, componentId: manifest.id }}
          />
        </div>
      )}
    </div>
  );
}
