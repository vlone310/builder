import {
  applyPatch,
  type ComponentManifest,
  CURRENT_SCHEMA_VERSION,
  createNodeId,
  type EditorToHost,
  indexNodes,
  type JsonPatchOp,
  type NodeBox,
  type PageDocument,
  type SlotBox,
} from "@builder/core";
import { create } from "zustand";
import { type Api, ApiError, type Environment, type PageSummary } from "../lib/api";
import type { DragSpec, DropTarget } from "../lib/drop-target";
import { defaultProps } from "../lib/schema";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict" | "locked";
export type Viewport = "desktop" | "tablet" | "mobile";

export const VIEWPORT_WIDTHS: Record<Viewport, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 375,
};

interface HistoryEntry {
  ops: JsonPatchOp[];
  inverse: JsonPatchOp[];
  coalesceKey?: string;
  at: number;
}

export interface HostLayout {
  boxes: NodeBox[];
  slots: SlotBox[];
  viewport: { width: number; height: number };
}

export interface DragState {
  spec: DragSpec;
  label: string;
  pointer: { x: number; y: number } | null;
  target: DropTarget | null;
}

type Send = <T extends keyof EditorToHost & string>(type: T, payload: EditorToHost[T]) => void;

export interface Metrics {
  /** Time from sending a patch to the host confirming it rendered, per rev. */
  patchToRendered: number[];
  /** Time to compute a drop target for one pointer move. */
  dropTargetCompute: number[];
  /** Frame intervals while dragging. */
  dragFrames: number[];
  /** Completed drops, and how many of them left the page unchanged. */
  drops: number;
  noopDrops: number;
}

export interface EditorState {
  api: Api | null;
  page: PageSummary | null;
  environment: Environment | null;
  document: PageDocument | null;
  rev: number;
  baseRevisionId: string | null;
  save: { status: SaveStatus; message?: string };
  publishedAt: string | null;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  selectedId: string | null;
  hoveredId: string | null;
  manifests: Map<string, ComponentManifest>;
  host: {
    status: "connecting" | "ready" | "error";
    sdkVersion?: string;
    manifestHash?: string;
    message?: string;
  };
  layout: HostLayout | null;
  nodeErrors: Record<string, { code: string; message: string }>;
  drag: DragState | null;
  viewport: Viewport;
  send: Send | null;
  metrics: Metrics;

  open(input: {
    api: Api;
    page: PageSummary;
    environment: Environment;
    /** Null for a page without revisions; created once the host lists its components. */
    document: PageDocument | null;
    baseRevisionId: string | null;
  }): void;
  /** Sets the components the host reported and gives a new page its root. */
  hostReady(info: {
    sdkVersion: string;
    manifestHash: string;
    components: ComponentManifest[];
  }): void;
  close(): void;
  apply(ops: JsonPatchOp[], options?: { select?: string | null; coalesceKey?: string }): void;
  undo(): void;
  redo(): void;
  select(nodeId: string | null): void;
  hover(nodeId: string | null): void;
  setSend(send: Send | null): void;
  resync(): void;
  flushSave(): Promise<boolean>;
  publish(): Promise<void>;
}

const COALESCE_MS = 1500;
const SAVE_DEBOUNCE_MS = 800;
const sentAt = new Map<number, number>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<boolean> | null = null;

const emptyMetrics = (): Metrics => ({
  patchToRendered: [],
  dropTargetCompute: [],
  dragFrames: [],
  drops: 0,
  noopDrops: 0,
});

