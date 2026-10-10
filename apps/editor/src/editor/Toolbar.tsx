import { ArrowLeft, Monitor, Redo2, Smartphone, Tablet, Undo2 } from "lucide-react";
import { useState } from "react";
import { useEditor, type Viewport } from "../store/editor";
import { Button, cx } from "../ui";
import { SharePreview } from "./SharePreview";

const VIEWPORTS: Array<{ id: Viewport; label: string; icon: typeof Monitor }> = [
  { id: "desktop", label: "Desktop", icon: Monitor },
  { id: "tablet", label: "Tablet (768 px)", icon: Tablet },
  { id: "mobile", label: "Mobile (375 px)", icon: Smartphone },
];

const SAVE_LABEL = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed, retrying",
  conflict: "Not saved",
  locked: "Not saved",
} as const;

export function Toolbar() {
  const page = useEditor((s) => s.page);
  const environment = useEditor((s) => s.environment);
  const save = useEditor((s) => s.save);
  const viewport = useEditor((s) => s.viewport);
  const canUndo = useEditor((s) => s.undoStack.length > 0);
  const canRedo = useEditor((s) => s.redoStack.length > 0);
  const publishedAt = useEditor((s) => s.publishedAt);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      await useEditor.getState().publish();
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-white px-3">
      <Button
        size="icon"
        variant="ghost"
        aria-label="Back to pages"
        onClick={() => (window.location.hash = `/sites/${page?.siteId}`)}
      >
        <ArrowLeft size={16} />
      </Button>
      <div className="min-w-0">
        <div className="truncate font-medium">{page?.kind === "page" ? page.slug : page?.name}</div>
        <div className="truncate text-[11px] text-muted">
          {page?.locale} · {environment?.name} ·{" "}
          {environment ? new URL(environment.hostUrl).host : ""}
        </div>
      </div>
      <fieldset className="mx-auto flex items-center gap-1 rounded-md border-0 bg-slate-100 p-0.5">
        <legend className="sr-only">Viewport</legend>
        {VIEWPORTS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={viewport === id}
            onClick={() => useEditor.setState({ viewport: id })}
            className={cx(
              "grid h-7 w-8 place-items-center rounded",
              viewport === id ? "bg-white shadow-sm" : "text-muted",
            )}
          >
            <Icon size={15} />
          </button>
        ))}
      </fieldset>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={() => useEditor.getState().undo()}
      >
        <Undo2 size={16} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={() => useEditor.getState().redo()}
      >
        <Redo2 size={16} />
      </Button>
      <span
        data-testid="save-status"
        data-status={save.status}
        className={cx(
          "w-28 text-right text-xs",
          save.status === "error" || save.status === "conflict" ? "text-danger" : "text-muted",
        )}
        title={save.message}
      >
        {SAVE_LABEL[save.status]}
      </span>
      <SharePreview />
      <Button
        variant="primary"
        onClick={publish}
        disabled={publishing || save.status === "conflict" || save.status === "locked"}
      >
        {publishing ? "Publishing…" : "Publish"}
      </Button>
      {publishError && <span className="text-xs text-danger">{publishError}</span>}
      {publishedAt && !publishError && !publishing && (
        <span className="text-xs text-green-700">Published</span>
      )}
    </header>
  );
}
