import type { OptionItem } from "@builder/core";
import { useEffect, useState } from "react";
import { Input, Select } from "../../ui";
import { hostOptions } from "../Canvas";
import type { FieldContext } from ".";

/** Choices come from the host app (resolveOptions), e.g. leagues or offers. */
export function OptionsField({
  id,
  source,
  field,
  context,
  value,
  onChange,
}: {
  id: string;
  source: string;
  field: string;
  context: FieldContext;
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<OptionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const request = hostOptions.current;
        if (!request) throw new Error("Host is not connected");
        const result = await request({ component: context.componentId, field, source, query });
        if (!cancelled) {
          setItems(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, field, context.componentId, query]);

  const options = items ?? [];
  // Keep the current value selectable even when the search hides it.
  const withCurrent =
    value && !options.some((o) => o.value === value)
      ? [{ value, label: value }, ...options]
      : options;

  return (
    <div className="space-y-1.5">
      <Select
        id={id}
        value={value || undefined}
        onValueChange={onChange}
        options={withCurrent}
        placeholder={items ? "Choose…" : "Loading…"}
      />
      <Input
        placeholder={`Search ${source}`}
        aria-label={`Search ${source}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
