import { type PageNode, parseNodeType } from "@builder/core";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { useEditor } from "../store/editor";
import { cx } from "../ui";
import { duplicateNode, removeNode, shiftNode } from "./actions";

export function Layers() {
  const document = useEditor((s) => s.document);
  if (!document) return null;
  return (
    <ul className="py-2" aria-label="Page layers">
      <LayerRow node={document.root} depth={0} isRoot />
    </ul>
  );
}

function LayerRow({
  node,
  depth,
  isRoot = false,
}: {
  node: PageNode;
  depth: number;
  isRoot?: boolean;
}) {
  const manifests = useEditor((s) => s.manifests);
  const selected = useEditor((s) => s.selectedId === node.id);
  const hovered = useEditor((s) => s.hoveredId === node.id);
  const error = useEditor((s) => s.nodeErrors[node.id]);
  const componentId = parseNodeType(node.type)?.componentId ?? node.type;
  const manifest = manifests.get(componentId);
  const slotNames = Object.keys(manifest?.slots ?? node.slots ?? {});
  const store = useEditor.getState;

  return (
    <li>
      <div
        className={cx(
          "group flex h-7 items-center gap-1 pr-1 text-xs",
          selected ? "bg-accent-soft" : hovered ? "bg-slate-50" : "",
        )}
        data-testid={`layer-${node.id}`}
      >
        <button
          type="button"
          aria-pressed={selected}
          className="flex h-full min-w-0 flex-1 items-center gap-1 text-left"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => store().select(node.id)}
          onMouseEnter={() => store().hover(node.id)}
          onMouseLeave={() => store().hover(null)}
          onFocus={() => store().hover(node.id)}
          onBlur={() => store().hover(null)}
        >
          <span className={cx("truncate", !manifest && "text-warn")}>
            {manifest?.label ?? componentId}
          </span>
          {error && (
            <AlertTriangle size={12} className="shrink-0 text-danger" aria-label={error.message} />
          )}
        </button>
        {!isRoot && (
          <span className="hidden gap-0.5 group-focus-within:flex group-hover:flex">
            <IconButton label="Move up" onClick={() => shiftNode(node.id, -1)} icon={ArrowUp} />
            <IconButton label="Move down" onClick={() => shiftNode(node.id, 1)} icon={ArrowDown} />
            <IconButton label="Duplicate" onClick={() => duplicateNode(node.id)} icon={Copy} />
            <IconButton label="Delete" onClick={() => removeNode(node.id)} icon={Trash2} />
          </span>
        )}
      </div>
      {slotNames.length > 0 && (
        <ul>
          {slotNames.map((slot) => {
            const children = node.slots?.[slot] ?? [];
            return (
              <li key={slot}>
                {slotNames.length > 1 && (
                  <div
                    className="h-6 text-[10px] uppercase tracking-wide text-muted"
                    style={{ paddingLeft: 8 + (depth + 1) * 14, lineHeight: "24px" }}
                  >
                    {slot}
                  </div>
                )}
                <ul>
                  {children.map((child) => (
                    <LayerRow key={child.id} node={child} depth={depth + 1} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function IconButton({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: typeof Copy;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-white hover:text-ink"
    >
      <Icon size={12} />
    </button>
  );
}
