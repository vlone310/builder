import { useEffect } from "react";
import { useEditor } from "../store/editor";
import { duplicateNode, removeNode, shiftNode } from "./actions";

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
      target.closest("[role=listbox]") !== null)
  );
}

/** Undo/redo everywhere; node commands when focus is not in a field. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useEditor.getState();
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z" && !isTyping(event.target)) {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && key === "y" && !isTyping(event.target)) {
        event.preventDefault();
        store.redo();
        return;
      }
      if (isTyping(event.target) || !store.selectedId) return;
      const nodeId = store.selectedId;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeNode(nodeId);
      } else if (mod && key === "d") {
        event.preventDefault();
        duplicateNode(nodeId);
      } else if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        shiftNode(nodeId, -1);
      } else if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        shiftNode(nodeId, 1);
      } else if (event.key === "Escape") {
        store.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
