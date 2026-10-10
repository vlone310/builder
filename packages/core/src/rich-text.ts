import { z } from "zod";
import { isSafeUrl } from "./url";

/**
 * Rich text is stored as a small JSON tree, never as HTML. Renderers map each
 * node to an element, so there is no markup to sanitize and no way to inject
 * script through a prop.
 */

export const textMarks = ["bold", "italic", "underline", "strike", "code"] as const;
export type TextMark = (typeof textMarks)[number];

export const safeUrlSchema = z
  .string()
  .max(2048)
  .refine(isSafeUrl, { message: "URL scheme is not allowed" });

const textNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(10_000),
  marks: z.array(z.enum(textMarks)).optional(),
});

const linkNodeSchema = z.object({
  type: z.literal("link"),
  href: safeUrlSchema,
  newTab: z.boolean().optional(),
  content: z.array(textNodeSchema),
});

const breakNodeSchema = z.object({ type: z.literal("break") });

export const inlineNodeSchema = z.discriminatedUnion("type", [
  textNodeSchema,
  linkNodeSchema,
  breakNodeSchema,
]);

const paragraphSchema = z.object({
  type: z.literal("paragraph"),
  content: z.array(inlineNodeSchema),
});

const headingSchema = z.object({
  type: z.literal("heading"),
  level: z.number().int().min(1).max(6),
  content: z.array(inlineNodeSchema),
});

const listSchema = z.object({
  type: z.literal("list"),
  ordered: z.boolean().optional(),
  items: z.array(z.object({ content: z.array(inlineNodeSchema) })),
});

export const blockNodeSchema = z.discriminatedUnion("type", [
  paragraphSchema,
  headingSchema,
  listSchema,
]);

export const richTextSchema = z.object({
  type: z.literal("doc"),
  content: z.array(blockNodeSchema).max(1000),
});

export type RichTextText = z.output<typeof textNodeSchema>;
export type RichTextLink = z.output<typeof linkNodeSchema>;
export type RichTextInline = z.output<typeof inlineNodeSchema>;
export type RichTextBlock = z.output<typeof blockNodeSchema>;
export type RichText = z.output<typeof richTextSchema>;

/** Builds a one-paragraph rich text value from plain text. */
export function richTextFromString(text: string): RichText {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}