export const useEditor = create<EditorState>((set, get) => {
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flushSave(), SAVE_DEBOUNCE_MS);
  }

  /** Applies ops locally and on the host, without touching history. */
  function commit(ops: JsonPatchOp[]): JsonPatchOp[] | null {
    const { document, rev, send } = get();
    if (!document || ops.length === 0) return null;
    let result: ReturnType<typeof applyPatch<PageDocument>>;
    try {
      result = applyPatch(document, ops);
    } catch (error) {
      console.error("Patch failed", error);
      return null;
    }
    const nextRev = rev + 1;
    sentAt.set(nextRev, performance.now());
    send?.("patch", { ops, baseRev: rev, rev: nextRev });
    const nodes = indexNodes(result.doc);
    const { selectedId, hoveredId } = get();
    set({
      document: result.doc,
      rev: nextRev,
      save: { status: "dirty" },
      selectedId: selectedId && nodes.has(selectedId) ? selectedId : null,
      hoveredId: hoveredId && nodes.has(hoveredId) ? hoveredId : null,
    });
    scheduleSave();
    return result.inverse;
  }

  return {
    api: null,
    page: null,
    environment: null,
    document: null,
    rev: 0,
    baseRevisionId: null,
    save: { status: "saved" },
    publishedAt: null,
    undoStack: [],
    redoStack: [],
    selectedId: null,
    hoveredId: null,
    manifests: new Map(),
    host: { status: "connecting" },
    layout: null,
    nodeErrors: {},
    drag: null,
    viewport: "desktop",
    send: null,
    metrics: emptyMetrics(),

    open({ api, page, environment, document, baseRevisionId }) {
      clearTimeout(saveTimer);
      sentAt.clear();
      set({
        api,
        page,
        environment,
        document,
        baseRevisionId,
        rev: 0,
        save: { status: baseRevisionId ? "saved" : "dirty" },
        publishedAt: null,
        undoStack: [],
        redoStack: [],
        selectedId: null,
        hoveredId: null,
        manifests: new Map(),
        host: { status: "connecting" },
        layout: null,
        nodeErrors: {},
        drag: null,
        metrics: emptyMetrics(),
      });
      if (document && !baseRevisionId) scheduleSave();
    },

    hostReady({ sdkVersion, manifestHash, components }) {
      const manifests = new Map(components.map((manifest) => [manifest.id, manifest]));
      set({ manifests, host: { status: "ready", sdkVersion, manifestHash } });
      const { document, page } = get();
      if (document || !page) return;
      // A new page starts from the first container the host offers as a root.
      const root = components.find(
        (manifest) =>
          Object.keys(manifest.slots).length > 0 &&
          (manifest.constraints.placement ?? "any") !== "section",
      );
      if (!root) {
        set({
          host: {
            status: "error",
            message: "The host has no container component to start a page with",
          },
        });
        return;
      }
      set({
        document: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          page: {
            id: page.id,
            siteId: page.siteId,
            kind: page.kind,
            locale: page.locale,
            ...(page.slug !== null ? { slug: page.slug } : {}),
            ...(page.name !== null ? { name: page.name } : {}),
          },
          root: {
            id: createNodeId(),
            type: `${root.id}@${root.major}`,
            props: defaultProps(root.propsSchema),
            slots: {},
          },
        },
        save: { status: "dirty" },
      });
      scheduleSave();
    },

    close() {
      clearTimeout(saveTimer);
      set({ api: null, page: null, document: null, send: null });
    },

    apply(ops, options = {}) {
      const inverse = commit(ops);
      if (!inverse) return;
      const now = Date.now();
      const undoStack = [...get().undoStack];
      const last = undoStack[undoStack.length - 1];
      if (
        options.coalesceKey &&
        last?.coalesceKey === options.coalesceKey &&
        now - last.at < COALESCE_MS
      ) {
        // Typing in one field becomes one undo step.
        undoStack[undoStack.length - 1] = {
          ops: [...last.ops, ...ops],
          inverse: [...inverse, ...last.inverse],
          coalesceKey: options.coalesceKey,
          at: now,
        };
      } else {
        undoStack.push({
          ops,
          inverse,
          ...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
          at: now,
        });
        if (undoStack.length > 200) undoStack.shift();
      }
      set({ undoStack, redoStack: [] });
      if (options.select !== undefined) get().select(options.select);
    },

    undo() {
      const undoStack = [...get().undoStack];
      const entry = undoStack.pop();
      if (!entry || !commit(entry.inverse)) return;
      set({ undoStack, redoStack: [...get().redoStack, entry] });
    },

    redo() {
      const redoStack = [...get().redoStack];
      const entry = redoStack.pop();
      if (!entry || !commit(entry.ops)) return;
      set({ redoStack, undoStack: [...get().undoStack, { ...entry, at: 0 }] });
    },

    select(nodeId) {
      set({ selectedId: nodeId });
      get().send?.("select", { nodeId });
    },

    hover(nodeId) {
      if (get().hoveredId !== nodeId) set({ hoveredId: nodeId });
    },

    setSend(send) {
      set({ send });
    },

    resync() {
      const { document, rev, send } = get();
      if (document) send?.("renderTree", { document, rev });
    },

    async flushSave() {
      clearTimeout(saveTimer);
      if (saving) {
        await saving;
        if (get().save.status !== "dirty") return get().save.status === "saved";
      }
      const { api, page, document, baseRevisionId, save } = get();
      if (!api || !page || !document) return false;
      if (save.status === "saved") return true;
      if (save.status === "conflict" || save.status === "locked") return false;

      const snapshot = document;
      set({ save: { status: "saving" } });
      saving = (async () => {
        try {
          const result = await api.saveDraft(page.id, baseRevisionId, {
            root: snapshot.root,
            ...(snapshot.page.seo ? { seo: snapshot.page.seo } : {}),
          });
          const changedSince = get().document !== snapshot;
          set({
            baseRevisionId: result.revisionId,
            save: { status: changedSince ? "dirty" : "saved" },
          });
          if (changedSince) scheduleSave();
          return !changedSince;
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            set({
              save: {
                status: "conflict",
                message: "This page was changed elsewhere. Reload to continue.",
              },
            });
          } else if (error instanceof ApiError && error.status === 423) {
            set({ save: { status: "locked", message: error.message } });
          } else {
            set({
              save: {
                status: "error",
                message: error instanceof Error ? error.message : String(error),
              },
            });
            saveTimer = setTimeout(() => {
              set({ save: { status: "dirty" } });
              void get().flushSave();
            }, 5000);
          }
          return false;
        } finally {
          saving = null;
        }
      })();
      return saving;
    },

    async publish() {
      const { api, page } = get();
      if (!api || !page) return;
      if (!(await get().flushSave()))
        throw new Error(get().save.message ?? "Save the page before publishing");
      const revisionId = get().baseRevisionId;
      if (!revisionId) throw new Error("Nothing to publish yet");
      const updated = await api.publish(page.id, revisionId);
      set({ page: { ...page, ...updated }, publishedAt: new Date().toISOString() });
    },
  };
});

/** Called when the host confirms a rendered revision. */
export function recordRendered(rev: number) {
  const started = sentAt.get(rev);
  if (started === undefined) return;
  sentAt.delete(rev);
  const metrics = useEditor.getState().metrics;
  metrics.patchToRendered.push(performance.now() - started);
  if (metrics.patchToRendered.length > 500) metrics.patchToRendered.shift();
}

declare global {
  interface Window {
    __builderMetrics?: () => Metrics;
  }
}
window.__builderMetrics = () => useEditor.getState().metrics;
