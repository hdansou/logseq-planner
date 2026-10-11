// @vitest-environment happy-dom
// N46: editing dates by dragging (and Alt+Arrow keys) in the Calendar time grids, through the workspace with a fake graph.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { fakeGraph, fakeStorage, fixtureDq } from "./test-fakes";
import { CLICK_PX, createWorkspace, type Workspace } from "./workspace";
import { HOUR_PX } from "./calendar";

const TODAY = "2026-10-03";
const KICKOFF = "6a000000-0000-4000-8000-000000000011"; // Meeting: DateTime Date 3 Oct 10:30 at UTC−5 (a point)
const KICKOFF_MS = 1791041400000;
const DAY_MS = 86_400_000;
const COL_W = 100; // a day column's width in this test (happy-dom lays nothing out)
const QUARTER_PX = HOUR_PX / 4;

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let graph: ReturnType<typeof fakeGraph>;
let openNode: ReturnType<typeof vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const style = (el: Element | null) => el?.getAttribute("style") ?? "";
const block = (uuid = KICKOFF) => $(`[data-cg-block][data-cal-open="${uuid}"]`)!;
const writes = () => graph.calls.filter(([c]) => c === "upsertBlockProperty" || c === "createJournalPage");

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.click();
  await ws.idle();
}
const ptr = (el: Element, type: string, x: number, y: number, init: PointerEventInit = {}) =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, ...init }));
/** A press on `el` (or on `from` inside it), moves to (dx, dy) from the press, the release and the click a browser sends after it. */
async function drag(el: HTMLElement, dx: number, dy: number, from: Element = el) {
  ptr(from, "pointerdown", 100, 200);
  ptr(el, "pointermove", 100 + dx / 2, 200 + dy / 2);
  ptr(el, "pointermove", 100 + dx, 200 + dy);
  ptr(el, "pointerup", 100 + dx, 200 + dy);
  el.click();
  await ws.idle();
}
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, altKey: true, ...init }));

const realRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.hasAttribute("data-cg-col") ? ({ left: 0, right: COL_W, width: COL_W, top: 0, bottom: 0, height: 0 } as DOMRect) : realRect.call(this);
  };
});
afterAll(() => void (HTMLElement.prototype.getBoundingClientRect = realRect));

beforeEach(async () => {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  graph = fakeGraph();
  openNode = vi.fn();
  ws = createWorkspace(root, { dq: graph.dq, views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode, zone: () => -300, today: () => TODAY, time: () => "13:30",
    kanban: graph.writes, dates: graph.dates, weekStart: async () => 0 });
  await ws.open();
  await click(`[data-tag-id="${tag("Meeting").id}"]`);
  await click("[data-view-kind=calendar]");
  await click("[data-cal-layout=3days]");
});

