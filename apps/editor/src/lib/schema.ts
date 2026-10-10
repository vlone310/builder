import { FIELD_KEYWORD, type FieldKind } from "@builder/core";

/** The JSON Schema subset zod's toJSONSchema produces for component props. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  title?: string;
  description?: string;
  items?: JsonSchema;
  source?: string;
  [FIELD_KEYWORD]?: FieldKind;
}

export type FieldDescriptor =
  | { kind: FieldKind; schema: JsonSchema; source?: string }
  | { kind: "select"; schema: JsonSchema; options: Array<{ value: unknown; label: string }> }
  | { kind: "string"; schema: JsonSchema; multiline: boolean }
  | { kind: "number"; schema: JsonSchema; integer: boolean }
  | { kind: "boolean"; schema: JsonSchema }
  | { kind: "object"; schema: JsonSchema }
  | { kind: "unsupported"; schema: JsonSchema };

function constOptions(schemas: JsonSchema[]): Array<{ value: unknown; label: string }> | null {
  const options = schemas.map((s) =>
    s.const !== undefined ? s.const : s.enum?.length === 1 ? s.enum[0] : undefined,
  );
  return options.every((o) => o !== undefined)
    ? options.map((value) => ({ value, label: String(value) }))
    : null;
}

/** Picks the editor control for a prop's schema. */
export function describeField(schema: JsonSchema): FieldDescriptor {
  const custom = schema[FIELD_KEYWORD];
  if (custom) return { kind: custom, schema, ...(schema.source ? { source: schema.source } : {}) };
  if (schema.enum)
    return {
      kind: "select",
      schema,
      options: schema.enum.map((value) => ({ value, label: String(value) })),
    };
  const union = schema.anyOf ?? schema.oneOf;
  if (union) {
    const options = constOptions(union);
    if (options) return { kind: "select", schema, options };
    const nonNull = union.filter((s) => s.type !== "null");
    if (nonNull.length === 1 && nonNull[0]) return describeField(nonNull[0]);
    return { kind: "unsupported", schema };
  }
  if (schema.const !== undefined)
    return {
      kind: "select",
      schema,
      options: [{ value: schema.const, label: String(schema.const) }],
    };
  switch (schema.type) {
    case "string":
      return { kind: "string", schema, multiline: (schema.maxLength ?? 0) > 200 };
    case "number":
    case "integer":
      return { kind: "number", schema, integer: schema.type === "integer" };
    case "boolean":
      return { kind: "boolean", schema };
    case "object":
      return { kind: "object", schema };
    default:
      return { kind: "unsupported", schema };
  }
}

export function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/** A starting value that satisfies the schema where it can, used for new components. */
export function defaultValue(schema: JsonSchema, label = "Text"): unknown {
  if (schema.default !== undefined) return structuredClone(schema.default);
  const field = describeField(schema);
  switch (field.kind) {
    case "richText":
      return {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: label }] }],
      };
    case "link":
      return { href: "/", label };
    case "image":
      return { src: "https://placehold.co/800x400/png", alt: "" };
    case "dynamicSelect":
      return "";
    case "dataRef":
      return { source: field.source ?? "", id: "" };
    case "select":
      return field.options[0]?.value;
    case "string":
      return (schema.minLength ?? 0) > 0 ? label : "";
    case "number":
      return (
        schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 0)
      );
    case "boolean":
      return false;
    case "object":
      return defaultProps(schema, label);
    default:
      return undefined;
  }
}

/** Props for a freshly inserted component: defaults plus every required field. */
export function defaultProps(schema: JsonSchema, label = "Text"): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (property.default === undefined && !required.has(key)) continue;
    const value = defaultValue(property, label);
    if (value !== undefined) props[key] = value;
  }
  return props;
}
