// @vitest-environment happy-dom
// N68: dragging an Agenda entry onto a day or a period gives it that date. Its own file: workspace.test.ts is near a
// worker's heap limit (N24). #Project (fixtures), Agenda by date, today Sat 3 Oct 2026, weeks start Sunday (UTC-5):
// Overdue: Acme contract (task, due 2 Oct); Today: Website relaunch, Acme rollout; Mon 5 Oct: Draft brief (task, due
// 17:00); Thu 8 Oct: Mobile app (node, Start only); Fri 9 Oct: Wireframes (task, scheduled 09:00); No date: Archive cleanup.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage } from "./test-fakes";

const TODAY = "2026-10-03";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const BRIEF = "6a000000-0000-4000-8000-000000000021";
const WIREFRAMES = "6a000000-0000-4000-8000-000000000024";
const CONTRACT = "6a000000-0000-4000-8000-000000000025";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let graph: ReturnType<typeof fakeGraph>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const writeCalls = () => graph.calls.filter(([name]) => name !== "readDate" && name !== "readChoice");
const bucketOf = (uuid: string) => $(`[data-ag-open="${uuid}"]`)?.dataset.bucket ?? null;

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await ws.idle();
}

const ev = (type: string) => new Event(type, { bubbles: true, cancelable: true });
async function drag(uuid: string, target: string) {
  const from = $(`[data-ag-open="${uuid}"]`)!;
  from.dispatchEvent(ev("dragstart"));
  const to = $(target)!;
  to.dispatchEvent(ev("dragover"));
  to.dispatchEvent(ev("drop"));
  from.dispatchEvent(ev("dragend"));
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
  await click("[data-view-kind=agenda]");
  await click("[data-ag-group-by=date]");
});
afterEach(() => ws.stop());

describe("Agenda: drag an entry to give it a date", () => {
  it("entries drag (their list item: Chromium starts no drag from a button); while one does, a strip offers the periods with days left and No date", () => {
    expect($(`[data-ag-open="${BRIEF}"]`)!.hasAttribute("draggable")).toBe(false);
    expect($(`[data-ag-open="${BRIEF}"]`)!.closest("li")!.getAttribute("draggable")).toBe("true");
    expect($(`[data-ag-open="${BRIEF}"]`)!.closest("li")!.dataset.agDrag).toBe(BRIEF);
    expect($$("[data-ag-dropbar] [data-ag-drop]").map((b) => b.textContent)).toEqual(["Today", "Tomorrow", "Next week", "This month", "This quarter", "No date"]);
    expect($("[data-agenda]")!.hasAttribute("data-ag-dragging")).toBe(false);
    $(`[data-ag-open="${BRIEF}"]`)!.dispatchEvent(ev("dragstart"));
    expect($("[data-agenda]")!.hasAttribute("data-ag-dragging")).toBe(true);
    $(`[data-ag-open="${BRIEF}"]`)!.dispatchEvent(ev("dragend"));
    expect($("[data-agenda]")!.hasAttribute("data-ag-dragging")).toBe(false);
  });

  it("a task dropped on Tomorrow gets its Deadline moved there, time kept", async () => {
    await drag(BRIEF, `[data-ag-dropbar] [data-ag-drop="tomorrow"]`);
    expect(writeCalls()).toEqual([["upsertBlockProperty", BRIEF, "logseq.property/deadline", Date.UTC(2026, 9, 4, 22)]]);
    expect(bucketOf(BRIEF)).toBe("2026-10-04");
  });

  it("a node dropped on a day heading gets that day (its one date moves)", async () => {
    await drag(MOBILE, `[data-ag-bucket="2026-10-09"]`);
    const start = tag("Project").dateProps.find((p) => p.title === "Start")!.ident.slice(1);
    expect(writeCalls()).toEqual([["createJournalPage", "2026-10-09T12:00:00"], ["upsertBlockProperty", MOBILE, start, expect.any(Number)]]);
    expect(bucketOf(MOBILE)).toBe("2026-10-09");
  });

  it("No date removes a task's date; Overdue takes no drop", async () => {
    await drag(WIREFRAMES, `[data-ag-bucket="overdue"]`);
    expect(writeCalls()).toEqual([]);
    await drag(WIREFRAMES, `[data-ag-dropbar] [data-ag-drop="none"]`);
    expect(writeCalls()).toEqual([["removeBlockProperty", WIREFRAMES, "logseq.property/scheduled"]]);
  });

  it("an overdue task moved to Today is no longer late", async () => {
    await drag(CONTRACT, `[data-ag-dropbar] [data-ag-drop="today"]`);
    expect(bucketOf(CONTRACT)).toBe("today");
  });
});
