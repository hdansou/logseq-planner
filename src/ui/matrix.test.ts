// @vitest-environment happy-dom
// N64: the Matrix view in the workspace. Its own file: workspace.test.ts is near a worker's heap limit (N24).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage } from "./test-fakes";
import matrixCss from "./matrix.css?inline";

const TODAY = "2026-10-03";
const SITE = "6a000000-0000-4000-8000-000000000001";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const ACME = "6a000000-0000-4000-8000-000000000003";
const ARCHIVE = "6a000000-0000-4000-8000-000000000004";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let graph: ReturnType<typeof fakeGraph>;
let openNode: ReturnType<typeof vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const prop = (title: string) => tag("Project").choiceProps.find((p) => p.title === title)!;
const val = (p: string, title: string) => prop(p).values.find((v) => v.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const config = () => ws.config() as Extract<ReturnType<Workspace["config"]> & object, { kind: "matrix" }>;

async function click(sel: string, init: MouseEventInit = {}) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
  await ws.idle();
}

/** Opens #Project in the Matrix with Owner across and Status down (Backlog, Todo, Doing first; Alice first). */
async function setup() {
  tags = await loadTagInfos(fakeGraph().dq);
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  graph = fakeGraph();
  openNode = vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>();
  ws = createWorkspace(root, {
    dq: graph.dq, views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode, zone: () => -300, today: () => TODAY, weekStart: async () => 0,
    kanban: graph.writes, dates: graph.dates,
  });
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`);
  await click("[data-view-kind=matrix]");
  await click("[data-control=mx-x]");
  await click(`[data-popover=mx-x] [data-option="${prop("Owner").ident}"]`);
  await click("[data-control=mx-y]");
  await click(`[data-popover=mx-y] [data-option="${prop("Status").ident}"]`);
}

const cell = (x: string, y: string) => $(`[data-mx-cell][data-mx-x="${x}"][data-mx-y="${y}"]`)!;
const cardsIn = (x: string, y: string) => [...cell(x, y).querySelectorAll<HTMLElement>("[data-mx-card]")].map((c) => c.dataset.mxCard);
const unplaced = () => cardsIn("none", "none");
const writeCalls = () => graph.calls.filter(([name]) => name !== "readChoice");

function drag(from: HTMLElement, to: HTMLElement) {
  const ev = (type: string) => new Event(type, { bubbles: true, cancelable: true });
  from.dispatchEvent(ev("dragstart"));
  to.dispatchEvent(ev("dragover"));
  to.dispatchEvent(ev("drop"));
  from.dispatchEvent(ev("dragend"));
}

beforeEach(() => setup());
afterEach(() => ws.stop());

describe("Matrix view", () => {
  it("is a fifth tab, named", () => {
    const tab = $("[data-view-kind=matrix]")!;
    expect(tab.getAttribute("aria-label")).toBe("Matrix");
    expect(tab.getAttribute("aria-pressed")).toBe("true");
    expect(tab.querySelector("svg")).not.toBeNull();
  });

  it("the axes chosen in the toolbar are saved with the view", () => {
    expect(config()).toMatchObject({ kind: "matrix", mode: "quadrants", x: { prop: prop("Owner").ident }, y: { prop: prop("Status").ident } });
    expect(text("[data-control=mx-x]")).toContain("Owner");
    expect(text("[data-control=mx-y]")).toContain("Status");
  });

  it("four quadrants, each card in the quadrant of its two values; a card without a value on either axis is unplaced, below", () => {
    expect($$("[data-matrix] [data-mx-cell]")).toHaveLength(4);
    expect(cardsIn("first", "first")).toEqual([SITE]); // Alice / Doing
    expect(cardsIn("second", "first")).toEqual([MOBILE]); // Bob / Todo
    expect(cardsIn("first", "second")).toEqual([ACME]); // Alice / In Review
    expect(unplaced()).toEqual([ARCHIVE]); // no Owner
    expect($("[data-matrix] + [data-mx-unplaced]")).not.toBeNull();
    // No "a" before a property name: "a Impact" reads wrong.
    expect(text("[data-mx-unplaced] .pl-hint")).toBe("Without a value for Owner or Status, by due date. Drag a card into the grid, or use its ⋯ menu.");
  });

  it("each quadrant shows its label and count; the axis heads name the values of each band", () => {
    expect(text(`[data-mx-cell][data-mx-x="first"][data-mx-y="first"] .pl-mx-label`)).toBe("Backlog, Todo, Doing · Alice");
    expect(text(`[data-mx-cell][data-mx-x="first"][data-mx-y="first"] .pl-mx-count`)).toBe("1");
    expect(text(`[data-mx-xhead="first"]`)).toBe("Alice");
    expect(text(`[data-mx-yhead="second"]`)).toBe("In Review, Done, Canceled");
  });

  it("a click on a card opens its node; Shift+click in the sidebar", async () => {
    await click(`[data-mx-open="${SITE}"]`);
    expect(openNode).toHaveBeenLastCalledWith(SITE, { sidebar: false });
    await click(`[data-mx-open="${SITE}"]`, { shiftKey: true });
    expect(openNode).toHaveBeenLastCalledWith(SITE, { sidebar: true });
  });
});

describe("moves", () => {
  it("dragging a card to another quadrant writes the band's first value on each axis that changes, read back", async () => {
    drag($(`[data-mx-card="${SITE}"]`)!, cell("second", "second"));
    await ws.idle();
    expect(writeCalls()).toEqual([
      ["upsertBlockProperty", SITE, prop("Owner").ident.slice(1), val("Owner", "Bob").id],
      ["upsertBlockProperty", SITE, prop("Status").ident.slice(1), val("Status", "In Review").id],
    ]);
    expect(cardsIn("second", "second")).toContain(SITE);
  });

  it("the ⋯ menu lists the quadrants and Unplaced; picking one moves the card", async () => {
    await click(`[data-mx-move="${MOBILE}"]`);
    const targets = $$("[data-popover=mx-move] [data-mx-to-x]").map((b) => b.textContent);
    expect(targets).toEqual(["Backlog, Todo, Doing · Alice", "Backlog, Todo, Doing · Bob", "In Review, Done, Canceled · Alice", "In Review, Done, Canceled · Bob", "Unplaced"]);
    await click(`[data-popover=mx-move] [data-mx-to-x="first"][data-mx-to-y="first"]`);
    expect(writeCalls()).toEqual([["upsertBlockProperty", MOBILE, prop("Owner").ident.slice(1), val("Owner", "Alice").id]]);
    expect(cardsIn("first", "first").sort()).toEqual([SITE, MOBILE].sort());
  });

  it("dropping on Unplaced removes the card's values", async () => {
    drag($(`[data-mx-card="${MOBILE}"]`)!, $("[data-mx-unplaced]")!);
    await ws.idle();
    expect(writeCalls()).toEqual([
      ["removeBlockProperty", MOBILE, prop("Owner").ident.slice(1)],
      ["removeBlockProperty", MOBILE, prop("Status").ident.slice(1)],
    ]);
  });
});

describe("toolbar", () => {
  it("Every value: a column per Owner value and a row per Status value, no quadrant labels", async () => {
    await click("[data-mx-mode=values]");
    expect(config().mode).toBe("values");
    expect($$("[data-mx-xhead]").map((h) => h.textContent)).toEqual(["Alice", "Bob"]);
    expect($$("[data-mx-yhead]").map((h) => h.textContent)).toEqual(prop("Status").values.map((v) => v.title));
    expect($$("[data-matrix] [data-mx-cell]")).toHaveLength(2 * prop("Status").values.length);
    expect(cardsIn(val("Owner", "Alice").uuid, val("Status", "Doing").uuid)).toEqual([SITE]);
    expect($$("[data-matrix] .pl-mx-label")).toHaveLength(0);
  });

  it("Bands: Reverse flips an axis and − / + move its split; both are saved", async () => {
    await click("[data-control=mx-bands]");
    await click(`[data-mx-split="y:-1"]`);
    expect(config().y!.first).toEqual(["Backlog", "Todo"].map((t) => val("Status", t).uuid));
    await click(`[data-mx-split="y:1"]`);
    expect(config().y!.first).toHaveLength(3);
    const reverse = $<HTMLInputElement>(`[data-mx-reverse="y"]`)!;
    reverse.checked = true;
    reverse.dispatchEvent(new Event("change", { bubbles: true }));
    await ws.idle();
    expect(config().y).toMatchObject({ reverse: true, first: ["Canceled", "Done", "In Review"].map((t) => val("Status", t).uuid) });
    expect(text(`[data-mx-yhead="first"]`)).toBe("Canceled, Done, In Review");
  });

  it("Labels: a quadrant takes the name typed for it; an empty one goes back to the default", async () => {
    await click("[data-control=mx-labels]");
    const input = $<HTMLInputElement>(`[data-mx-label="0"]`)!;
    expect(input.placeholder).toBe("Backlog, Todo, Doing · Alice");
    input.value = "Do first";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await ws.idle();
    expect(config().labels).toEqual(["Do first", "", "", ""]);
    expect(text(`[data-mx-cell][data-mx-x="first"][data-mx-y="first"] .pl-mx-label`)).toBe("Do first");
  });

  it("Show done adds the done cards; off, the hint counts them", async () => {
    await click(`[data-mx-move="${SITE}"]`);
    await click(`[data-popover=mx-move] [data-mx-to-x="first"][data-mx-to-y="second"]`); // Doing → In Review: not done yet
    expect(text("[data-mx-done-hidden]")).toBeNull();
    expect($("[data-mx-show-done]")!.getAttribute("aria-pressed")).toBe("false");
    await click("[data-mx-show-done]");
    expect(config().showDone).toBe(true);
  });
});

describe("empty state", () => {
  it("a tag with fewer than two choice properties says what the Matrix needs", async () => {
    await click(`[data-tag-id="${tag("Page").id}"]`);
    expect(config()).toMatchObject({ kind: "matrix", x: null, y: null });
    expect($("[data-empty=no-axes]")).not.toBeNull();
  });
});

describe("matrix.css", () => {
  it("one grid: an axis column, then a column per band across; a narrow frame stacks the cells", () => {
    expect(matrixCss).toMatch(/\.pl-mx\s*{[^}]*grid-template-columns:[^}]*var\(--pl-mx-cols\)/);
    expect(matrixCss).toMatch(/@container[^{]*max-width:\s*639px[^{]*{[\s\S]*\.pl-mx[^{]*{[^}]*grid-template-columns:\s*1fr/);
  });
});
