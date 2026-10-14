// @vitest-environment happy-dom
// N69: dragging a Calendar item onto a day gives it that day; the No date tray takes undated items out and dated ones
// in. Its own file: workspace.test.ts is near a worker's heap limit (N24). #Project (fixtures), today Sat 3 Oct 2026,
// weeks start Sunday (UTC-5): Website relaunch 23 Sep – 23 Oct (band), Mobile app Start 8 Oct (a point chip), Acme
// rollout 30 Sep – 8 Oct (band), Archive cleanup no dates (the tray); Draft brief (task) due 5 Oct 17:00 (a chip).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage } from "./test-fakes";

const TODAY = "2026-10-03";
const SITE = "6a000000-0000-4000-8000-000000000001";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const ARCHIVE = "6a000000-0000-4000-8000-000000000004";
const DRAFT = "6a000000-0000-4000-8000-000000000021";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let graph: ReturnType<typeof fakeGraph>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const key = (title: string) => tag("Project").dateProps.find((p) => p.title === title)!.ident.slice(1);
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const writeCalls = () => graph.calls.filter(([name]) => name !== "readDate" && name !== "readChoice");

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await ws.idle();
}

const ev = (type: string, init: MouseEventInit = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
/** Drags the draggable holding `uuid`'s item (`from` narrows which) onto `target`. */
async function drag(from: string, target: string, init: MouseEventInit = {}) {
  const el = $(from)!.closest<HTMLElement>("[data-cal-drag]")!;
  el.dispatchEvent(ev("dragstart", init));
  const to = $(target)!;
  to.dispatchEvent(ev("dragover"));
  to.dispatchEvent(ev("drop"));
  el.dispatchEvent(ev("dragend"));
  await ws.idle();
}

beforeEach(async () => {
  tags = await loadTagInfos(fakeGraph().dq);
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  graph = fakeGraph();
  ws = createWorkspace(root, {
    dq: graph.dq, views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode: vi.fn(), zone: () => -300, today: () => TODAY, weekStart: async () => 0,
    kanban: graph.writes, dates: graph.dates,
  });
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`);
  await click("[data-view-kind=calendar]");
});
afterEach(() => ws.stop());

describe("Calendar Month: drag an item onto a day", () => {
  it("bands and chips drag by a holder around their button (Chromium starts no drag from a button); days take drops", () => {
    const chip = $(`[data-cal-chip][data-cal-open="${DRAFT}"]`)!;
    expect(chip.hasAttribute("draggable")).toBe(false);
    const holder = chip.closest<HTMLElement>("[data-cal-drag]")!;
    expect(holder.getAttribute("draggable")).toBe("true");
    expect(holder.dataset.calDrag).toBe(DRAFT);
    expect(holder.dataset.calGrab).toBe("2026-10-05");
    expect($(`[data-cal-band][data-cal-open="${SITE}"]`)!.closest("[data-cal-drag]")!.getAttribute("draggable")).toBe("true");
    expect($$("[data-cal-week] [data-cal-drop]").length).toBe(35);
    expect($(`[data-cal-day="2026-10-07"]`)!.dataset.calDrop).toBe("2026-10-07");
  });

  it("while an item drags, the calendar is marked a tick later (bands and chips then let the pointer through to the days)", async () => {
    const holder = $(`[data-cal-chip][data-cal-open="${DRAFT}"]`)!.closest<HTMLElement>("[data-cal-drag]")!;
    holder.dispatchEvent(ev("dragstart"));
    expect($("[data-calendar]")!.hasAttribute("data-cal-dragging")).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect($("[data-calendar]")!.hasAttribute("data-cal-dragging")).toBe(true);
    holder.dispatchEvent(ev("dragend"));
    expect($("[data-calendar]")!.hasAttribute("data-cal-dragging")).toBe(false);
  });

  it("a task's deadline chip dropped on another day gets that day, time kept", async () => {
    await drag(`[data-cal-chip][data-cal-open="${DRAFT}"]`, `[data-cal-day="2026-10-07"]`);
    expect(writeCalls()).toEqual([["upsertBlockProperty", DRAFT, "logseq.property/deadline", Date.UTC(2026, 9, 7, 22)]]);
    expect($(`[data-cal-chip][data-cal-open="${DRAFT}"]`)!.closest("[data-cal-drag]")!.getAttribute("data-cal-grab")).toBe("2026-10-07");
  });

  it("a band keeps the day under the pointer: grabbed on 1 Oct and dropped on 2 Oct, both its dates move one day", async () => {
    const week = $(`[data-cal-week="2026-09-27"]`)!;
    week.querySelectorAll<HTMLElement>("[data-cal-drop]").forEach((cell, i) => {
      cell.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, top: 0, bottom: 100, width: 100, height: 100, x: i * 100, y: 0, toJSON: () => ({}) });
    });
    await drag(`[data-cal-week="2026-09-27"] [data-cal-band][data-cal-open="${SITE}"]`, `[data-cal-day="2026-10-02"]`, { clientX: 450 }); // column 5 = Thu 1 Oct
    expect(writeCalls()).toEqual([
      ["createJournalPage", "2026-10-24T12:00:00"], ["upsertBlockProperty", SITE, key("End"), expect.any(Number)],
      ["createJournalPage", "2026-09-24T12:00:00"], ["upsertBlockProperty", SITE, key("Start"), expect.any(Number)],
    ]);
  });

  it("the same day writes nothing", async () => {
    await drag(`[data-cal-chip][data-cal-open="${MOBILE}"]`, `[data-cal-day="2026-10-08"]`);
    expect(writeCalls()).toEqual([]);
  });
});

describe("the No date tray", () => {
  it("lists the undated items, each draggable; it takes drops", () => {
    const tray = $("[data-cal-tray]")!;
    expect(tray.dataset.calDrop).toBe("none");
    expect(tray.querySelector(".pl-cal-tray-head")!.textContent).toContain("No date");
    const item = tray.querySelector<HTMLElement>(`[data-cal-open="${ARCHIVE}"]`)!;
    expect(item.textContent).toBe("Archive cleanup");
    expect(item.closest("[data-cal-drag]")!.getAttribute("draggable")).toBe("true");
  });

  it("an undated node dropped on a day gets its End there", async () => {
    await drag(`[data-cal-tray] [data-cal-open="${ARCHIVE}"]`, `[data-cal-day="2026-10-06"]`);
    expect(writeCalls()).toEqual([["createJournalPage", "2026-10-06T12:00:00"], ["upsertBlockProperty", ARCHIVE, key("End"), expect.any(Number)]]);
    expect($(`[data-cal-tray] [data-cal-open="${ARCHIVE}"]`)).toBeNull();
    expect($(`[data-cal-chip][data-cal-open="${ARCHIVE}"]`)).not.toBeNull();
  });

  it("a dated item dropped on the tray loses its dates", async () => {
    await drag(`[data-cal-chip][data-cal-open="${MOBILE}"]`, "[data-cal-tray]");
    expect(writeCalls()).toEqual([["removeBlockProperty", MOBILE, key("Start")]]);
  });

  it("time grids: an undated node dropped on a day's head or its all-day cell gets that day", async () => {
    await click("[data-cal-layout=week]");
    expect($$("[data-cg-allday] [data-cal-drop]").map((c) => c.dataset.calDrop)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    await drag(`[data-cal-tray] [data-cal-open="${ARCHIVE}"]`, `[data-cg-day="2026-10-01"]`);
    expect(writeCalls()).toEqual([["createJournalPage", "2026-10-01T12:00:00"], ["upsertBlockProperty", ARCHIVE, key("End"), expect.any(Number)]]);
  });
});

describe("calendar.css (N69)", () => {
  it("while dragging, items let the pointer through to the day under them", async () => {
    const css = (await import("./calendar.css?inline")).default as string;
    expect(css).toMatch(/\[data-cal-dragging\][^{]*\[data-cal-drag\][^{]*{[^}]*pointer-events:\s*none/);
  });
});
