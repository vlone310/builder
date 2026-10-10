import type { LoaderContext, PageDocument, PropsSchema, Registry, RenderArgs } from "@builder/core";
import { createElement, Fragment, type ReactNode } from "react";
import type { output } from "zod";
import { type ResolvedNode, type ResolvedPage, type ResolveOptions, resolvePage } from "./resolve";

/** Props a React component receives when registered with defineComponent. */
export type BuilderComponentProps<
  P extends PropsSchema,
  D = undefined,
  S extends string = never,
> = RenderArgs<output<P>, D, S, ReactNode>;

export interface PageRendererProps extends ResolveOptions {
  page: PageDocument;
  registry: Registry;
  ctx?: LoaderContext;
}

/**
 * Server component: runs loaders, then renders the page. Use it in React Server
 * Components (Next.js App Router). Elsewhere call resolvePage and render
 * <ResolvedPageView>.
 */
export async function PageRenderer({ page, registry, ...options }: PageRendererProps) {
  const resolved = await resolvePage(page, registry, options);
  return <ResolvedPageView page={resolved} />;
}

export function ResolvedPageView({ page }: { page: ResolvedPage }): ReactNode {
  return renderNode(page.root, page.mode);
}

function renderNode(node: ResolvedNode, mode: ResolvedPage["mode"]): ReactNode {
  if (node.status === "error") {
    return mode === "edit" ? <NodePlaceholder key={node.id} node={node} /> : null;
  }

  const slots: Record<string, ReactNode> = {};
  for (const [name, children] of Object.entries(node.slots)) {
    slots[name] = (
      <Fragment>
        {children.map((child) => (
          <Fragment key={child.id}>{renderNode(child, mode)}</Fragment>
        ))}
      </Fragment>
    );
  }
  for (const name of Object.keys(node.definition.slots ?? {})) {
    slots[name] ??= null;
  }

  const element = createElement(
    node.definition.render as (args: RenderArgs<unknown, unknown, string, ReactNode>) => ReactNode,
    { props: node.props, data: node.data, slots, nodeId: node.id },
  );
  if (mode !== "edit") return element;
  // The edit bridge finds nodes by this attribute; display: contents keeps layout intact.
  return (
    <div data-node-id={node.id} style={{ display: "contents" }}>
      {element}
    </div>
  );
}

function NodePlaceholder({ node }: { node: Extract<ResolvedNode, { status: "error" }> }) {
  return (
    <div
      data-node-id={node.id}
      data-builder-placeholder={node.code}
      style={{
        padding: 12,
        border: "1px dashed #d97706",
        borderRadius: 6,
        color: "#92400e",
        background: "#fffbeb",
        font: "13px/1.4 system-ui, sans-serif",
      }}
    >
      <strong>{node.type}</strong>: {node.message}
    </div>
  );
}
