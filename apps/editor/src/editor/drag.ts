import { insertNodeOps, moveNodeOps, type PageNode } from "@builder/core";
import { computeDropTarget, type DragSpec } from "../lib/drop-target";
import { useEditor } from "../store/editor";
import { newComponentNode } from "./insert";

const THRESHOLD = 4;
const AUTOSCROLL_EDGE = 48;
const AUTOSCROLL_STEP = 14;

/** The iframe whose coordinates drop targets are computed in; set by the canvas. */
export const canvasFrame: { current: HTMLIFrameElement | null } = { current: null };

/**
 * Starts a pointer drag from the palette or the selection handle. The canvas
 * overlay takes pointer events during the drag, so the iframe never sees them:
 * drop targets come from the host's last reported layout and the drop is sent
 * as a patch.
 */
export function beginDrag(
  event: React.PointerEvent<HTMLElement>,
  spec: DragSpec,
  label: string,
  onClick?: () => void,
) {
  if (event.button !== 0) return;
  const source = event.currentTarget;
  const start = { x: event.clientX, y: event.clientY };
  source.setPointerCapture(event.pointerId);
  let active = false;
  let frame = 0;
  let lastFrame = 0;
  let latest = start;
  let scrollTimer: ReturnType<typeof setInterval> | undefined;

  const store = useEditor.getState;

  const update = () => {
    frame = 0;
    const iframe = canvasFrame.current;
    const { layout, document, manifests, drag } = store();
    if (!iframe || !layout || !document || !drag) return;
    const rect = iframe.getBoundingClientRect();
    const point = { x: latest.x - rect.left, y: latest.y - rect.top };
    const inside = point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height;
    const started = performance.now();
    const target = inside ? computeDropTarget(point, layout, spec, document, manifests) : null;
    store().metrics.dropTargetCompute.push(performance.now() - started);
    useEditor.setState({ drag: { ...drag, pointer: inside ? point : null, target } });

    clearInterval(scrollTimer);
    scrollTimer = undefined;
    if (inside && (point.y < AUTOSCROLL_EDGE || point.y > rect.height - AUTOSCROLL_EDGE)) {
      const dy = point.y < AUTOSCROLL_EDGE ? -AUTOSCROLL_STEP : AUTOSCROLL_STEP;
      scrollTimer = setInterval(() => {
        store().send?.("scrollBy", { x: 0, y: dy });
        schedule();
      }, 30);
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const tick = (time: number) => {
    if (!active) return;
    if (lastFrame) store().metrics.dragFrames.push(time - lastFrame);
    lastFrame = time;
    requestAnimationFrame(tick);
  };

  const finish = (commit: boolean) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    cancelAnimationFrame(frame);
    clearInterval(scrollTimer);
    const wasActive = active;
    active = false;
    if (source.isConnected && source.hasPointerCapture(event.pointerId))
      source.releasePointerCapture(event.pointerId);
    const target = store().drag?.target;
    useEditor.setState({ drag: null });
    if (!wasActive) {
      if (commit) onClick?.();
      return;
    }
    const document = store().document;
    if (!commit || !target || !document) return;
    const slotTarget = { parentId: target.parentId, slot: target.slot, index: target.index };
    const metrics = store().metrics;
    metrics.drops += 1;
    if (spec.nodeId) {
      const ops = moveNodeOps(document, spec.nodeId, slotTarget);
      if (ops.length === 0) metrics.noopDrops += 1;
      store().apply(ops, { select: spec.nodeId });
    } else {
      const manifest = store().manifests.get(spec.componentId);
      if (!manifest) return;
      const node: PageNode = newComponentNode(manifest);
      store().apply(insertNodeOps(document, slotTarget, node), { select: node.id });
    }
  };

  const onMove = (e: PointerEvent) => {
    latest = { x: e.clientX, y: e.clientY };
    if (!active) {
      if (Math.hypot(latest.x - start.x, latest.y - start.y) < THRESHOLD) return;
      active = true;
      useEditor.setState({ drag: { spec, label, pointer: null, target: null } });
      requestAnimationFrame(tick);
    }
    schedule();
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };

  // Listen on window: the source may unmount mid-drag (the selection handle does),
  // and the overlay covers the iframe while dragging, so window sees every move.
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}
