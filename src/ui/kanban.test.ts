// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage, fixtureDq } from "./test-fakes";
import kanbanCss from "./kanban.css?inline";

const TODAY = "2026-10-03";
const SITE = "6a000000-0000-4000-8000-000000000001";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const ACME = "6a000000-0000-4000-8000-000000000003";
const ARCHIVE = "6a000000-0000-4000-8000-000000000004";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let graph: ReturnType<typeof fakeGraph>;
let store: ReturnType<typeof createViewStore>;
let openNode: ReturnType<typeof vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const prop = (title: string) => tag("Project").choiceProps.find((p) => p.title === title)!;
const val = (p: string, title: string) => prop(p).values.find((v) => v.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;

async function click(sel: string, init: MouseEventInit = {}) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
  await ws.idle();
}

/** Opens the Planner on #Project in the Kanban, over a fake graph the board can write to. */
async function setup() {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  graph = fakeGraph();
  openNode = vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>();
  store = createViewStore(fakeStorage());
  ws = createWorkspace(root, {
    dq: graph.dq, views: store, onClose: vi.fn(), openNode, zone: () => -300, today: () => TODAY, weekStart: async () => 0, kanban: graph.writes,
  });
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`);
  await click("[data-view-kind=kanban]");
}

const cell = (col: string, lane?: string) => $(`[data-kb-cell][data-kb-col="${col}"]${lane === undefined ? "" : `[data-kb-lane="${lane}"]`}`)!;
const cardsIn = (col: string, lane?: string) => [...cell(col, lane).querySelectorAll<HTMLElement>("[data-kb-card]")].map((c) => c.dataset.kbCard);
const card = (uuid: string) => $(`[data-kb-card="${uuid}"]`)!;
const cellOf = (uuid: string) => card(uuid).closest<HTMLElement>("[data-kb-cell]")!;

/** A real drag sequence: dragstart on the card, dragover and drop on the target cell, dragend on the card. */
function drag(from: HTMLElement, to: HTMLElement) {
  const ev = (type: string) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    return e;
  };
  const start = ev("dragstart");
  from.dispatchEvent(start);
  const over = ev("dragover");
  to.dispatchEvent(over);
  const drop = ev("drop");
  to.dispatchEvent(drop);
  from.dispatchEvent(ev("dragend"));
  return { start, over, drop };
}
const writeCalls = () => graph.calls.filter(([name]) => name !== "readChoice");

beforeEach(() => setup());

describe("board", () => {
  it("columns = Status values in order + No Status, with counts; done columns marked", () => {
    const heads = $$("[data-kb-column]");
    expect(heads.map((h) => h.querySelector(".pl-kb-head-title")!.textContent)).toEqual(["Backlog", "Todo", "Doing", "In Review", "Done", "Canceled", "No Status"]);
    expect(heads.map((h) => h.dataset.kbColumn)).toEqual([...prop("Status").values.map((v) => v.uuid), "none"]);
    expect(heads.map((h) => h.querySelector("[data-kb-count]")!.textContent)).toEqual(["1", "1", "1", "1", "0", "0", "0"]);
    expect(heads.filter((h) => h.hasAttribute("data-done")).map((h) => h.querySelector(".pl-kb-head-title")!.textContent)).toEqual(["Done", "Canceled"]);
    expect($("[data-kanban]")!.dataset.kbProp).toBe(prop("Status").ident);
    expect($$("[data-kb-lane-head]")).toHaveLength(0);
  });

  it("cards sit in the column of their value; each card is a button that names it", () => {
    expect(cardsIn(val("Status", "Doing").uuid)).toEqual([SITE]);
    expect(cardsIn(val("Status", "Todo").uuid)).toEqual([MOBILE]);
    expect(cardsIn(val("Status", "In Review").uuid)).toEqual([ACME]);
    expect(cardsIn(val("Status", "Backlog").uuid)).toEqual([ARCHIVE]);
    expect(cardsIn("none")).toEqual([]);
    const open = $(`[data-kb-open="${SITE}"]`)!;
    expect(open.tagName).toBe("BUTTON");
    expect(open.getAttribute("aria-label")).toBe("Website relaunch, ends 23 Oct, 1 of 2 tasks done, Alice");
    expect(text(`[data-kb-card="${SITE}"] .pl-kb-title`)).toBe("Website relaunch");
    expect(text(`[data-kb-card="${SITE}"] .pl-kb-when`)).toBe("ends 23 Oct");
    expect(card(SITE).getAttribute("draggable")).toBe("true");
  });

  it("swimlanes by Owner: a lane per value + No Owner, each with every column", async () => {
    await click("[data-control=kb-lane]");
    await click(`[data-popover=kb-lane] [data-option="${prop("Owner").ident}"]`);
    expect(ws.config()).toMatchObject({ kind: "kanban", laneProp: prop("Owner").ident });
    expect($$("[data-kb-lane-head]").map((l) => l.dataset.kbLaneHead)).toEqual([val("Owner", "Alice").uuid, val("Owner", "Bob").uuid, "none"]);
    expect($$("[data-kb-lane-head]").map((l) => text(`[data-kb-lane-head="${l.dataset.kbLaneHead}"] .pl-kb-lane-title`))).toEqual(["Alice", "Bob", "No Owner"]);
    expect($$("[data-kb-cell]")).toHaveLength(21);
    expect(cardsIn(val("Status", "Doing").uuid, val("Owner", "Alice").uuid)).toEqual([SITE]);
    expect(cardsIn(val("Status", "Todo").uuid, val("Owner", "Bob").uuid)).toEqual([MOBILE]);
    expect(cardsIn(val("Status", "Backlog").uuid, "none")).toEqual([ARCHIVE]);
    // the card no longer repeats the lane value
    expect(text(`[data-kb-card="${SITE}"] .pl-kb-meta`)).not.toContain("Alice");
  });

  it("the column picker lists the choice properties; picking the lane property as column clears the lanes", async () => {
    await click("[data-control=kb-lane]");
    await click(`[data-popover=kb-lane] [data-option="${prop("Owner").ident}"]`);
    await click("[data-control=kb-column]");
    expect($$("[data-popover=kb-column] [data-option]").map((o) => o.textContent)).toEqual(["Status", "Owner"]);
    await click(`[data-popover=kb-column] [data-option="${prop("Owner").ident}"]`);
    expect(ws.config()).toMatchObject({ columnProp: prop("Owner").ident, laneProp: null });
    expect($$("[data-kb-column]").map((h) => h.querySelector(".pl-kb-head-title")!.textContent)).toEqual(["Alice", "Bob", "No Owner"]);
    await click("[data-control=kb-lane]");
    expect($$("[data-popover=kb-lane] [data-option]").map((o) => o.textContent)).toEqual(["None", "Status"]);
  });

  it("sort: Due by default, Title; Priority only when the tag has one; card order follows", async () => {
    expect($$("[data-kb-sort]").map((b) => [b.dataset.kbSort, b.getAttribute("aria-pressed")])).toEqual([["due", "true"], ["title", "false"]]);
    await click("[data-control=kb-column]");
    await click(`[data-popover=kb-column] [data-option="${prop("Owner").ident}"]`);
    drag(card(ARCHIVE), cell(val("Owner", "Alice").uuid)); // undated Archive cleanup joins Alice
    await ws.idle();
    expect(cardsIn(val("Owner", "Alice").uuid)).toEqual([ACME, SITE, ARCHIVE]); // ends 8 Oct, 23 Oct, undated last
    await click("[data-kb-sort=title]");
    expect(ws.config()).toMatchObject({ sort: "title" });
    expect(cardsIn(val("Owner", "Alice").uuid)).toEqual([ACME, ARCHIVE, SITE]);
    expect($("[data-kb-sort=title]")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("click opens the node; Shift+click opens it in the sidebar", async () => {
    await click(`[data-kb-open="${SITE}"]`);
    expect(openNode).toHaveBeenLastCalledWith(SITE, { sidebar: false });
    await click(`[data-kb-open="${ACME}"]`, { shiftKey: true });
    expect(openNode).toHaveBeenLastCalledWith(ACME, { sidebar: true });
  });

  it("column, lane and sort are saved with a view and restored", async () => {
    await click("[data-control=kb-lane]");
    await click(`[data-popover=kb-lane] [data-option="${prop("Owner").ident}"]`);
    await click("[data-kb-sort=title]");
    const create = vi.spyOn(store, "create");
    await click("[data-control=saved-views]");
    await click("[data-action=save-view]");
    expect(create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "kanban", columnProp: prop("Status").ident, laneProp: prop("Owner").ident, sort: "title" }));
    const id = (await store.list())[0].id;
    await click(`[data-tag-id="${tag("Meeting").id}"]`);
    expect(ws.config()).toMatchObject({ laneProp: null, sort: "due" });
    await click("[data-control=saved-views]");
    await click(`[data-view-open="${id}"]`);
    expect(ws.config()).toMatchObject({ kind: "kanban", laneProp: prop("Owner").ident, sort: "title" });
    expect($$("[data-kb-lane-head]")).toHaveLength(3);
  });
});

describe("drag and drop", () => {
  it("same cell: no write", async () => {
    const { over, drop } = drag(card(SITE), cell(val("Status", "Doing").uuid));
    await ws.idle();
    expect(over.defaultPrevented).toBe(true); // the cell accepts the drop
    expect(drop.defaultPrevented).toBe(true);
    expect(writeCalls()).toEqual([]);
    expect(cardsIn(val("Status", "Doing").uuid)).toEqual([SITE]);
  });

  it("cross-column: one write with the full ident and the closed value's entity id, read back, then reloaded", async () => {
    drag(card(SITE), cell(val("Status", "Done").uuid));
    await ws.idle();
    expect(writeCalls()).toEqual([["upsertBlockProperty", SITE, "logseq.property/status", val("Status", "Done").id]]);
    expect(graph.calls).toContainEqual(["readChoice", SITE, ":logseq.property/status"]);
    // reloaded from the graph: the card is in Done, counts updated
    expect(cardsIn(val("Status", "Done").uuid)).toEqual([SITE]);
    expect(text(`[data-kb-column="${val("Status", "Done").uuid}"] [data-kb-count]`)).toBe("1");
    expect(text(`[data-kb-column="${val("Status", "Doing").uuid}"] [data-kb-count]`)).toBe("0");
    expect(card(SITE).hasAttribute("data-done")).toBe(true);
    expect($("[data-region=error]")).toBeNull();
  });

  it("cross-lane and cross-column: two writes (column, then lane)", async () => {
    await click("[data-control=kb-lane]");
    await click(`[data-popover=kb-lane] [data-option="${prop("Owner").ident}"]`);
    drag(card(MOBILE), cell(val("Status", "Doing").uuid, val("Owner", "Alice").uuid));
    await ws.idle();
    expect(writeCalls()).toEqual([
      ["upsertBlockProperty", MOBILE, "logseq.property/status", val("Status", "Doing").id],
      ["upsertBlockProperty", MOBILE, prop("Owner").ident.slice(1), val("Owner", "Alice").id],
    ]);
    expect(cardsIn(val("Status", "Doing").uuid, val("Owner", "Alice").uuid)).toEqual([MOBILE, SITE]); // 8 Oct before 23 Oct
  });

  it("drop on No Owner removes the value", async () => {
    await click("[data-control=kb-lane]");
    await click(`[data-popover=kb-lane] [data-option="${prop("Owner").ident}"]`);
    drag(card(SITE), cell(val("Status", "Doing").uuid, "none"));
    await ws.idle();
    expect(writeCalls()).toEqual([["removeBlockProperty", SITE, prop("Owner").ident.slice(1)]]);
    expect(cardsIn(val("Status", "Doing").uuid, "none")).toEqual([SITE]);
    expect(text(`[data-kb-lane-head="none"] [data-kb-count]`)).toBe("2");
  });

  it("optimistic: the card shows in the target at once, pending and not draggable, until the write finishes", async () => {
    let release!: () => void;
    graph.state.hold = new Promise<void>((r) => (release = r));
    drag(card(SITE), cell(val("Status", "Done").uuid));
    expect(cellOf(SITE).dataset.kbCol).toBe(val("Status", "Done").uuid);
    expect(card(SITE).hasAttribute("data-kb-pending")).toBe(true);
    expect(card(SITE).getAttribute("draggable")).toBe("false");
    expect($<HTMLButtonElement>(`[data-kb-move="${SITE}"]`)!.disabled).toBe(true);
    // a drag of the pending card is refused and writes nothing
    const again = drag(card(SITE), cell(val("Status", "Todo").uuid));
    expect(again.start.defaultPrevented).toBe(true);
    release();
    await ws.idle();
    expect(writeCalls()).toHaveLength(1);
    expect(card(SITE).hasAttribute("data-kb-pending")).toBe(false);
    expect(card(SITE).getAttribute("draggable")).toBe("true");
    expect(cellOf(SITE).dataset.kbCol).toBe(val("Status", "Done").uuid);
  });

  it("a write the graph does not hold (the API resolves null and does nothing): the card goes back and the error shows", async () => {
    graph.state.silent = true;
    drag(card(SITE), cell(val("Status", "Done").uuid));
    expect(cellOf(SITE).dataset.kbCol).toBe(val("Status", "Done").uuid); // optimistic
    await ws.idle();
    expect(cellOf(SITE).dataset.kbCol).toBe(val("Status", "Doing").uuid);
    expect(card(SITE).hasAttribute("data-kb-pending")).toBe(false);
    expect(text("[data-region=error]")).toContain('Status of "Website relaunch" was not saved as Done');
    expect(text(`[data-kb-column="${val("Status", "Doing").uuid}"] [data-kb-count]`)).toBe("1");
  });
});

describe("keyboard move", () => {
  it("the card's Move menu lists the columns (and lanes) and moves through the same write path", async () => {
    await click("[data-control=kb-lane]");
    await click(`[data-popover=kb-lane] [data-option="${prop("Owner").ident}"]`);
    const trigger = $(`[data-kb-move="${SITE}"]`)!;
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-label")).toBe("Move Website relaunch");
    await click(`[data-kb-move="${SITE}"]`);
    expect($(`[data-kb-move="${SITE}"]`)!.getAttribute("aria-expanded")).toBe("true");
    const menu = $("[data-popover=kb-move]")!;
    expect([...menu.querySelectorAll<HTMLElement>("[data-kb-to-col]")].map((b) => b.textContent)).toEqual(["Backlog", "Todo", "Doing", "In Review", "Done", "Canceled", "No Status"]);
    expect([...menu.querySelectorAll<HTMLElement>("[data-kb-to-lane]")].map((b) => b.textContent)).toEqual(["Alice", "Bob", "No Owner"]);
    expect(menu.querySelector(`[data-kb-to-col="${val("Status", "Doing").uuid}"]`)!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(menu.querySelector("[aria-selected=true]")); // focus moves into the menu
    await click(`[data-popover=kb-move] [data-kb-to-col="${val("Status", "In Review").uuid}"]`);
    expect(writeCalls()).toEqual([["upsertBlockProperty", SITE, "logseq.property/status", val("Status", "In Review").id]]);
    expect($("[data-popover=kb-move]")).toBeNull();
    expect(cardsIn(val("Status", "In Review").uuid, val("Owner", "Alice").uuid)).toEqual([ACME, SITE]);
    expect(document.activeElement).toBe($(`[data-kb-move="${SITE}"]`)); // focus returns to the card's Move button

    await click(`[data-kb-move="${SITE}"]`);
    await click(`[data-popover=kb-move] [data-kb-to-lane="none"]`);
    expect(writeCalls()[1]).toEqual(["removeBlockProperty", SITE, prop("Owner").ident.slice(1)]);
    expect(cardsIn(val("Status", "In Review").uuid, "none")).toEqual([SITE]);
  });

  it("Escape closes the Move menu and returns focus to its button", async () => {
    await click(`[data-kb-move="${SITE}"]`);
    expect(ws.escape()).toBe(true);
    expect($("[data-popover=kb-move]")).toBeNull();
    expect(document.activeElement).toBe($(`[data-kb-move="${SITE}"]`));
  });
});

describe("stylesheet (happy-dom does not apply CSS)", () => {
  it("uses tokens only: no colour literals; fonts keep the fallback; no [hidden] override", () => {
    expect(kanbanCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const colours = [...kanbanCss.matchAll(/(?:^|[;{\s])(?:color|background|border(?:-[a-z]+)?|box-shadow|outline):\s*([^;}]+)/g)].map((m) => m[1]);
    for (const c of colours) expect(c.replace(/var\([^)]*\)/g, "")).not.toMatch(/\b(?:red|green|blue|black|white|gray|grey)\b/);
    for (const m of kanbanCss.matchAll(/font-family:\s*([^;}]+)/g)) expect(m[1]).toMatch(/var\(--pl-font\)|sans-serif|monospace/);
    expect(kanbanCss).not.toMatch(/\[hidden\]/);
  });

  it("the board scrolls sideways inside the view: fixed-minimum columns, the board as wide as its columns", () => {
    expect(kanbanCss).toMatch(/\.pl-kb\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--pl-kb-cols\),\s*minmax\(220px,\s*1fr\)\)/);
    expect(kanbanCss).toMatch(/\.pl-kb\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%/);
    expect($("[data-kanban]")!.getAttribute("style")).toContain("--pl-kb-cols: 7");
  });

  it("text rows have a real height; cells on the fill, radius 12; cards on the surface, radius 10, hairline ring", () => {
    expect(kanbanCss).toMatch(/\.pl-kb-title\s*\{[^}]*line-height:\s*20px/);
    expect(kanbanCss).toMatch(/\.pl-kb-head\s*\{[^}]*min-height:\s*28px/);
    expect(kanbanCss).toMatch(/\.pl-kb-cell\s*\{[^}]*background:\s*var\(--pl-fill\)[^}]*border-radius:\s*12px/);
    expect(kanbanCss).toMatch(/\.pl-kb-card\s*\{[^}]*background:\s*var\(--pl-surface\)[^}]*border-radius:\s*10px[^}]*box-shadow:\s*0 0 0 1px var\(--pl-line\)/);
    expect(kanbanCss).toMatch(/\[data-kb-over\][^{]*\{[^}]*var\(--pl-tint-soft\)/);
    expect(kanbanCss).toMatch(/\[data-kb-pending\][^{]*\{[^}]*cursor:\s*progress/);
  });
});
