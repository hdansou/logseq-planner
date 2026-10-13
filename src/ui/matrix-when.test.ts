// @vitest-environment happy-dom
// N70: When as a Matrix axis in the workspace. Its own file: workspace.test.ts is near a worker's heap limit (N24).
// #Project (fixtures): Website relaunch 23 Sep – 23 Oct (This month), Mobile app Start 8 Oct (Next week), Acme rollout
// 30 Sep – 8 Oct (Next week), Archive cleanup no dates. Today Sat 3 Oct 2026, weeks start Sunday, UTC-5: the first
// When band is Overdue – Tomorrow (writes 4 Oct), the second Next week – Later (writes 31 Dec, the quarter's end).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { WHEN_KEY } from "../core/when";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage } from "./test-fakes";

const TODAY = "2026-10-03";
const SITE = "6a000000-0000-4000-8000-000000000001";
const ACME = "6a000000-0000-4000-8000-000000000003";
const ARCHIVE = "6a000000-0000-4000-8000-000000000004";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let graph: ReturnType<typeof fakeGraph>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const key = (title: string) => tag("Project").dateProps.find((p) => p.title === title)!.ident.slice(1);
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const config = () => ws.config() as Extract<ReturnType<Workspace["config"]> & object, { kind: "matrix" }>;
const writeCalls = () => graph.calls.filter(([name]) => name !== "readDate" && name !== "readChoice");

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
  await click("[data-view-kind=matrix]");
});
afterEach(() => ws.stop());

const cellOf = (uuid: string) => $(`[data-mx-card="${uuid}"]`)!.closest<HTMLElement>("[data-mx-cell]")!;
async function drag(uuid: string, x: string, y: string) {
  const ev = (type: string) => new Event(type, { bubbles: true, cancelable: true });
  const from = $(`[data-mx-card="${uuid}"]`)!;
  const to = $(`[data-mx-cell][data-mx-x="${x}"][data-mx-y="${y}"]`)!;
  from.dispatchEvent(ev("dragstart"));
  to.dispatchEvent(ev("dragover"));
  to.dispatchEvent(ev("drop"));
  from.dispatchEvent(ev("dragend"));
  await ws.idle();
}

describe("Matrix: When as an axis", () => {
  it("a new Matrix of a tag with dates has When across, split after this week; the Across menu offers When first", async () => {
    expect(config().x).toEqual({ prop: WHEN_KEY, reverse: false, first: ["overdue", "today", "tomorrow", "week"] });
    expect(text("[data-control=mx-x]")).toContain("When");
    expect($$("[data-mx-xhead]").map((h) => h.textContent)).toEqual(["Overdue – Tomorrow", "Next week – Later"]);
    expect(cellOf(SITE).dataset.mxX).toBe("second");
    expect(cellOf(ARCHIVE).hasAttribute("data-mx-unplaced")).toBe(true);
    expect(text("[data-mx-unplaced] .pl-hint")).toMatch(/^Without a date or a value for /);
    await click("[data-control=mx-x]");
    expect($$("[data-popover=mx-x] [data-option]")[0].dataset.option).toBe(WHEN_KEY);
  });

  it("a card dragged to the first band gets that band's last day (4 Oct), its span keeping its length", async () => {
    const y = cellOf(ACME).dataset.mxY!;
    await drag(ACME, "first", y); // End 8 Oct → 4 Oct, Start 30 Sep → 26 Sep
    expect(writeCalls().map((c) => (c[0] === "createJournalPage" ? c[1] : c[2]))).toEqual(["2026-10-04T12:00:00", key("End"), "2026-09-26T12:00:00", key("Start")]);
    expect(cellOf(ACME).dataset.mxX).toBe("first");
  });

  it("an undated card dragged into the grid gets an End and the other axis's value in one move", async () => {
    const y = cellOf(SITE).dataset.mxY!;
    await drag(ARCHIVE, "second", y);
    const calls = writeCalls();
    expect(calls.slice(0, 2)).toEqual([["createJournalPage", "2026-12-31T12:00:00"], ["upsertBlockProperty", ARCHIVE, key("End"), expect.any(Number)]]);
    expect(cellOf(ARCHIVE).dataset.mxX).toBe("second");
    expect(cellOf(ARCHIVE).dataset.mxY).toBe(y); // the Down property's value, when it had none in that band
  });

  it("to Unplaced removes the dates and the other value", async () => {
    await drag(SITE, "none", "none");
    expect(writeCalls().filter((c) => c[0] === "removeBlockProperty").map((c) => c[2])).toEqual(expect.arrayContaining([key("End"), key("Start")]));
  });
});
