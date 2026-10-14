// @vitest-environment happy-dom
// N67: Kanban columns by When in the workspace. Its own file: workspace.test.ts is near a worker's heap limit (N24).
// #Project (fixtures): Website relaunch 23 Sep – 23 Oct, Mobile app Start 8 Oct only, Acme rollout 30 Sep – 8 Oct,
// Archive cleanup no dates. Today Sat 3 Oct 2026, weeks start Sunday: This week has no day left after Tomorrow.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { WHEN_KEY } from "../core/when";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage } from "./test-fakes";

const TODAY = "2026-10-03";
const SITE = "6a000000-0000-4000-8000-000000000001";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const ACME = "6a000000-0000-4000-8000-000000000003";
const ARCHIVE = "6a000000-0000-4000-8000-000000000004";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let graph: ReturnType<typeof fakeGraph>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const dateProp = (title: string) => tag("Project").dateProps.find((p) => p.title === title)!;
const key = (title: string) => dateProp(title).ident.slice(1);
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await ws.idle();
}

async function setup() {
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
  await click("[data-view-kind=kanban]");
  await click("[data-control=kb-column]");
  await click(`[data-popover=kb-column] [data-option="${WHEN_KEY}"]`);
}

const cell = (col: string) => $(`[data-kb-cell][data-kb-col="${col}"]`)!;
const cardsIn = (col: string) => [...cell(col).querySelectorAll<HTMLElement>("[data-kb-card]")].map((c) => c.dataset.kbCard);
const writeCalls = () => graph.calls.filter(([name]) => name !== "readDate" && name !== "readChoice");

async function drag(uuid: string, col: string) {
  const ev = (type: string) => new Event(type, { bubbles: true, cancelable: true });
  const from = $(`[data-kb-card="${uuid}"]`)!;
  from.dispatchEvent(ev("dragstart"));
  cell(col).dispatchEvent(ev("dragover"));
  cell(col).dispatchEvent(ev("drop"));
  from.dispatchEvent(ev("dragend"));
  await ws.idle();
}

beforeEach(() => setup());
afterEach(() => ws.stop());

describe("Kanban columns by When", () => {
  it("the Columns menu offers When; columns are the periods with days left, then No date", () => {
    expect(text("[data-control=kb-column]")).toContain("When");
    expect($$("[data-kb-column]").map((h) => h.querySelector(".pl-kb-head-title")!.textContent))
      .toEqual(["Overdue", "Today", "Tomorrow", "Next week", "This month", "This quarter", "Later", "No date"]);
  });

  it("each card sits in the period of its end, a one-date node by that date", () => {
    expect(cardsIn("next").sort()).toEqual([ACME, MOBILE].sort());
    expect(cardsIn("month")).toEqual([SITE]);
    expect(cardsIn("none")).toEqual([ARCHIVE]);
  });

  it("dragging an undated card to Today gives it an End of today", async () => {
    await drag(ARCHIVE, "today");
    expect(writeCalls()).toEqual([["createJournalPage", "2026-10-03T12:00:00"], ["upsertBlockProperty", ARCHIVE, key("End"), expect.any(Number)]]);
    expect(cardsIn("today")).toEqual([ARCHIVE]);
  });

  it("a Start–End span keeps its length: End on the last day of the period, Start by the same days", async () => {
    await drag(SITE, "tomorrow"); // End 23 Oct → 4 Oct (19 days earlier), Start 23 Sep → 4 Sep
    expect(writeCalls().map((c) => c[0] === "createJournalPage" ? c[1] : c[2])).toEqual(["2026-10-04T12:00:00", key("End"), "2026-09-04T12:00:00", key("Start")]);
    expect(cardsIn("tomorrow")).toEqual([SITE]);
  });

  it("No date removes the dates; Overdue takes no drop and writes nothing", async () => {
    await drag(MOBILE, "overdue");
    expect(writeCalls()).toEqual([]);
    expect($(`[data-kb-cell][data-kb-col="overdue"]`)!.hasAttribute("data-kb-no-drop")).toBe(true);
    await drag(MOBILE, "none");
    expect(writeCalls()).toEqual([["removeBlockProperty", MOBILE, key("Start")]]);
    // Mobile app has dated tasks: without its own date its span comes from them (the Timeline's rule), so it stays in
    // Next week; it can still move, and gets a date of its own.
    expect(cardsIn("next")).toContain(MOBILE);
    await drag(MOBILE, "month");
    expect(writeCalls().slice(1)).toEqual([["createJournalPage", "2026-10-31T12:00:00"], ["upsertBlockProperty", MOBILE, key("End"), expect.any(Number)]]);
    expect(cardsIn("month").sort()).toEqual([MOBILE, SITE].sort());
  });

  it("the ⋯ menu lists the periods a card can go to (no Overdue or Later) and moves it", async () => {
    await click(`[data-kb-move="${ARCHIVE}"]`);
    expect($$("[data-popover=kb-move] [data-kb-to-col]").map((b) => b.textContent)).toEqual(["Today", "Tomorrow", "Next week", "This month", "This quarter", "No date"]);
    await click(`[data-popover=kb-move] [data-kb-to-col="month"]`);
    expect(cardsIn("month").sort()).toEqual([ARCHIVE, SITE].sort());
  });
});
