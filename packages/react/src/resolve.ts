import {
  type AnyComponentDefinition,
  type LoaderContext,
  type PageDocument,
  type PageNode,
  prepareNode,
  type Registry,
} from "@builder/core";

export type RenderMode = "live" | "edit";

export type ResolvedNode =
  | {
      status: "ok";
      id: string;
      type: string;
      definition: AnyComponentDefinition;
      props: Record<string, unknown>;
      data: unknown;
      slots: Record<string, ResolvedNode[]>;
    }
  | {
      status: "error";
      id: string;
      type: string;
      code: string;
      message: string;
    };

export interface ResolvedPage {
  document: PageDocument;
  root: ResolvedNode;
  mode: RenderMode;
}

export interface NodeErrorInfo {
  nodeId: string;
  type: string;
  code: string;
  message: string;
}

export interface ResolveOptions {
  /** Passed to every loader as ctx. */
  ctx?: LoaderContext;
  /** "edit" shows placeholders for broken nodes; "live" (default) drops them. */
  mode?: RenderMode;
  /** Per-loader timeout. Default 5000 ms. */
  loaderTimeoutMs?: number;
  /** Called for every node that cannot render. Defaults to console.warn. */
  onNodeError?: (error: NodeErrorInfo) => void;
}

const DEFAULT_LOADER_TIMEOUT_MS = 5000;

/**
 * Prepares a page for rendering: resolves components, migrates and validates
 * props, and runs all loaders in parallel. A failing node never fails the page.
 */
export async function resolvePage(
  document: PageDocument,
  registry: Registry,
  options: ResolveOptions = {},
): Promise<ResolvedPage> {
  const mode = options.mode ?? "live";
  const ctx = options.ctx ?? {};
  const timeoutMs = options.loaderTimeoutMs ?? DEFAULT_LOADER_TIMEOUT_MS;
  const onNodeError =
    options.onNodeError ??
    ((error: NodeErrorInfo) =>
      console.warn(`[builder] node ${error.nodeId} (${error.type}): ${error.message}`));

  async function resolveNode(node: PageNode): Promise<ResolvedNode> {
    const fail = (code: string, message: string): ResolvedNode => {
      onNodeError({ nodeId: node.id, type: node.type, code, message });
      return { status: "error", id: node.id, type: node.type, code, message };
    };

    const prepared = prepareNode(node, registry);
    if (!prepared.ok) return fail(prepared.code, prepared.message);

    const slotEntries = Object.entries(node.slots ?? {});
    const [data, ...slotResults] = await Promise.all([
      runLoader(prepared.definition, prepared.props, node.id, ctx, timeoutMs),
      ...slotEntries.map(([, children]) => Promise.all(children.map(resolveNode))),
    ]);
    if (!data.ok) return fail("loader_failed", data.message);

    const slots: Record<string, ResolvedNode[]> = {};
    slotEntries.forEach(([name], index) => {
      slots[name] = slotResults[index] as ResolvedNode[];
    });
    return {
      status: "ok",
      id: node.id,
      type: node.type,
      definition: prepared.definition,
      props: prepared.props,
      data: data.value,
      slots,
    };
  }

  return { document, mode, root: await resolveNode(document.root) };
}

async function runLoader(
  definition: AnyComponentDefinition,
  props: Record<string, unknown>,
  nodeId: string,
  ctx: LoaderContext,
  timeoutMs: number,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  if (!definition.loader) return { ok: true, value: undefined };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Loader timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([
      Promise.resolve(definition.loader({ props, ctx, nodeId, signal: controller.signal })),
      timeout,
    ]);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
