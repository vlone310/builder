import { type RichText, stableStringify } from "@builder/core";
import Link from "@tiptap/extension-link";
import { EditorContent, useEditor as useTiptap } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Underline } from "lucide-react";
import { useEffect, useRef } from "react";
import { fromProseMirror, type PmNode, toProseMirror } from "../../lib/rich-text";
import { cx } from "../../ui";

/** TipTap editing our rich text JSON; only the node types RichText can store are enabled. */
export function RichTextField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (value: RichText) => void;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmitted = useRef<string>("");

  const editor = useTiptap({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        heading: { levels: [2, 3, 4] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ["http", "https", "mailto", "tel"],
      }),
    ],
    content: toProseMirror(value as RichText | undefined),
    editorProps: { attributes: { id, class: "tiptap", "aria-label": "Rich text" } },
    onUpdate: ({ editor }) => {
      const next = fromProseMirror(editor.getJSON() as PmNode);
      lastEmitted.current = stableStringify(next);
      onChangeRef.current(next);
    },
  });

  // Follow outside changes (undo, redo) without clobbering the user's own typing.
  useEffect(() => {
    if (!editor || value === undefined) return;
    const incoming = stableStringify(value);
    if (incoming === lastEmitted.current) return;
    if (incoming === stableStringify(fromProseMirror(editor.getJSON() as PmNode))) return;
    lastEmitted.current = incoming;
    editor.commands.setContent(toProseMirror(value as RichText), { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;
  const button = (label: string, active: boolean, run: () => void, Icon: typeof Bold) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cx(
        "grid h-6 w-6 place-items-center rounded",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-slate-100",
      )}
    >
      <Icon size={13} />
    </button>
  );

  return (
    <div className="rounded-md border border-line focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
      <div className="flex gap-0.5 border-b border-line p-1">
        {button(
          "Bold",
          editor.isActive("bold"),
          () => editor.chain().focus().toggleBold().run(),
          Bold,
        )}
        {button(
          "Italic",
          editor.isActive("italic"),
          () => editor.chain().focus().toggleItalic().run(),
          Italic,
        )}
        {button(
          "Underline",
          editor.isActive("underline"),
          () => editor.chain().focus().toggleUnderline().run(),
          Underline,
        )}
        {button(
          "Heading",
          editor.isActive("heading"),
          () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          Heading2,
        )}
        {button(
          "Bulleted list",
          editor.isActive("bulletList"),
          () => editor.chain().focus().toggleBulletList().run(),
          List,
        )}
        {button(
          "Numbered list",
          editor.isActive("orderedList"),
          () => editor.chain().focus().toggleOrderedList().run(),
          ListOrdered,
        )}
        {button(
          "Link",
          editor.isActive("link"),
          () => {
            const previous = editor.getAttributes("link").href as string | undefined;
            const href = window.prompt("Link URL", previous ?? "https://");
            if (href === null) return;
            if (href === "") editor.chain().focus().unsetLink().run();
            else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
          },
          Link2,
        )}
      </div>
      <EditorContent editor={editor} className="max-h-60 overflow-y-auto px-2 py-1.5" />
    </div>
  );
}
