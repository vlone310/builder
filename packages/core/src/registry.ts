import {
  type AnyComponentDefinition,
  type ComponentManifest,
  type PropsSchema,
  toManifest,
} from "./component";
import { parseNodeType } from "./document";

export interface Registry {
  get(componentId: string): AnyComponentDefinition | undefined;
  list(): AnyComponentDefinition[];
  manifests(): ComponentManifest[];
}

/** Collects component definitions; ids must be unique across all libraries. */
export function createRegistry(
  ...libraries: Array<AnyComponentDefinition | readonly AnyComponentDefinition[]>
): Registry {
  const byId = new Map<string, AnyComponentDefinition>();
  for (const definition of libraries.flat()) {
    if (byId.has(definition.id)) {
      throw new Error(`Component "${definition.id}" is registered twice`);
    }
    byId.set(definition.id, definition);
  }
  return {
    get: (componentId) => byId.get(componentId),
    list: () => [...byId.values()],
    manifests: () => [...byId.values()].map(toManifest),
  };
}

/** Matches a component id against an allow-list entry: exact id or "<library>/*". */
export function matchesComponentPattern(componentId: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) return componentId.startsWith(pattern.slice(0, -1));
  return componentId === pattern;
}

export type PrepareResult =
  | { ok: true; definition: AnyComponentDefinition; props: Record<string, unknown> }
  | {
      ok: false;
      code: "invalid_type" | "unknown_component" | "unsupported_version" | "migration_failed";
      message: string;
      definition?: AnyComponentDefinition;
    }
  | {
      ok: false;
      code: "invalid_props";
      message: string;
      definition: AnyComponentDefinition;
      issues: Array<{ path: PropertyKey[]; message: string }>;
    };

/**
 * Resolves a node's component, upgrades its props from an older major and
 * validates them. Defaults from the schema are applied to the returned props.
 */
export function prepareNode(
  node: { type: string; props: Record<string, unknown> },
  registry: Registry,
): PrepareResult {
  const parsed = parseNodeType(node.type);
  if (!parsed) {
    return { ok: false, code: "invalid_type", message: `Invalid node type "${node.type}"` };
  }
  const definition = registry.get(parsed.componentId);
  if (!definition) {
    return {
      ok: false,
      code: "unknown_component",
      message: `Component "${parsed.componentId}" is not registered`,
    };
  }
  if (parsed.major > definition.major) {
    return {
      ok: false,
      code: "unsupported_version",
      definition,
      message: `Page uses ${node.type} but the host has ${definition.id}@${definition.major}`,
    };
  }

  let props = node.props;
  for (let from = parsed.major; from < definition.major; from++) {
    const migrate = definition.migrations?.[from];
    if (!migrate) {
      return {
        ok: false,
        code: "migration_failed",
        definition,
        message: `${definition.id} has no migration from major ${from}`,
      };
    }
    try {
      props = migrate(props);
    } catch (error) {
      return {
        ok: false,
        code: "migration_failed",
        definition,
        message: `Migration of ${definition.id} from major ${from} threw: ${errorMessage(error)}`,
      };
    }
  }

  const schema: PropsSchema = definition.props;
  const result = schema.safeParse(props);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    }));
    const summary = issues
      .slice(0, 3)
      .map((issue) => `${issue.path.map(String).join(".") || "props"}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      code: "invalid_props",
      definition,
      message: `Invalid props for ${definition.id} (${summary})`,
      issues,
    };
  }
  return { ok: true, definition, props: result.data };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
