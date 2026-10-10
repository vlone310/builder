import { X } from "lucide-react";
import { describeField, type FieldDescriptor, humanize, type JsonSchema } from "../../lib/schema";
import { Input, Label, Select, Switch, Textarea } from "../../ui";
import { OptionsField } from "./OptionsField";
import { RichTextField } from "./RichTextField";

export interface FieldContext {
  nodeId: string;
  componentId: string;
}

interface ObjectFieldsProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  /** The new object, plus the top-level key that changed (for undo grouping). */
  onChange: (value: Record<string, unknown>, field: string) => void;
  context: FieldContext;
  path?: string;
}

/** One control per property of an object schema. */
export function ObjectFields({ schema, value, onChange, context, path = "" }: ObjectFieldsProps) {
  const required = new Set(schema.required ?? []);
  return (
    <div className="space-y-3">
      {Object.entries(schema.properties ?? {}).map(([key, property]) => {
        const fieldPath = path ? `${path}.${key}` : key;
        const set = (next: unknown) => {
          const copy = { ...value };
          if (next === undefined) delete copy[key];
          else copy[key] = next;
          onChange(copy, path ? (path.split(".")[0] ?? key) : key);
        };
        return (
          <Field
            key={key}
            name={key}
            path={fieldPath}
            schema={property}
            value={value[key]}
            required={required.has(key)}
            onChange={set}
            context={context}
          />
        );
      })}
    </div>
  );
}

function Field({
  name,
  path,
  schema,
  value,
  required,
  onChange,
  context,
}: {
  name: string;
  path: string;
  schema: JsonSchema;
  value: unknown;
  required: boolean;
  onChange: (value: unknown) => void;
  context: FieldContext;
}) {
  const field = describeField(schema);
  const id = `field-${context.nodeId}-${path}`;
  const label = schema.title ?? humanize(name);
  const clear =
    !required && value !== undefined ? (
      <button
        type="button"
        className="text-muted hover:text-ink"
        aria-label={`Clear ${label}`}
        title="Clear"
        onClick={() => onChange(undefined)}
      >
        <X size={12} />
      </button>
    ) : null;

  if (field.kind === "object") {
    return (
      <fieldset className="rounded-md border border-line p-2">
        <legend className="flex w-full items-center justify-between px-1 text-xs font-medium text-slate-600">
          {label}
          {clear}
        </legend>
        <ObjectFields
          schema={schema}
          value={(value as Record<string, unknown>) ?? {}}
          onChange={(next) => onChange(next)}
          context={context}
          path={path}
        />
      </fieldset>
    );
  }

  return (
    <div>
      <Label htmlFor={id} hint={clear}>
        {label}
        {required && <span className="text-danger"> *</span>}
      </Label>
      <Control
        id={id}
        field={field}
        value={value}
        onChange={onChange}
        context={context}
        name={name}
      />
      {schema.description && <p className="mt-1 text-[11px] text-muted">{schema.description}</p>}
    </div>
  );
}

function Control({
  id,
  field,
  value,
  onChange,
  context,
  name,
}: {
  id: string;
  field: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  context: FieldContext;
  name: string;
}) {
  switch (field.kind) {
    case "string":
      return field.multiline ? (
        <Textarea
          id={id}
          value={(value as string) ?? ""}
          maxLength={field.schema.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={(value as string) ?? ""}
          maxLength={field.schema.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          value={typeof value === "number" ? value : ""}
          min={field.schema.minimum}
          max={field.schema.maximum}
          step={field.integer ? 1 : "any"}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "boolean":
      return <Switch id={id} checked={value === true} onCheckedChange={onChange} />;
    case "select":
      return (
        <Select
          id={id}
          value={value === undefined ? undefined : String(value)}
          onValueChange={(v) => onChange(field.options.find((o) => String(o.value) === v)?.value)}
          options={field.options.map((o) => ({ value: String(o.value), label: o.label }))}
        />
      );
    case "richText":
      return <RichTextField id={id} value={value} onChange={onChange} />;
    case "link": {
      const link = (value as { href?: string; label?: string; newTab?: boolean }) ?? {};
      return (
        <div className="space-y-1.5">
          <Input
            id={id}
            placeholder="https:// or /path"
            value={link.href ?? ""}
            onChange={(e) => onChange({ ...link, href: e.target.value })}
          />
          <Input
            placeholder="Label"
            aria-label="Link label"
            value={link.label ?? ""}
            onChange={(e) => onChange({ ...link, label: e.target.value || undefined })}
          />
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Switch
              id={`${id}-new-tab`}
              checked={link.newTab === true}
              onCheckedChange={(newTab) => onChange({ ...link, newTab: newTab || undefined })}
            />
            <label htmlFor={`${id}-new-tab`}>Open in a new tab</label>
          </div>
        </div>
      );
    }
    case "image": {
      const image = (value as { src?: string; alt?: string }) ?? {};
      return (
        <div className="space-y-1.5">
          <Input
            id={id}
            placeholder="Image URL"
            value={image.src ?? ""}
            onChange={(e) => onChange({ ...image, src: e.target.value })}
          />
          <Input
            placeholder="Alt text"
            aria-label="Alt text"
            value={image.alt ?? ""}
            onChange={(e) => onChange({ ...image, alt: e.target.value })}
          />
        </div>
      );
    }
    case "dynamicSelect":
      return (
        <OptionsField
          id={id}
          source={field.source ?? ""}
          context={context}
          field={name}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      );
    case "dataRef": {
      const ref = (value as { id?: string }) ?? {};
      return (
        <OptionsField
          id={id}
          source={field.source ?? ""}
          context={context}
          field={name}
          value={ref.id ?? ""}
          onChange={(selected) => onChange({ source: field.source ?? "", id: selected })}
        />
      );
    }
    default:
      return (
        <Textarea
          id={id}
          className="font-mono text-[11px]"
          readOnly
          value={JSON.stringify(value, null, 2) ?? ""}
          aria-label="Value (not editable here)"
        />
      );
  }
}
