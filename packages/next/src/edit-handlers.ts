import { type LoaderContext, type OptionItem, prepareNode, type Registry } from "@builder/core";
import {
  type EditSession,
  type EditTokenConfig,
  EditTokenError,
  verifyEditToken,
} from "./edit-token";

export type OptionSource = (args: {
  query: string;
  ctx: LoaderContext;
  session: EditSession;
}) => OptionItem[] | Promise<OptionItem[]>;

export interface EditHandlerConfig extends EditTokenConfig {
  registry: Registry;
  /** Builds the loader context per request (data clients, locale, ...). */
  ctx?: (session: EditSession) => LoaderContext | Promise<LoaderContext>;
  /** Choices for dynamicSelect and dataRef fields, keyed by their source. */
  options?: Record<string, OptionSource>;
  /** Per-loader timeout in edit mode. Default 5000 ms. */
  loaderTimeoutMs?: number;
}

type LoadResult = { ok: true; data: unknown } | { ok: false; code: string; message: string };

const MAX_NODES_PER_REQUEST = 200;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Route handler for the edit bridge: runs loaders for nodes the editor is showing
 * and resolves dynamic field options. Mount it at the bridge's endpoint, e.g.
 * app/builder-edit/api/route.ts: export const { POST } = createEditHandlers({...}).
 */
export function createEditHandlers(config: EditHandlerConfig) {
  async function POST(request: Request): Promise<Response> {
    const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) return json({ error: "Missing edit token" }, 401);
    let session: EditSession;
    try {
      session = await verifyEditToken(token, config);
    } catch (error) {
      if (error instanceof EditTokenError) return json({ error: error.message }, 401);
      throw error;
    }

    let body: { action?: unknown; nodes?: unknown; source?: unknown; query?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }
    const ctx = (await config.ctx?.(session)) ?? {};

    if (body.action === "load") {
      if (!Array.isArray(body.nodes) || body.nodes.length > MAX_NODES_PER_REQUEST) {
        return json({ error: `nodes must be an array of at most ${MAX_NODES_PER_REQUEST}` }, 400);
      }
      const entries = await Promise.all(
        body.nodes.map(async (raw): Promise<[string, LoadResult]> => {
          const node = raw as { key?: unknown; type?: unknown; props?: unknown };
          const key = String(node.key);
          if (
            typeof node.type !== "string" ||
            typeof node.props !== "object" ||
            node.props === null
          ) {
            return [key, { ok: false, code: "bad_request", message: "Node needs type and props" }];
          }
          return [
            key,
            await load(
              config,
              { type: node.type, props: node.props as Record<string, unknown> },
              ctx,
            ),
          ];
        }),
      );
      return json({ results: Object.fromEntries(entries) });
    }

    if (body.action === "options") {
      const source = config.options?.[String(body.source)];
      if (!source) return json({ items: [] });
      const items = await source({ query: String(body.query ?? ""), ctx, session });
      return json({ items: items.slice(0, 200) });
    }

    return json({ error: "Unknown action" }, 400);
  }

  return { POST };
}

async function load(
  config: EditHandlerConfig,
  node: { type: string; props: Record<string, unknown> },
  ctx: LoaderContext,
): Promise<LoadResult> {
  const prepared = prepareNode(node, config.registry);
  if (!prepared.ok) return { ok: false, code: prepared.code, message: prepared.message };
  const loader = prepared.definition.loader;
  if (!loader) return { ok: true, data: undefined };
  const timeoutMs = config.loaderTimeoutMs ?? 5000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      Promise.resolve(
        loader({ props: prepared.props, ctx, nodeId: "edit", signal: controller.signal }),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Loader timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      }),
    ]);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      code: "loader_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
