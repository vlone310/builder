import { defineComponent, fields } from "@builder/core";
import { type BuilderComponentProps, RichText } from "@builder/react";
import { z } from "zod";

const sectionProps = z.object({
  padding: z.enum(["sm", "md", "lg"]).default("md"),
  background: z.enum(["default", "muted", "dark"]).default("default"),
});

function Section({
  props,
  slots,
}: BuilderComponentProps<typeof sectionProps, undefined, "children">) {
  return (
    <section className={`section section--${props.padding} section--${props.background}`}>
      <div className="container">{slots.children}</div>
    </section>
  );
}

export const section = defineComponent({
  id: "core/section",
  version: "1.0.0",
  label: "Section",
  category: "Layout",
  props: sectionProps,
  slots: { children: {} },
  render: Section,
});

const headingProps = z.object({
  text: z.string().min(1).max(200),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
});

export const heading = defineComponent({
  id: "core/heading",
  version: "1.0.0",
  label: "Heading",
  category: "Text",
  props: headingProps,
  constraints: { placement: "section" },
  render: ({ props }: BuilderComponentProps<typeof headingProps>) => {
    const Tag = `h${props.level}` as const;
    return <Tag>{props.text}</Tag>;
  },
});

const richTextProps = z.object({ content: fields.richText() });

export const richText = defineComponent({
  id: "core/rich-text",
  version: "1.0.0",
  label: "Rich text",
  category: "Text",
  props: richTextProps,
  constraints: { placement: "section" },
  render: ({ props }: BuilderComponentProps<typeof richTextProps>) => (
    <RichText value={props.content} className="rich-text" />
  ),
});

const buttonProps = z.object({
  link: fields.link(),
  variant: z.enum(["primary", "secondary"]).default("primary"),
});

export const button = defineComponent({
  id: "core/button",
  version: "1.0.0",
  label: "Button",
  category: "Actions",
  props: buttonProps,
  constraints: { placement: "section" },
  render: ({ props }: BuilderComponentProps<typeof buttonProps>) => (
    <a
      className={`button button--${props.variant}`}
      href={props.link.href}
      {...(props.link.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {props.link.label ?? props.link.href}
    </a>
  ),
});

export const coreLibrary = [section, heading, richText, button];