describe("Edit dates toggle in the grid", () => {
  it("is in the toolbar of the time grids, off by default: blocks are plain buttons", () => {
    const toggle = $("[data-region=view-toolbar] [data-cal-edit]")!;
    expect([toggle.tagName, toggle.textContent, toggle.getAttribute("aria-pressed")]).toEqual(["BUTTON", "Edit dates", "false"]);
    expect($$("[data-cg-editable], [data-cg-locked], [data-cg-handle]")).toEqual([]);
  });

  it("is not in Month", async () => {
    await click("[data-cal-layout=month]");
    expect($("[data-cal-edit]")).toBeNull();
  });

  it("on: an editable block is marked, moves by dragging, and points at one description; off again: gone; focus stays on the toggle", async () => {
    $("[data-cal-edit]")!.focus();
    await click("[data-cal-edit]");
    expect($("[data-cal-edit]")!.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe($("[data-cal-edit]"));
    expect(block().hasAttribute("data-cg-editable")).toBe(true);
    expect(block().hasAttribute("data-cg-move")).toBe(true);
    expect(block().getAttribute("aria-describedby")).toBe("pl-cg-edit-help");
    expect($("#pl-cg-edit-help")!.textContent).toContain("Alt+");
    expect($$("[data-cg-handle]")).toEqual([]); // a one-date block has no edges to resize
    await click("[data-cal-edit]");
    expect($$("[data-cg-editable], #pl-cg-edit-help")).toEqual([]);
  });

  it("shares the session state with the Timeline: not in the config, not saved with a view", async () => {
    await click("[data-cal-edit]");
    expect(JSON.stringify(ws.config())).not.toMatch(/edit/i);
    expect(serializeViewConfig(ws.config()!)).not.toMatch(/edit/i);
  });

  it("a plain click on a block still opens its node", async () => {
    await click("[data-cal-edit]");
    block().click();
    expect(openNode).toHaveBeenCalledWith(KICKOFF, { sidebar: false });
  });
});

describe("dragging a block", () => {
  beforeEach(() => click("[data-cal-edit]"));

  it("moves by whole days and quarter hours: only a transform changes during the drag, the write comes on release", async () => {
    const el = block();
    ptr(el, "pointerdown", 100, 200);
    ptr(el, "pointermove", 100 + COL_W + 20, 200 + 2 * QUARTER_PX + 3); // 1.2 days → 1, 2.25 quarters → 2
    expect(style(el)).toContain(`translate(${COL_W}px, ${2 * QUARTER_PX}px)`);
    expect(el.isConnected).toBe(true); // not re-rendered
    expect(el.hasAttribute("data-cg-dragging")).toBe(true);
    expect(writes()).toEqual([]);
    ptr(el, "pointerup", 100 + COL_W + 20, 200 + 2 * QUARTER_PX + 3);
    el.click();
    await ws.idle();
    expect(writes()).toEqual([["upsertBlockProperty", KICKOFF, expect.stringContaining("/"), KICKOFF_MS + DAY_MS + 30 * 60_000]]);
    expect($(`[data-cg-col="2026-10-04"] [data-cg-block][data-cal-open="${KICKOFF}"]`)).not.toBeNull(); // drawn from the graph read back
    expect(block().querySelector("[data-cg-time]")!.textContent).toBe("11:00");
    expect(openNode).not.toHaveBeenCalled(); // the click after a drag is not an open
    expect($("[data-region=error]")).toBeNull();
  });

  it("a drag under the click threshold is a click: it opens the node and writes nothing", async () => {
    await drag(block(), CLICK_PX - 1, 0);
    expect(writes()).toEqual([]);
    expect(openNode).toHaveBeenCalledTimes(1);
  });

  it("a drag that ends where it started writes nothing and puts the block back", async () => {
    const el = block();
    await drag(el, 0, CLICK_PX + 1); // past the click threshold, under half a quarter hour
    expect(writes()).toEqual([]);
    expect(style(block())).not.toContain("translate");
    expect(openNode).not.toHaveBeenCalled();
  });

  it("stays inside the range and the day: dragged far past the edges it stops at the last column and 00:00", async () => {
    await drag(block(), -10 * COL_W, -100 * HOUR_PX);
    expect(writes()).toEqual([["upsertBlockProperty", KICKOFF, expect.any(String), KICKOFF_MS - DAY_MS - (10 * 60 + 30) * 60_000]]);
    expect($(`[data-cg-col="2026-10-02"] [data-cg-block][data-cal-open="${KICKOFF}"]`)).not.toBeNull();
  });

  it("Escape during a drag puts the block back and writes nothing", async () => {
    const el = block();
    ptr(el, "pointerdown", 100, 200);
    ptr(el, "pointermove", 100 + COL_W, 200 + 4 * QUARTER_PX);
    expect(ws.escape()).toBe(true);
    expect(style(el)).not.toContain("translate");
    ptr(el, "pointerup", 100 + COL_W, 200 + 4 * QUARTER_PX);
    el.click();
    await ws.idle();
    expect(writes()).toEqual([]);
    expect(openNode).not.toHaveBeenCalled();
  });

  it("a write that fails puts the block back where the graph has it and shows the error", async () => {
    graph.state.silent = true;
    await drag(block(), 0, 4 * QUARTER_PX + 1);
    expect($(`[data-cg-col="${TODAY}"] [data-cg-block][data-cal-open="${KICKOFF}"]`)).not.toBeNull();
    expect(block().querySelector("[data-cg-time]")!.textContent).toBe("10:30");
    expect($("[data-region=error]")!.textContent).toMatch(/Date/);
  });

  it("while the write runs the block shows at its new place, flagged pending, without the edit marks", async () => {
    let release!: () => void;
    graph.state.hold = new Promise<void>((r) => (release = r));
    ptr(block(), "pointerdown", 100, 200);
    ptr(block(), "pointermove", 100, 200 + 4 * QUARTER_PX);
    ptr(block(), "pointerup", 100, 200 + 4 * QUARTER_PX);
    await vi.waitFor(() => expect(block().hasAttribute("data-cg-pending")).toBe(true));
    expect(block().getAttribute("aria-busy")).toBe("true");
    expect(block().hasAttribute("data-cg-editable")).toBe(false);
    expect(block().querySelector("[data-cg-time]")!.textContent).toBe("11:30");
    release();
    await ws.idle();
    expect(block().hasAttribute("data-cg-pending")).toBe(false);
  });
});

describe("keys", () => {
  beforeEach(() => click("[data-cal-edit]"));

  it("Alt+Down moves a focused block 15 minutes later, Alt+Up earlier", async () => {
    block().focus();
    key(block(), "ArrowDown");
    await ws.idle();
    expect(writes()).toEqual([["upsertBlockProperty", KICKOFF, expect.any(String), KICKOFF_MS + 15 * 60_000]]);
    expect(document.activeElement).toBe(block()); // focus stays on the block after the redraw
    key(block(), "ArrowUp");
    await ws.idle();
    expect(writes()[writes().length - 1]).toEqual(["upsertBlockProperty", KICKOFF, expect.any(String), KICKOFF_MS]);
  });

  it("Alt+Right moves it a day later (kept inside the range)", async () => {
    block().focus();
    key(block(), "ArrowRight");
    await ws.idle();
    expect(writes()).toEqual([["upsertBlockProperty", KICKOFF, expect.any(String), KICKOFF_MS + DAY_MS]]);
    key(block(), "ArrowRight"); // 5 Oct is out of the range 2 – 4 Oct
    await ws.idle();
    expect(writes()).toHaveLength(1);
  });

  it("the keys are prevented on an editable block (the host gets none) and ignored without Alt or with Edit dates off", async () => {
    const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true, altKey: true });
    block().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await ws.idle();
    const plain = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    block().dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
  });
});

describe("tasks and Date values stay read-only", () => {
  it("a task block is locked while editing and cannot be dragged", async () => {
    ws.stop();
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.append(root);
    graph = fakeGraph();
    ws = createWorkspace(root, { dq: graph.dq, views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode, zone: () => -300, today: () => TODAY, time: () => "13:30",
      kanban: graph.writes, dates: graph.dates, weekStart: async () => 0 });
    await ws.open();
    await click(`[data-tag-id="${tag("Project").id}"]`);
    await click("[data-view-kind=calendar]");
    await click("[data-cal-layout=3days]");
    await click("[data-cal-nav=next]");
    await click("[data-cal-edit]");
    const task = $("[data-cg-block=deadline]")!;
    expect(task.hasAttribute("data-cg-locked")).toBe(true);
    expect(task.hasAttribute("data-cg-editable")).toBe(false);
    ptr(task, "pointerdown", 100, 200);
    ptr(task, "pointermove", 100, 400);
    ptr(task, "pointerup", 100, 400);
    await ws.idle();
    expect(writes()).toEqual([]);
  });
});
