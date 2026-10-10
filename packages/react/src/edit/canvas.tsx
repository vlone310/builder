import {
  type AnyComponentDefinition,
  applyPatch,
  createMessenger,
  type EditorToHost,
  type HostToEditor,
  type Messenger,
  manifestHash,
  type PageDocument,
  type PageNode,
  PROTOCOL_VERSION,
  prepareNode,
  type Registry,
  type RenderArgs,
  stableStringify,
} from "@builder/core";
import {
  Component,
  type CSSProperties,
  createContext,
  createElement,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { boxOf, measureLayout, WRAPPER_ATTR } from "./measure";

export const SDK_VERSION = "0.1.0";

export interface EditCanvasProps {
  registry: Registry;
  /** Exact origin of the builder editor; messages from anywhere else are ignored. */
  editorOrigin: string;
  /** The verified edit token from the URL; the editor sends fresh ones with init. */
  editToken: string;
  /** Route handler created with createEditHandlers. */
  endpoint: string;
  /** Debounce before loaders run for changed props. Default 120 ms. */
  loaderDebounceMs?: number;
}

type LoadEntry =
  | { status: "loading" }
  | { status: "ok"; data: unknown }
  | { status: "error"; code: string; message: string };

interface NodeError {
  nodeId: string;
  code: string;
  message: string;
}

interface CanvasContext {
  registry: Registry;
  loads: Map<string, LoadEntry>;
  reportError: (error: NodeError) => void;
}

const Context = createContext<CanvasContext | null>(null);

const contents: CSSProperties = { display: "contents" };
const wrapperProps = { [WRAPPER_ATTR]: "", style: contents };

export function loadKey(type: string, props: Record<string, unknown>): string {
  return `${type}|${stableStringify(props)}`;
}

/**
 * The host side of an edit session: renders the editor's document with the
 * tenant's own components, applies patches, and reports layout, clicks, hovers
 * and per-node errors to the editor. Loaders run on the host's server through
 * the edit endpoint and are cached by component type and props.
 */
export function EditCanvas({
  registry,
  editorOrigin,
  editToken,
  endpoint,
  loaderDebounceMs = 120,
}: EditCanvasProps) {
  const [state, setState] = useState<{ document: PageDocument | null; rev: number }>({
    document: null,
    rev: 0,
  });
  const [loads, setLoads] = useState<Map<string, LoadEntry>>(() => new Map());
  const tokenRef = useRef(editToken);
  const stateRef = useRef(state);
  stateRef.current = state;
  const selectedRef = useRef<string | null>(null);
  const messengerRef = useRef<Messenger<HostToEditor, EditorToHost> | null>(null);
  const pendingErrors = useRef<NodeError[]>([]);

  const post = useCallback(
    async (body: unknown) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenRef.current}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Edit endpoint returned ${response.status}`);
      return response.json();
    },
    [endpoint],
  );

  // Messaging: announce ourselves, then follow the editor's lead.
  useEffect(() => {
    const messenger = createMessenger<HostToEditor, EditorToHost>({
      target: () => window.parent,
      origin: editorOrigin,
    });
    messengerRef.current = messenger;
    const manifests = registry.manifests();
    const readyPayload = manifestHash(manifests).then((hash) => ({
      protocolVersion: PROTOCOL_VERSION,
      sdkVersion: SDK_VERSION,
      manifestHash: hash,
      components: manifests,
    }));
    void readyPayload.then((payload) => messenger.send("ready", payload));

    const offs = [
      messenger.on("init", (payload, envelope) => {
        tokenRef.current = payload.editToken;
        void readyPayload.then((ready) => messenger.send("ready", ready, envelope.id));
      }),
      messenger.on("renderTree", ({ document, rev }) => {
        setState({ document, rev });
      }),
      messenger.on("patch", ({ ops, baseRev, rev }) => {
        const current = stateRef.current;
        if (!current.document || current.rev !== baseRev) {
          messenger.send("error", {
            code: "rev_mismatch",
            message: `Host is at rev ${current.rev}, patch is based on ${baseRev}`,
          });
          return;
        }
        try {
          const next = { document: applyPatch(current.document, ops).doc, rev };
          stateRef.current = next;
          setState(next);
        } catch (error) {
          messenger.send("error", {
            code: "patch_failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
      messenger.on("scrollBy", ({ x, y }) => window.scrollBy(x, y)),
      messenger.on("select", ({ nodeId }) => {
        selectedRef.current = nodeId;
        if (nodeId) scrollIntoViewIfNeeded(nodeId);
      }),
      messenger.on("resolveOptions", async (payload, envelope) => {
        try {
          const result = await post({ action: "options", ...payload });
          messenger.send("options", { items: result.items ?? [] }, envelope.id);
        } catch {
          messenger.send("options", { items: [] }, envelope.id);
        }
      }),
    ];
    return () => {
      for (const off of offs) off();
      messenger.destroy();
      messengerRef.current = null;
    };
  }, [editorOrigin, registry, post]);

  // Loaders: queue nodes whose type and props have no cached result, then fetch
  // the queue in one request after a short pause in editing.
  const loadsRef = useRef(loads);
  loadsRef.current = loads;
  const queueRef = useRef(
    new Map<string, { key: string; type: string; props: Record<string, unknown> }>(),
  );
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flushLoads = useCallback(async () => {
    const batch = [...queueRef.current.values()];
    queueRef.current.clear();
    if (batch.length === 0) return;
    let results: Record<string, { ok: boolean; data?: unknown; code?: string; message?: string }> =
      {};
    try {
      results = (await post({ action: "load", nodes: batch })).results ?? {};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const { key } of batch) results[key] = { ok: false, code: "loader_failed", message };
    }
    setLoads((previous) => {
      const next = new Map(previous);
      for (const { key } of batch) {
        const result = results[key];
        next.set(
          key,
          result?.ok
            ? { status: "ok", data: result.data }
            : {
                status: "error",
                code: result?.code ?? "loader_failed",
                message: result?.message ?? "No result",
              },
        );
      }
      // Keep the cache bounded: drop the oldest entries.
      for (const key of next.keys()) {
        if (next.size <= 500) break;
        next.delete(key);
      }
      return next;
    });
  }, [post]);

  useEffect(() => {
    const document = state.document;
    if (!document) return;
    const added: string[] = [];
    const visit = (node: PageNode) => {
      const prepared = prepareNode(node, registry);
      if (prepared.ok && prepared.definition.loader) {
        const key = loadKey(node.type, node.props);
        if (!loadsRef.current.has(key) && !queueRef.current.has(key)) {
          queueRef.current.set(key, { key, type: node.type, props: node.props });
          added.push(key);
        }
      }
      for (const children of Object.values(node.slots ?? {})) children.forEach(visit);
    };
    visit(document.root);
    if (added.length === 0) return;
    setLoads((previous) => {
      const next = new Map(previous);
      for (const key of added) next.set(key, { status: "loading" });
      return next;
    });
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flushLoads(), loaderDebounceMs);
  }, [state.document, registry, flushLoads, loaderDebounceMs]);

  useEffect(() => () => clearTimeout(flushTimer.current), []);

  // After each commit: confirm the revision, then report the current node errors.
  // The editor clears its error list on "rendered", so fixed nodes drop out.
  useLayoutEffect(() => {
    const messenger = messengerRef.current;
    const errors = pendingErrors.current.splice(0);
    if (!messenger || !state.document) return;
    messenger.send("rendered", { rev: state.rev });
    const seen = new Set<string>();
    for (const error of errors) {
      if (seen.has(error.nodeId)) continue;
      seen.add(error.nodeId);
      messenger.send("error", error);
    }
  });

  useLayoutReporter(messengerRef, stateRef);
  usePointerReporting(messengerRef);

  const context = useMemo<CanvasContext>(
    () => ({ registry, loads, reportError: (error) => pendingErrors.current.push(error) }),
    [registry, loads],
  );

  if (!state.document) {
    return (
      <div style={{ padding: 24, font: "14px system-ui", color: "#6b7280" }}>
        Waiting for the editor…
      </div>
    );
  }
  return (
    <Context.Provider value={context}>
      <EditNode node={state.document.root} />
    </Context.Provider>
  );
}

function EditNode({ node }: { node: PageNode }): ReactNode {
  const context = useContext(Context) as CanvasContext;
  const prepared = prepareNode(node, context.registry);
  if (!prepared.ok) {
    context.reportError({ nodeId: node.id, code: prepared.code, message: prepared.message });
    return <Placeholder nodeId={node.id} type={node.type} message={prepared.message} />;
  }
  const definition: AnyComponentDefinition = prepared.definition;

  let data: unknown;
  if (definition.loader) {
    const entry = context.loads.get(loadKey(node.type, node.props));
    if (!entry || entry.status === "loading")
      return <Skeleton nodeId={node.id} label={definition.label} />;
    if (entry.status === "error") {
      context.reportError({ nodeId: node.id, code: entry.code, message: entry.message });
      return <Placeholder nodeId={node.id} type={node.type} message={entry.message} />;
    }
    data = entry.data;
  }

  const slots: Record<string, ReactNode> = {};
  for (const name of Object.keys(definition.slots ?? {})) {
    const children = node.slots?.[name] ?? [];
    slots[name] =
      children.length > 0 ? (
        <div data-slot-owner={node.id} data-slot={name} {...wrapperProps}>
          {children.map((child) => (
            <EditNode key={child.id} node={child} />
          ))}
        </div>
      ) : (
        <div data-slot-owner={node.id} data-slot={name} data-empty-slot="" style={emptySlotStyle}>
          Drop components here
        </div>
      );
  }

  return (
    <div data-node-id={node.id} {...wrapperProps}>
      <NodeBoundary nodeId={node.id} type={node.type} reportError={context.reportError}>
        {createElement(
          definition.render as (args: RenderArgs<unknown, unknown, string, ReactNode>) => ReactNode,
          { props: prepared.props, data, slots, nodeId: node.id },
        )}
      </NodeBoundary>
    </div>
  );
}

class NodeBoundary extends Component<
  { nodeId: string; type: string; reportError: (error: NodeError) => void; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.reportError({
      nodeId: this.props.nodeId,
      code: "render_failed",
      message: error.message,
    });
  }
  componentDidUpdate(previous: { children: ReactNode }) {
    // New props may fix the render; try again.
    if (this.state.error && previous.children !== this.props.children)
      this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <Placeholder nodeId={null} type={this.props.type} message={this.state.error.message} />
      );
    }
    return this.props.children;
  }
}

const emptySlotStyle: CSSProperties = {
  minHeight: 56,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px dashed #94a3b8",
  borderRadius: 6,
  color: "#64748b",
  font: "12px/1.4 system-ui, sans-serif",
  background: "rgba(148, 163, 184, 0.08)",
};

function Placeholder({
  nodeId,
  type,
  message,
}: {
  nodeId: string | null;
  type: string;
  message: string;
}) {
  return (
    <div
      {...(nodeId ? { "data-node-id": nodeId } : {})}
      data-builder-placeholder=""
      style={{
        padding: 12,
        border: "1px dashed #d97706",
        borderRadius: 6,
        color: "#92400e",
        background: "#fffbeb",
        font: "13px/1.4 system-ui, sans-serif",
      }}
    >
      <strong>{type}</strong>: {message}
    </div>
  );
}

function Skeleton({ nodeId, label }: { nodeId: string; label: string }) {
  return (
    <div
      data-node-id={nodeId}
      data-builder-loading=""
      style={{
        minHeight: 64,
        borderRadius: 6,
        background: "linear-gradient(90deg, #f1f5f9, #e2e8f0, #f1f5f9)",
        color: "#64748b",
        font: "12px system-ui, sans-serif",
        padding: 12,
      }}
    >
      Loading {label}…
    </div>
  );
}

function scrollIntoViewIfNeeded(nodeId: string) {
  const element = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
  const rect = element ? boxOf(element) : null;
  if (!rect) return;
  if (rect.y < 0 || rect.y + Math.min(rect.height, 80) > window.innerHeight) {
    window.scrollBy({ top: rect.y - 80, behavior: "smooth" });
  }
}

/** Sends layout boxes once per animation frame whenever anything may have moved. */
function useLayoutReporter(
  messengerRef: { current: Messenger<HostToEditor, EditorToHost> | null },
  stateRef: { current: { document: PageDocument | null } },
) {
  useEffect(() => {
    let frame = 0;
    let last = "";
    const report = () => {
      frame = 0;
      const document = stateRef.current.document;
      const messenger = messengerRef.current;
      if (!document || !messenger) return;
      const layout = {
        ...measureLayout(window.document, document),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
      const serialized = JSON.stringify(layout);
      if (serialized === last) return;
      last = serialized;
      messenger.send("layout", layout);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(window.document.documentElement);
    const mutations = new MutationObserver(schedule);
    mutations.observe(window.document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("load", schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("load", schedule, true);
    };
  }, [messengerRef, stateRef]);
}

/** Clicks select nodes instead of following links; the pointer drives hover outlines. */
function usePointerReporting(messengerRef: {
  current: Messenger<HostToEditor, EditorToHost> | null;
}) {
  useEffect(() => {
    let hovered: string | null = null;
    const nodeIdAt = (target: EventTarget | null) =>
      target instanceof Element
        ? (target.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null)
        : null;

    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      event.preventDefault();
      event.stopPropagation();
      if (anchor && (event.metaKey || event.ctrlKey)) {
        messengerRef.current?.send("navigate", { url: (anchor as HTMLAnchorElement).href });
        return;
      }
      const nodeId = nodeIdAt(event.target);
      if (nodeId) messengerRef.current?.send("nodeClick", { nodeId });
    };
    const onOver = (event: PointerEvent) => {
      const nodeId = nodeIdAt(event.target);
      if (nodeId === hovered) return;
      hovered = nodeId;
      messengerRef.current?.send("nodeHover", { nodeId });
    };
    const onLeave = () => {
      if (hovered === null) return;
      hovered = null;
      messengerRef.current?.send("nodeHover", { nodeId: null });
    };
    const onSubmit = (event: Event) => event.preventDefault();

    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerover", onOver, true);
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerover", onOver, true);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [messengerRef]);
}
