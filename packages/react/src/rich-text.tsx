import {
  isSafeUrl,
  type RichTextInline,
  type RichTextText,
  type RichText as RichTextValue,
} from "@builder/core";
import type { ReactNode } from "react";

/**
 * Renders a rich text value. Every node maps to a fixed element and text is
 * escaped by React, so stored content cannot inject markup or script.
 */
export function RichText({
  value,
  className,
}: {
  value: RichTextValue | undefined;
  className?: string;
}) {
  if (!value) return null;
  return (
    <div className={className}>
      {value.content.map((block, index) => {
        switch (block.type) {
          case "paragraph":
            return <p key={index}>{renderInlines(block.content)}</p>;
          case "heading": {
            const Tag = `h${block.level}` as "h1";
            return <Tag key={index}>{renderInlines(block.content)}</Tag>;
          }
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInlines(item.content)}</li>
                ))}
              </Tag>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}

function renderInlines(nodes: RichTextInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <MarkedText key={index} node={node} />;
      case "break":
        return <br key={index} />;
      case "link": {
        // Already validated on save; checked again so a bad value never reaches href.
        const children = node.content.map((text, textIndex) => (
          <MarkedText key={textIndex} node={text} />
        ));
        if (!isSafeUrl(node.href)) return <span key={index}>{children}</span>;
        return (
          <a
            key={index}
            href={node.href}
            {...(node.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {children}
          </a>
        );
      }
      default:
        return null;
    }
  });
}

function MarkedText({ node }: { node: RichTextText }) {
  let content: ReactNode = node.text;
  for (const mark of node.marks ?? []) {
    switch (mark) {
      case "bold":
        content = <strong>{content}</strong>;
        break;
      case "italic":
        content = <em>{content}</em>;
        break;
      case "underline":
        content = <u>{content}</u>;
        break;
      case "strike":
        content = <s>{content}</s>;
        break;
      case "code":
        content = <code>{content}</code>;
        break;
    }
  }
  return <>{content}</>;
}
