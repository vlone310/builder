import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";
import type { PreviewLink } from "../lib/api";
import { useEditor } from "../store/editor";
import { Button, Dialog, Input } from "../ui";

/** Saves the draft, then creates a share link that shows exactly that revision. */
export function SharePreview() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<PreviewLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setOpen(true);
    setBusy(true);
    setError(null);
    setLink(null);
    setCopied(false);
    try {
      const store = useEditor.getState();
      if (!(await store.flushSave())) throw new Error(store.save.message ?? "Save the page first");
      const { api, page, environment, baseRevisionId } = useEditor.getState();
      if (!api || !page || !baseRevisionId) throw new Error("Nothing saved to preview yet");
      setLink(
        await api.createPreviewLink(page.id, {
          revisionId: baseRevisionId,
          ...(environment ? { envId: environment.id } : {}),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    const api = useEditor.getState().api;
    if (!api || !link) return;
    await api.revokePreviewLink(link.id);
    setOpen(false);
  }

  return (
    <>
      <Button onClick={create} title="Share a link to this draft">
        <Link2 size={14} /> Share preview
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Preview link">
        {busy && <p className="text-xs text-muted">Saving and creating a link…</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
        {link && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Anyone with this link sees this draft as it is now, until{" "}
              {new Date(link.expiresAt).toLocaleString()}. Later edits need a new link.
            </p>
            {link.url ? (
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={link.url}
                  aria-label="Preview URL"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  aria-label="Copy link"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link.url ?? "");
                    setCopied(true);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </Button>
              </div>
            ) : (
              <p className="text-xs">Token: {link.token}</p>
            )}
            <div className="flex justify-between">
              <Button variant="danger" onClick={revoke}>
                Revoke link
              </Button>
              {link.url && (
                <a
                  className="text-xs font-medium text-accent underline"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open preview
                </a>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
