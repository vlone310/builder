import { Box } from "lucide-react";
import { useMemo, useState } from "react";
import { useEditor } from "../store/editor";
import { Input } from "../ui";
import { beginDrag } from "./drag";
import { insertComponent } from "./insert";

/** Components the host reported, grouped by category. Drag onto the canvas, or click to insert. */
export function Palette() {
  const manifests = useEditor((s) => s.manifests);
  const status = useEditor((s) => s.host.status);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCategory = new Map<
      string,
      Array<{ id: string; label: string; description?: string }>
    >();
    for (const manifest of manifests.values()) {
      if (manifest.constraints.placement === "root") continue;
      if (q && !`${manifest.label} ${manifest.id}`.toLowerCase().includes(q)) continue;
      const category = manifest.category ?? "Other";
      const list = byCategory.get(category) ?? [];
      list.push({
        id: manifest.id,
        label: manifest.label,
        ...(manifest.description ? { description: manifest.description } : {}),
      });
      byCategory.set(category, list);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [manifests, query]);

  if (status === "connecting")
    return <p className="p-3 text-xs text-muted">Waiting for the host's components…</p>;

  return (
    <div className="space-y-3 p-3">
      <Input
        placeholder="Search components"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search components"
      />
      {groups.map(([category, items]) => (
        <section key={category}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {category}
          </h3>
          <ul className="grid grid-cols-2 gap-1.5">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-testid={`palette-${item.id}`}
                  title={item.description ?? item.id}
                  onPointerDown={(event) =>
                    beginDrag(event, { componentId: item.id }, item.label, () =>
                      insertComponent(item.id),
                    )
                  }
                  className="flex h-16 w-full touch-none cursor-grab flex-col items-center justify-center gap-1 rounded-md border border-line bg-white px-1 text-center text-[11px] hover:border-accent"
                >
                  <Box size={16} className="text-muted" />
                  <span className="line-clamp-2">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {groups.length === 0 && <p className="text-xs text-muted">No components match.</p>}
    </div>
  );
}
