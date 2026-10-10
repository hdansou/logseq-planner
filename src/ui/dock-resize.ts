/**
 * The handle on the left edge of the docked Planner (N40): drag it, or use the arrow keys, to set the frame's width.
 * The frame is anchored to the window's right edge, so widening it moves its left edge, and with it the pointer's
 * coordinates inside the frame: the width is worked out from where the pointer is NOW against where it grabbed, and
 * the width applied so far, never from a start position.
 */
import { clampDockWidth, defaultDockWidth } from "../sdk";

export interface DockResizeHooks {
  /** The width applied now, px. */
  width(): number;
  /** The host window's width, px (the range and the 40% default come from it). */
  viewport(): number;
  /** Applies a width; `animate` false while the pointer drags, so the host follows 1:1. */
  apply(px: number, animate: boolean): void;
  /** The width the user settled on: apply it (animated) and keep it. */
  commit(px: number): void;
  /** The frame's left edge in the window, px, when it can be measured (desktop app): exact even while the frame lags the pointer. */
  frameLeft?(): number | null;
  /**
   * The host document, when the frame can reach it (desktop app): while a drag runs its pointer events (absolute
   * coordinates) carry the drag on when the pointer is outside the frame, which a synthetic or fast pointer is as soon as
   * the frame has not caught up with it.
   */
  host?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

const KEY_STEP = 24;

/** The new width for a pointer at `clientX` (frame coordinates) that grabbed the handle at `grab`. */
export const resizedWidth = (width: number, grab: number, clientX: number, viewport: number): number =>
  clampDockWidth(width - (clientX - grab), viewport);

/** Listens on `root` for the handle (`[data-dock-resize]`); returns the function that removes the listeners. */
export function installDockResize(root: HTMLElement, hooks: DockResizeHooks): () => void {
  let drag: { pointerId: number; grab: number; start: number; moved: boolean } | null = null;
  const handle = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>("[data-dock-resize]") ?? null;

  /** The host's events while dragging: `clientX` there is the pointer's place in the window, so no frame offset applies. */
  const hostMove = (e: Event) => {
    const p = e as PointerEvent;
    if (!drag || (p.pointerId !== undefined && p.pointerId !== drag.pointerId)) return;
    drag.moved = true;
    hooks.apply(clampDockWidth(hooks.viewport() - (p.clientX - drag.grab), hooks.viewport()), false);
  };
  const hostEnd = (e: Event) => {
    up(e);
    stopHost();
  };
  const hostEvents: [string, (e: Event) => void][] = [["pointermove", hostMove], ["pointerup", hostEnd], ["pointercancel", (e) => (cancel(e), stopHost())]];
  /** While a drag runs: the frame's whole document hears the pointer (the handle can be replaced by a redraw, or the pointer be anywhere in the frame), and so does the host. */
  let frameEvents: [string, (e: Event) => void][] = []; // set once `move`, `up` and `cancel` exist
  const stopHost = () => {
    for (const [type, fn] of hostEvents) hooks.host?.removeEventListener(type, fn);
    for (const [type, fn] of frameEvents) root.ownerDocument.removeEventListener(type, fn, true);
  };
  const down = (e: Event) => {
    const el = handle(e);
    const p = e as PointerEvent;
    if (!el || p.button !== 0) return;
    drag = { pointerId: p.pointerId, grab: p.clientX, start: hooks.width(), moved: false };
    el.setPointerCapture?.(p.pointerId);
    for (const [type, fn] of hostEvents) hooks.host?.addEventListener(type, fn);
    for (const [type, fn] of frameEvents) root.ownerDocument.addEventListener(type, fn, true);
    e.preventDefault();
  };
  const move = (e: Event) => {
    const p = e as PointerEvent;
    if (!drag || p.pointerId !== drag.pointerId) return;
    drag.moved = true;
    const left = hooks.frameLeft?.();
    const viewport = hooks.viewport();
    hooks.apply(left == null ? resizedWidth(hooks.width(), drag.grab, p.clientX, viewport) : clampDockWidth(viewport - (left + p.clientX - drag.grab), viewport), false);
  };
  const up = (e: Event) => {
    const p = e as PointerEvent;
    if (!drag || p.pointerId !== drag.pointerId) return;
    const { moved } = drag;
    drag = null;
    stopHost();
    if (moved) hooks.commit(hooks.width());
  };
  const cancel = (e: Event) => {
    const p = e as PointerEvent;
    if (!drag || p.pointerId !== drag.pointerId) return;
    const { start } = drag;
    drag = null;
    stopHost();
    hooks.apply(start, true);
  };
  frameEvents = [["pointermove", move], ["pointerup", up], ["pointercancel", cancel]];
  const key = (e: Event) => {
    const k = e as KeyboardEvent;
    if (!handle(e) || (k.key !== "ArrowLeft" && k.key !== "ArrowRight")) return;
    const step = KEY_STEP * (k.shiftKey ? 4 : 1) * (k.key === "ArrowLeft" ? 1 : -1);
    hooks.commit(clampDockWidth(hooks.width() + step, hooks.viewport()));
    e.preventDefault();
  };
  const reset = (e: Event) => {
    if (handle(e)) hooks.commit(clampDockWidth(defaultDockWidth(hooks.viewport()), hooks.viewport()));
  };

  const listeners: [string, (e: Event) => void][] = [["pointerdown", down], ["keydown", key], ["dblclick", reset]];
  for (const [type, fn] of listeners) root.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of listeners) root.removeEventListener(type, fn);
    stopHost();
    drag = null;
  };
}
