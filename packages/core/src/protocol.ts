import type { ComponentManifest } from "./component";
import type { PageDocument } from "./document";
import type { JsonPatchOp } from "./patch";

/**
 * Editor ↔ host runtime protocol, v1. The editor owns the document; the host
 * owns rendering. Every message is an Envelope sent with postMessage to an
 * exact origin, and both sides drop messages from any other origin.
 */

export const PROTOCOL = "builder";
export const PROTOCOL_VERSION = 1;

export interface Envelope<T extends string = string, P = unknown> {
  protocol: typeof PROTOCOL;
  v: typeof PROTOCOL_VERSION;
  id?: string;
  replyTo?: string;
  type: T;
  payload: P;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rendered node, in the iframe's viewport coordinates. */
export interface NodeBox {
  nodeId: string;
  rect: Rect;
  parentId: string | null;
  slot: string | null;
  index: number;
}

/** A slot's drop area: the union of its children, or the empty-slot placeholder. */
export interface SlotBox {
  nodeId: string;
  slot: string;
  rect: Rect;
  direction: "vertical" | "horizontal";
  empty: boolean;
}

export interface OptionItem {
  value: string;
  label: string;
}

export type EditorToHost = {
  init: { editToken: string; siteId: string; env: string };
  renderTree: { document: PageDocument; rev: number };
  patch: { ops: JsonPatchOp[]; baseRev: number; rev: number };
  select: { nodeId: string | null };
  hover: { nodeId: string | null };
  setViewport: { width: number };
  /** Scrolls the canvas page, e.g. while dragging near its edge. */
  scrollBy: { x: number; y: number };
  resolveOptions: { component: string; field: string; source: string; query: string };
};

export type HostToEditor = {
  ready: {
    protocolVersion: number;
    sdkVersion: string;
    manifestHash: string;
    components: ComponentManifest[];
  };
  rendered: { rev: number };
  layout: { boxes: NodeBox[]; slots: SlotBox[]; viewport: { width: number; height: number } };
  nodeClick: { nodeId: string };
  /** The pointer moved onto a node (or off all nodes) inside the canvas. */
  nodeHover: { nodeId: string | null };
  options: { items: OptionItem[] };
  navigate: { url: string };
  error: { code: string; nodeId?: string; message: string };
};

export type MessageMap = Record<string, unknown>;

export interface Messenger<Out extends MessageMap, In extends MessageMap> {
  send<T extends keyof Out & string>(type: T, payload: Out[T], replyTo?: string): void;
  /** Sends a request and resolves with the reply's payload. */
  request<T extends keyof Out & string, R extends keyof In & string>(
    type: T,
    payload: Out[T],
    options?: { timeoutMs?: number },
  ): Promise<In[R]>;
  on<T extends keyof In & string>(
    type: T,
    handler: (payload: In[T], envelope: Envelope<T, In[T]>) => void,
  ): () => void;
  destroy(): void;
}

export interface MessengerOptions {
  /** The window that receives our messages and whose messages we accept. */
  target: () => Window | null;
  /** Exact origin of the other side; messages from anywhere else are dropped. */
  origin: string;
  /** The window to listen on. Defaults to globalThis. */
  self?: Window;
}

export function isEnvelope(data: unknown): data is Envelope {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Envelope).protocol === PROTOCOL &&
    (data as Envelope).v === PROTOCOL_VERSION &&
    typeof (data as Envelope).type === "string"
  );
}

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

export function createMessenger<Out extends MessageMap, In extends MessageMap>(
  options: MessengerOptions,
): Messenger<Out, In> {
  if (options.origin === "*" || !/^https?:\/\/[^/]+$/.test(options.origin)) {
    throw new Error(`Messenger needs an exact origin, got "${options.origin}"`);
  }
  const self = options.self ?? (globalThis as unknown as Window);
  const handlers = new Map<string, Set<(payload: unknown, envelope: Envelope) => void>>();
  const pending = new Map<
    string,
    { resolve: (payload: unknown) => void; timer: ReturnType<typeof setTimeout> }
  >();

  const listener = (event: MessageEvent) => {
    if (event.origin !== options.origin) return;
    const target = options.target();
    if (target && event.source !== target) return;
    if (!isEnvelope(event.data)) return;
    const envelope = event.data;
    if (envelope.replyTo && pending.has(envelope.replyTo)) {
      const entry = pending.get(envelope.replyTo);
      pending.delete(envelope.replyTo);
      clearTimeout(entry?.timer);
      entry?.resolve(envelope.payload);
    }
    for (const handler of handlers.get(envelope.type) ?? []) handler(envelope.payload, envelope);
  };
  self.addEventListener("message", listener);

  function post(envelope: Envelope) {
    options.target()?.postMessage(envelope, options.origin);
  }

  return {
    send(type, payload, replyTo) {
      post({
        protocol: PROTOCOL,
        v: PROTOCOL_VERSION,
        type,
        payload,
        ...(replyTo ? { replyTo } : {}),
      });
    },
    request(type, payload, { timeoutMs = 10_000 } = {}) {
      const id = nextId();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`No reply to ${type} within ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (payload: unknown) => void, timer });
        post({ protocol: PROTOCOL, v: PROTOCOL_VERSION, id, type, payload });
      });
    },
    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as (payload: unknown, envelope: Envelope) => void);
      handlers.set(type, set);
      return () => set.delete(handler as (payload: unknown, envelope: Envelope) => void);
    },
    destroy() {
      self.removeEventListener("message", listener);
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
      handlers.clear();
    },
  };
}

/** JSON with sorted object keys, so equal values always serialize the same way. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 over the sorted manifests; equal component sets give equal hashes. */
export async function manifestHash(manifests: readonly ComponentManifest[]): Promise<string> {
  const sorted = [...manifests].sort((a, b) => a.id.localeCompare(b.id));
  const bytes = new TextEncoder().encode(stableStringify(sorted));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
