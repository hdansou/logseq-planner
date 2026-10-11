/**
 * Editing dates in the Calendar time grids (N46): drag a block to move it (days across columns, 15-minute steps down the
 * hours), drag its top or bottom edge to change its start or end, or use Alt+Arrow keys. The workspace owns the state and
 * the writes (`commit`); this module reads the gesture. While a drag runs only the block's inline style changes (a
 * transform for a move, the minute variables for a resize), so nothing is re-rendered under the pointer.
 */
import { gridDelta, GRID_STEP_MIN, type CalendarRange, type GridBlock } from "../core/calendar-layout";
import type { EditMode } from "../core/date-edit";
import { HOUR_PX } from "./calendar";

/** Past this many px the pointer is dragging, not clicking (equal to the Timeline's, which it follows). */
const CLICK_PX = 4;
const QUARTER_PX = (HOUR_PX * GRID_STEP_MIN) / 60;

export interface GridEditHooks {
  /** Edit dates is on. */
  enabled(): boolean;
  /** The editable block under `el` and the range it is drawn in, from the layout on screen now; null when it cannot be edited. */
  target(el: HTMLElement): { block: GridBlock; range: CalendarRange } | null;
  /** The gesture's result: `delta` 15-minute steps (96 per day) in `mode`; `focus` is the block's selector for after the redraw. */
  commit(block: GridBlock, mode: EditMode, delta: number, focus: string): void;
  /** The release that follows a drag opens nothing. */
  swallowClick(): void;
  /** A drag ended without a write: a redraw it held up can run. */
  ended(): void;
}

export interface GridEdit {
  dragging(): boolean;
  /** Aborts a drag in progress (Escape): the block goes back, nothing is written. True when there was one. */
  abort(): boolean;
}

interface Drag {
  el: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  mode: EditMode;
  block: GridBlock;
  range: CalendarRange;
  colWidth: number;
  style: string;
  days: number;
  quarters: number;
  delta: number;
  moved: boolean;
}

const selectorOf = (b: GridBlock) => `[data-cg-block][data-cal-open="${CSS.escape(b.uuid)}"]`;

export function installGridEdit(root: HTMLElement, hooks: GridEditHooks): GridEdit {
  let drag: Drag | null = null;

  const finish = (g: Drag) => {
    drag = null;
    g.el.setAttribute("style", g.style);
    g.el.removeAttribute("data-cg-dragging");
    hooks.ended();
  };

  /** What the block looks like for the drag so far: moved as a whole, or one edge's minute changed. */
  const preview = (g: Drag) => {
    const { span } = g.block;
    const minute = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    if (g.mode === "move") {
      g.el.setAttribute("style", `${g.style}; transform: translate(${g.days * g.colWidth}px, ${g.quarters * QUARTER_PX}px)`);
      return;
    }
    const s = minute(span!.start.time!);
    const e = minute(span!.end.time!);
    const start = g.mode === "start" ? s + g.quarters * GRID_STEP_MIN : s;
    const end = g.mode === "end" ? e + g.quarters * GRID_STEP_MIN : e;
    g.el.setAttribute("style", `${g.style}; --pl-start: ${start}; --pl-len: ${Math.max(end - start, GRID_STEP_MIN)}`);
  };

  root.addEventListener("pointerdown", (e) => {
    if (!hooks.enabled() || drag || e.button !== 0) return;
    const t = e.target as Element;
    const el = t.closest?.<HTMLElement>("[data-cg-editable]");
    if (!el) return;
    const side = t.closest<HTMLElement>("[data-cg-handle]")?.dataset.cgHandle as "start" | "end" | undefined;
    const mode: EditMode = side ?? "move";
    if (mode === "move" && !el.hasAttribute("data-cg-move")) return;
    const found = hooks.target(el);
    if (!found) return;
    const col = root.querySelector<HTMLElement>("[data-cg-col]");
    drag = {
      el, pointerId: e.pointerId, x: e.clientX, y: e.clientY, mode, block: found.block, range: found.range,
      colWidth: col?.getBoundingClientRect().width || 1, style: el.getAttribute("style") ?? "", days: 0, quarters: 0, delta: 0, moved: false,
    };
    el.setPointerCapture?.(e.pointerId); // moves and the release keep coming to the block when the pointer leaves it
  });

  root.addEventListener("pointermove", (e) => {
    const g = drag;
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < CLICK_PX) return;
    if (!g.moved) g.el.setAttribute("data-cg-dragging", "");
    g.moved = true;
    const d = gridDelta(g.block, g.mode, g.range, Math.round(dx / g.colWidth), Math.round(dy / QUARTER_PX));
    if (d.delta === g.delta && d.days === g.days) return;
    Object.assign(g, d);
    preview(g);
  });

  root.addEventListener("pointerup", (e) => {
    const g = drag;
    if (!g || e.pointerId !== g.pointerId) return;
    if (!g.moved) return void finish(g); // a click: it opens the node
    hooks.swallowClick();
    if (g.delta === 0) return void finish(g);
    drag = null;
    g.el.removeAttribute("data-cg-dragging");
    hooks.commit(g.block, g.mode, g.delta, selectorOf(g.block));
  });

  root.addEventListener("pointercancel", (e) => {
    if (drag && e.pointerId === drag.pointerId) finish(drag);
  });

  // Alt+Left / Right: a day; Alt+Up / Down: 15 minutes; with Shift Up / Down change the end (the start when only that can).
  root.addEventListener("keydown", (e) => {
    if (!hooks.enabled() || !e.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const el = (e.target as Element).closest?.<HTMLElement>("[data-cg-editable]");
    if (!el) return;
    e.preventDefault(); // the host gets none of these on an editable block
    if (drag) return;
    const found = hooks.target(el);
    if (!found) return;
    const { block, range } = found;
    const sign = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    let mode: EditMode = "move";
    if (e.shiftKey && !horizontal) mode = block.edit!.resizeEnd ? "end" : block.edit!.resizeStart ? "start" : "move";
    if (horizontal && e.shiftKey) return;
    if (mode === "move" && !block.edit!.move) return;
    const d = gridDelta(block, mode, range, horizontal ? sign : 0, horizontal ? 0 : sign);
    if (d.delta !== 0) hooks.commit(block, mode, d.delta, selectorOf(block));
  });

  return {
    dragging: () => drag !== null,
    abort() {
      if (!drag) return false;
      hooks.swallowClick();
      finish(drag);
      return true;
    },
  };
}
