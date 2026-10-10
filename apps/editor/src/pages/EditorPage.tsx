import { useCallback, useEffect, useState } from "react";
import { EditorShell } from "../editor/EditorShell";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/session";
import { useEditor } from "../store/editor";
import { Button, Dialog } from "../ui";
import { useAsync } from "./useAsync";

const LOCK_RENEW_MS = 60_000;

export function EditorPage({ pageId, envId }: { pageId: string; envId: string | null }) {
  const { api, session } = useApi();
  const [lockHolder, setLockHolder] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const readOnly = session.role === "viewer";

  const data = useAsync(async () => {
    const page = await api.page(pageId);
    const [environments, draft] = await Promise.all([
      api.environments(page.siteId),
      api.draft(pageId).catch((error) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    ]);
    const environment =
      environments.items.find((e) => e.id === envId) ??
      environments.items.find((e) => e.name === "dev") ??
      environments.items[0];
    if (!environment) throw new Error("This site has no environment to edit against");
    return { page, environment, draft };
  }, [api, pageId, envId]);

  const acquire = useCallback(
    async (force: boolean) => {
      try {
        await api.lock(pageId, force);
        setLockHolder(null);
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 423) {
          setLockHolder(
            (error.details as { holder?: string } | undefined)?.holder ?? "someone else",
          );
          return false;
        }
        throw error;
      }
    },
    [api, pageId],
  );

  const start = useCallback(() => {
    if (!data.data) return;
    const { page, environment, draft } = data.data;
    useEditor.getState().open({
      api,
      page,
      environment,
      document: draft?.document ?? null,
      baseRevisionId: draft?.revisionId ?? null,
    });
    setReady(true);
  }, [api, data.data]);

  // Open the page in the store once loaded and the lock is ours.
  useEffect(() => {
    if (!data.data || readOnly) return;
    let cancelled = false;
    void acquire(false).then((ok) => {
      if (ok && !cancelled) start();
    });
    return () => {
      cancelled = true;
    };
  }, [data.data, readOnly, acquire, start]);

  // Keep the lock while editing; release it and save on the way out.
  useEffect(() => {
    if (!ready) return;
    const renew = setInterval(() => {
      api.lock(pageId).catch((error) => {
        if (error instanceof ApiError && error.status === 423) {
          useEditor.setState({ save: { status: "locked", message: error.message } });
        }
      });
    }, LOCK_RENEW_MS);
    const release = () => {
      void useEditor
        .getState()
        .flushSave()
        .finally(() => api.unlock(pageId).catch(() => {}));
    };
    window.addEventListener("pagehide", release);
    return () => {
      clearInterval(renew);
      window.removeEventListener("pagehide", release);
      release();
      useEditor.getState().close();
    };
  }, [ready, api, pageId]);

  if (data.error) return <Centered>{data.error.message}</Centered>;
  if (readOnly)
    return <Centered>Viewers can't edit pages. Ask an admin for the editor role.</Centered>;
  if (!data.data) return <Centered>Loading page…</Centered>;

  return (
    <>
      {ready ? (
        <EditorShell />
      ) : (
        <Centered>{lockHolder ? "This page is locked." : "Opening page…"}</Centered>
      )}
      <Dialog open={lockHolder !== null} onOpenChange={() => {}} title="Someone else is editing">
        <p className="mb-4 text-xs text-muted">
          <strong>{lockHolder}</strong> has this page open. Taking over saves nothing of theirs that
          isn't saved yet.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => window.history.back()}>Go back</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (await acquire(true)) start();
            }}
          >
            Take over
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center p-4 text-muted">{children}</div>;
}
