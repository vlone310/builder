import { z } from "zod";
import { richTextSchema, safeUrlSchema } from "./rich-text";

/**
 * JSON Schema keyword the editor reads to pick a control for a prop.
 * Plain Zod types (string, number, enum, boolean) get default controls.
 */
export const FIELD_KEYWORD = "x-builder-field";

export type FieldKind = "richText" | "link" | "image" | "dynamicSelect" | "dataRef";

const linkSchema = z.object({
  href: safeUrlSchema,
  label: z.string().max(500).optional(),
  newTab: z.boolean().optional(),
});

const imageSchema = z.object({
  src: safeUrlSchema,
  alt: z.string().max(500),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export type LinkValue = z.output<typeof linkSchema>;
export type ImageValue = z.output<typeof imageSchema>;
export type DataRefValue = { source: string; id: string };

export const fields = {
  /** Formatted text stored as a JSON tree; see RichText. */
  richText: () => richTextSchema.meta({ [FIELD_KEYWORD]: "richText" }),

  /** A link with an allow-listed URL scheme. */
  link: () => linkSchema.meta({ [FIELD_KEYWORD]: "link" }),

  /** An image from the media library or an external URL. */
  image: () => imageSchema.meta({ [FIELD_KEYWORD]: "image" }),

  /**
   * A string chosen from options the host app provides at edit time
   * (resolveOptions in the protocol), such as leagues or offers.
   */
  dynamicSelect: (options: { source: string }) =>
    z
      .string()
      .min(1)
      .meta({ [FIELD_KEYWORD]: "dynamicSelect", source: options.source }),

  /** A reference to a record the host app loads; the page stores only the id. */
  dataRef: (options: { source: string }) =>
    z
      .object({ source: z.literal(options.source), id: z.string().min(1) })
      .meta({ [FIELD_KEYWORD]: "dataRef", source: options.source }),
};
