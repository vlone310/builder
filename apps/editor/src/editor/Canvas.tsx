import {
  createMessenger,
  type EditorToHost,
  type HostToEditor,
  type OptionItem,
  PROTOCOL_VERSION,
} from "@builder/core";
import { useEffect, useRef, useState } from "react";
import { recordRendered, useEditor, VIEWPORT_WIDTHS } from "../store/editor";
import { canvasFrame } from "./drag";
import { Overlay } from "./Overlay";

const TOKEN_REFRESH_MS = 5 * 60 * 1000;

/** Asks the host for dynamic field options; set while a host is connected. */
export const hostOptions: {
  current: ((payload: EditorToHost["resolveOptions"]) => Promise<OptionItem[]>) | null;
} = { current: null };

/**
 * The host app in an iframe, plus the overlay the editor draws on top. All
 * traffic goes through one messenger pinned to the host's exact origin.
 */
export function Canvas() {
  const environment = useEditor((s) => s.environment);
  const page = useEditor((s) => s.page);
  const api = useEditor((s) => s.api);
  const viewport = useEditor((s) => s.viewport);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit tokens live 10 minutes; fetch one for the URL and keep the host supplied.
  useEffect(() => {
    if (!api || !page || !environment) return;
    let cancelled = false;
    const fetchToken = () => api.editToken(page.siteId, environment.id);
    fetchToken()
      .then(({ token }) => {
        if (cancelled) return;
        tokenRef.current = token;
        const url = new URL(page.slug ?? "/", environment.hostUrl);
        url.searchParams.set("builder.edit", token);
        setSrc(url.toString());
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const refresh = setInterval(async () => {
      try {
        const { token } = await fetchToken();
        tokenRef.current = token;
        useEditor
          .getState()
          .send?.("init", { editToken: token, siteId: page.siteId, env: environment.name });
      } catch {
        // The next refresh tries again; the current token is still valid for a while.
      }
    }, TOKEN_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
  }, [api, page, environment]);

  useEffect(() => {
    if (!environment || !page) return;
    const origin = new URL(environment.hostUrl).origin;
    const messenger = createMessenger<EditorToHost, HostToEditor>({
      target: () => iframeRef.current?.contentWindow ?? null,
      origin,
    });
    const store = useEditor.getState;
    store().setSend((type, payload) => messenger.send(type, payload));
    hostOptions.current = async (payload) =>
      (await messenger.request<"resolveOptions", "options">("resolveOptions", payload)).items;

    const offs = [
      messenger.on("ready", (info) => {
        if (info.protocolVersion !== PROTOCOL_VERSION) {
          useEditor.setState({
            host: {
              status: "error",
              message: `Host speaks protocol v${info.protocolVersion}; upgrade @builder/react`,
            },
          });
          return;
        }
        if (tokenRef.current) {
          messenger.send("init", {
            editToken: tokenRef.current,
            siteId: page.siteId,
            env: environment.name,
          });
        }
        store().hostReady(info);
        store().resync();
        const { selectedId } = store();
        if (selectedId) messenger.send("select", { nodeId: selectedId });
      }),
      messenger.on("rendered", ({ rev }) => {
        recordRendered(rev);
        useEditor.setState({ nodeErrors: {} });
      }),
      messenger.on("layout", (layout) => useEditor.setState({ layout })),
      messenger.on("nodeClick", ({ nodeId }) => store().select(nodeId)),
      messenger.on("nodeHover", ({ nodeId }) => store().hover(nodeId)),
      messenger.on("error", (error) => {
        if (error.code === "rev_mismatch" || error.code === "patch_failed") {
          store().resync();
          return;
        }
        if (error.nodeId) {
          const nodeId = error.nodeId;
          useEditor.setState((s) => ({
            nodeErrors: { ...s.nodeErrors, [nodeId]: { code: error.code, message: error.message } },
          }));
        }
      }),
    ];
    return () => {
      for (const off of offs) off();
      messenger.destroy();
      hostOptions.current = null;
      store().setSend(null);
    };
  }, [environment, page]);

  const width = VIEWPORT_WIDTHS[viewport];

  if (error) return <div className="grid h-full place-items-center p-4 text-danger">{error}</div>;
  return (
    <div className="flex h-full justify-center overflow-hidden p-3">
      <div
        className="relative h-full overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-line"
        style={{ width: width ?? "100%", maxWidth: "100%" }}
      >
        {src && (
          <iframe
            ref={(element) => {
              iframeRef.current = element;
              canvasFrame.current = element;
            }}
            title="Page canvas"
            src={src}
            className="block h-full w-full border-0"
            referrerPolicy="no-referrer"
          />
        )}
        <Overlay />
      </div>
    </div>
  );
}
