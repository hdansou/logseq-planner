// @vitest-environment happy-dom
// N46: the grid edit gestures on a hand-made grid (the fixtures have no DateTime span), with stub hooks.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GridBlock } from "../core/calendar-layout";
import type { EditMode } from "../core/date-edit";
import { installGridEdit } from "./grid-edit";
import { HOUR_PX } from "./calendar";

const QUARTER_PX = HOUR_PX / 4;
const d = (day: string, time: string) => ({ day, time });
const BLOCK: GridBlock = {
  kind: "span", uuid: "u1", title: "Learn", day: "2026-10-03", startMin: 540, endMin: 600, timeLabel: "09:00 – 10:00", cat: 1, node: null, status: null, done: false, late: false, label: "Learn",
  col: 0, cols: 1, pending: false,
  edit: { start: { id: 1, ident: ":a/s", title: "Start", type: "datetime" }, end: { id: 2, ident: ":a/e", title: "End", type: "datetime" }, point: false, move: true, resizeStart: true, resizeEnd: true },
  span: { start: d("2026-10-03", "09:00"), end: d("2026-10-03", "10:00") },
};
const RANGE = { start: "2026-10-02", end: "2026-10-04", label: "" };

let root: HTMLElement;
let commit: ReturnType<typeof vi.fn<(b: GridBlock, mode: EditMode, delta: number, focus: string) => void>>;
let ended: ReturnType<typeof vi.fn<() => void>>;
let edit: ReturnType<typeof installGridEdit>;
const el = () => root.querySelector<HTMLElement>("[data-cg-block]")!;
const handle = (side: string) => root.querySelector<HTMLElement>(`[data-cg-handle=${side}]`)!;
const ptr = (target: Element, type: string, y: number) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: y, pointerId: 1, button: 0 }));

beforeEach(() => {
  document.body.innerHTML = `<div id="root"><div data-cg-col="2026-10-03"><button data-cg-block data-cal-open="u1" data-cg-editable data-cg-move style="--pl-start: 540; --pl-len: 60">`
    + `<span data-cg-handle="start"></span><span data-cg-handle="end"></span></button></div></div>`;
  root = document.getElementById("root")!;
  commit = vi.fn<(b: GridBlock, mode: EditMode, delta: number, focus: string) => void>();
  ended = vi.fn<() => void>();
  edit = installGridEdit(root, { enabled: () => true, target: () => ({ block: BLOCK, range: RANGE }), commit, swallowClick: vi.fn(), ended });
});

describe("resizing", () => {
  it("the bottom edge changes the end by quarter hours: the block grows live, one commit on release", () => {
    ptr(handle("end"), "pointerdown", 100);
    ptr(el(), "pointermove", 100 + 3 * QUARTER_PX);
    expect(el().getAttribute("style")).toContain("--pl-len: 105");
    expect(el().getAttribute("style")).toContain("--pl-start: 540");
    ptr(el(), "pointerup", 100 + 3 * QUARTER_PX);
    expect(commit).toHaveBeenCalledWith(BLOCK, "end", 3, '[data-cg-block][data-cal-open="u1"]');
  });

  it("the top edge changes the start: the block's top moves, its end stays", () => {
    ptr(handle("start"), "pointerdown", 100);
    ptr(el(), "pointermove", 100 - 2 * QUARTER_PX);
    expect(el().getAttribute("style")).toContain("--pl-start: 510");
    expect(el().getAttribute("style")).toContain("--pl-len: 90");
    ptr(el(), "pointerup", 100 - 2 * QUARTER_PX);
    expect(commit).toHaveBeenCalledWith(BLOCK, "start", -2, expect.any(String));
  });

  it("an edge cannot cross the other: at least 15 minutes stay", () => {
    ptr(handle("end"), "pointerdown", 100);
    ptr(el(), "pointermove", 100 - 50 * QUARTER_PX);
    ptr(el(), "pointerup", 100 - 50 * QUARTER_PX);
    expect(commit).toHaveBeenCalledWith(BLOCK, "end", -3, expect.any(String));
  });

  it("an aborted resize puts the block back", () => {
    ptr(handle("end"), "pointerdown", 100);
    ptr(el(), "pointermove", 100 + 4 * QUARTER_PX);
    expect(edit.dragging()).toBe(true);
    expect(edit.abort()).toBe(true);
    expect(el().getAttribute("style")).toBe("--pl-start: 540; --pl-len: 60");
    expect(commit).not.toHaveBeenCalled();
    expect(ended).toHaveBeenCalled();
    expect(edit.abort()).toBe(false);
  });
});

describe("keys", () => {
  const key = (k: string, init: KeyboardEventInit) => el().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, altKey: true, ...init }));

  it("Alt+Shift+Down changes the end by 15 minutes, Alt+Shift+Up shortens it", () => {
    key("ArrowDown", { shiftKey: true });
    expect(commit).toHaveBeenLastCalledWith(BLOCK, "end", 1, expect.any(String));
    key("ArrowUp", { shiftKey: true });
    expect(commit).toHaveBeenLastCalledWith(BLOCK, "end", -1, expect.any(String));
  });

  it("Alt+Down moves 15 minutes, Alt+Left a day earlier", () => {
    key("ArrowDown", {});
    expect(commit).toHaveBeenLastCalledWith(BLOCK, "move", 1, expect.any(String));
    key("ArrowLeft", {});
    expect(commit).toHaveBeenLastCalledWith(BLOCK, "move", -96, expect.any(String));
  });

  it("Alt+Shift+Left / Right do nothing (a day-wide resize does not exist)", () => {
    key("ArrowRight", { shiftKey: true });
    expect(commit).not.toHaveBeenCalled();
  });
});
