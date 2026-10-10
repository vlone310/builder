import { z } from "zod";
import { COMPONENT_ID_PATTERN } from "./document";

export type PropsSchema = z.ZodType<Record<string, unknown>>;

export interface SlotConfig {
  /** Component ids or "<library>/*" patterns allowed in this slot. Omit to allow any. */
  allow?: string[];
  /** Maximum number of children. */
  max?: number;
}

export interface ComponentConstraints {
  /**
   * Where the component may sit in the tree:
   * - "root": only as the page root
   * - "section": anywhere except the page root
   * - "any" (default): anywhere
   */
  placement?: "root" | "section" | "any";
  /** Maximum number of instances on one page. */
  maxPerPage?: number;
}

/** Anything the host app passes to loaders: data clients, locale, request info. */
// biome-ignore lint/suspicious/noExplicitAny: tenants augment this with their own services
export type LoaderContext = Record<string, any>;

export interface LoaderArgs<P> {
  props: P;
  ctx: LoaderContext;
  nodeId: string;
  signal: AbortSignal;
}

export interface RenderArgs<P, D, S extends string, TChild = unknown> {
  props: P;
  /** Loader result, or undefined when the component has no loader. */
  data: D;
  slots: Record<S, TChild>;
  nodeId: string;
}

/** Upgrades props stored under major N so they fit major N + 1. */
export type PropsMigration = (props: Record<string, unknown>) => Record<string, unknown>;

export interface ComponentConfig<P extends PropsSchema, D, S extends string> {
  /** Stable, namespaced "<library>/<name>"; never reused for another component. */
  id: string;
  /** Semver. A major bump is a breaking prop change and needs a migration. */
  version: string;
  label: string;
  category?: string;
  description?: string;
  thumbnail?: string;
  props: P;
  slots?: Record<S, SlotConfig>;
  constraints?: ComponentConstraints;
  /** Server-side data function; runs only inside the host app. */
  loader?: (args: LoaderArgs<z.output<P>>) => D | Promise<D>;
  /** Keyed by the major version the props come FROM: { 1: v1 -> v2, 2: v2 -> v3 }. */
  migrations?: Record<number, PropsMigration>;
  /** Framework render function; @builder/react expects a React component. */
  render(args: RenderArgs<z.output<P>, D, S>): unknown;
}

export interface ComponentDefinition<
  P extends PropsSchema = PropsSchema,
  D = unknown,
  S extends string = string,
> extends ComponentConfig<P, D, S> {
  readonly major: number;
}

// biome-ignore lint/suspicious/noExplicitAny: registries hold components of every prop shape
export type AnyComponentDefinition = ComponentDefinition<any, any, any>;

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

export function defineComponent<P extends PropsSchema, D = undefined, S extends string = never>(
  config: ComponentConfig<P, D, S>,
): ComponentDefinition<P, D, S> {
  if (!COMPONENT_ID_PATTERN.test(config.id)) {
    throw new Error(`Invalid component id "${config.id}": expected "<library>/<name>"`);
  }
  const semver = SEMVER_PATTERN.exec(config.version);
  if (!semver) {
    throw new Error(`Invalid version "${config.version}" for ${config.id}: expected semver`);
  }
  const major = Number(semver[1]);
  for (let from = 1; from < major; from++) {
    if (typeof config.migrations?.[from] !== "function") {
      throw new Error(`${config.id}@${major} is missing a migration from major ${from}`);
    }
  }
  return Object.freeze({ ...config, major });
}

export interface ComponentManifest {
  id: string;
  version: string;
  major: number;
  label: string;
  category?: string;
  description?: string;
  thumbnail?: string;
  /** JSON Schema (draft 2020-12) for the props, with x-builder-field hints. */
  propsSchema: Record<string, unknown>;
  slots: Record<string, SlotConfig>;
  constraints: ComponentConstraints;
  hasLoader: boolean;
  /** Majors this component can still upgrade from. */
  migratesFrom: number[];
}

/** The JSON the editor and Registry read; built without running any component code. */
export function toManifest(definition: AnyComponentDefinition): ComponentManifest {
  const manifest: ComponentManifest = {
    id: definition.id,
    version: definition.version,
    major: definition.major,
    label: definition.label,
    propsSchema: z.toJSONSchema(definition.props, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>,
    slots: definition.slots ?? {},
    constraints: definition.constraints ?? {},
    hasLoader: typeof definition.loader === "function",
    migratesFrom: Object.keys(definition.migrations ?? {})
      .map(Number)
      .sort((a, b) => a - b),
  };
  if (definition.category !== undefined) manifest.category = definition.category;
  if (definition.description !== undefined) manifest.description = definition.description;
  if (definition.thumbnail !== undefined) manifest.thumbnail = definition.thumbnail;
  return manifest;
}
