// @vitest-environment happy-dom
// N06c: editing dates by dragging (and Alt+Arrow keys) in the Timeline, through the workspace with a fake graph.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { fakeGraph, fakeStorage, fixtureDq } from "./test-fakes";
import { CLICK_PX, createWorkspace, type Workspace } from "./workspace";
import { DAY_TRACK_PX, EDIT_HELP_ID, TRACK_PX } from "./timeline";
import timelineCss from "./timeline.css?inline";

const TODAY = "2026-10-03";
const SITE = "6a000000-0000-4000-8000-000000000001"; // Website relaunch: Date Start 23 Sep, End 23 Oct
const ACME = "6a000000-0000-4000-8000-000000000003"; // Acme rollout: Date Start 30 Sep, End 8 Oct
const MOBILE = "6a000000-0000-4000-8000-000000000002"; // Mobile app: Date Start 8 Oct only (a point)
const KICKOFF = "6a000000-0000-4000-8000-000000000011"; // Meeting: DateTime Date 3 Oct 10:30 at UTC−5 (a point)
const KICKOFF_MS = 1791041400000;
const MONTH = TRACK_PX.month;

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let graph: ReturnType<typeof fakeGraph>;
let openNode: ReturnType<typeof vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>>;
let store: ReturnType<typeof createViewStore>;
/** Graph reads the workspace made. */
let reads = 0;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const ident = (t: string, p: string) => tag(t).dateProps.find((x) => x.title === p)!.ident.slice(1);
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const bar = (uuid: string) => $(`[data-tl-bar][data-tl-open="${uuid}"]`)!;
const point = (uuid: string) => $(`[data-tl-point][data-tl-open="${uuid}"]`)!;
const writes = () => graph.calls.filter(([c]) => c === "upsertBlockProperty" || c === "createJournalPage");

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.click();
  await ws.idle();
}
const ptr = (el: Element, type: string, x: number, init: PointerEventInit = {}) =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, pointerId: 1, button: 0, ...init }));
/** A press on `el` (or on `from` inside it), a move by `dx` px, the release and the click a browser sends after it. */
async function drag(el: HTMLElement, dx: number, from: Element = el) {
  ptr(from, "pointerdown", 100);
  ptr(el, "pointermove", 100 + dx / 2);
  ptr(el, "pointermove", 100 + dx);
  ptr(el, "pointerup", 100 + dx);
  el.click();
  await ws.idle();
}

beforeEach(async () => {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  graph = fakeGraph();
  openNode = vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>();
  store = createViewStore(fakeStorage());
  reads = 0;
  ws = createWorkspace(root, { dq: (q, ...inputs) => (reads++, graph.dq(q, ...inputs)), views: store, onClose: vi.fn(), openNode, zone: () => -300, today: () => TODAY, time: () => "13:30",
    kanban: graph.writes, dates: graph.dates, weekStart: async () => 0 });
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`); // Month zoom: 13 Sep – 7 Nov, 18 px day tracks
});

describe("Edit dates toggle", () => {
  it("is in the Timeline toolbar, off by default: no handles, no locked or editable marks, no description", () => {
    const toggle = $("[data-region=view-toolbar] [data-tl-edit]")!;
    expect([toggle.tagName, toggle.textContent, toggle.getAttribute("aria-pressed")]).toEqual(["BUTTON", "Edit dates", "false"]);
    expect($$("[data-tl-handle], [data-tl-locked], [data-tl-editable], [data-tl-edit-help]")).toEqual([]);
  });

  it("on: editable bars get handles and point at one description; off again: gone; focus stays on the toggle", async () => {
    $("[data-tl-edit]")!.focus();
    await click("[data-tl-edit]");
    expect($("[data-tl-edit]")!.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe($("[data-tl-edit]"));
    expect([...bar(ACME).querySelectorAll("[data-tl-handle]")].map((h) => h.getAttribute("data-tl-handle"))).toEqual(["start", "end"]);
    expect(bar(ACME).hasAttribute("data-tl-move")).toBe(true);
    expect(bar(ACME).getAttribute("aria-describedby")).toBe(EDIT_HELP_ID);
    expect($$(`#${EDIT_HELP_ID}`)).toHaveLength(1);
    expect($(`#${EDIT_HELP_ID}`)!.textContent).toContain("Alt+Left");
    await click("[data-tl-edit]");
    expect($$("[data-tl-handle], [data-tl-editable], [data-tl-edit-help]")).toEqual([]);
  });

  it("is session state: not in the view config, not saved with a view, kept over a zoom change", async () => {
    await click("[data-tl-edit]");
    await click("[data-tl-zoom=week]");
    expect($("[data-tl-edit]")!.getAttribute("aria-pressed")).toBe("true");
    expect(JSON.stringify(ws.config())).not.toMatch(/edit/i);
    const create = vi.spyOn(store, "create");
    await click("[data-control=saved-views]");
    await click("[data-action=save-view]");
    expect(serializeViewConfig(create.mock.calls[0][1])).not.toMatch(/edit/i);
  });

  it("a plain click on a bar still opens its node", async () => {
    await click("[data-tl-edit]");
    bar(ACME).click();
    expect(openNode).toHaveBeenCalledWith(ACME, { sidebar: false });
  });
});

describe("dragging a bar (Date Start / End, Month zoom)", () => {
  beforeEach(() => click("[data-tl-edit]"));

  it("the body moves both dates by whole tracks; only the bar's inline placement changes during the drag", async () => {
    const el = bar(ACME);
    expect(el.getAttribute("style")).toBe("grid-column: 19 / 28");
    ptr(el, "pointerdown", 100);
    ptr(el, "pointermove", 100 + 2 * MONTH + 4); // 2.2 tracks → 2
    expect(el.getAttribute("style")).toBe("grid-column: 21 / 30");
    expect(el.isConnected).toBe(true); // not re-rendered
    expect(el.hasAttribute("data-tl-dragging")).toBe(true);
    expect(writes()).toEqual([]);
    ptr(el, "pointerup", 100 + 2 * MONTH + 4);
    el.click();
    await ws.idle();
    expect(writes()).toEqual([
      ["createJournalPage", "2026-10-02T12:00:00"], ["upsertBlockProperty", ACME, ident("Project", "Start"), expect.any(Number)],
      ["createJournalPage", "2026-10-10T12:00:00"], ["upsertBlockProperty", ACME, ident("Project", "End"), expect.any(Number)],
    ]);
    expect(bar(ACME).getAttribute("style")).toBe("grid-column: 21 / 30"); // drawn from the graph read back
    expect(openNode).not.toHaveBeenCalled(); // the click after a drag is not an open
    expect($("[data-region=error]")).toBeNull();
  });

  it("the start handle changes the Start only", async () => {
    await drag(bar(ACME), -3 * MONTH, bar(ACME).querySelector("[data-tl-handle=start]")!);
    expect(writes()).toEqual([["createJournalPage", "2026-09-27T12:00:00"], ["upsertBlockProperty", ACME, ident("Project", "Start"), expect.any(Number)]]);
    expect(bar(ACME).getAttribute("style")).toBe("grid-column: 16 / 28");
  });

  it("the end handle changes the End only", async () => {
    await drag(bar(ACME), MONTH, bar(ACME).querySelector("[data-tl-handle=end]")!);
    expect(writes()).toEqual([["createJournalPage", "2026-10-09T12:00:00"], ["upsertBlockProperty", ACME, ident("Project", "End"), expect.any(Number)]]);
    expect(bar(ACME).getAttribute("style")).toBe("grid-column: 19 / 29");
  });

  it("a span keeps at least one track: the end stops on the start's day", async () => {
    await drag(bar(ACME), -20 * MONTH, bar(ACME).querySelector("[data-tl-handle=end]")!);
    expect(writes()).toEqual([["createJournalPage", "2026-09-30T12:00:00"], ["upsertBlockProperty", ACME, ident("Project", "End"), expect.any(Number)]]);
    expect(bar(ACME).getAttribute("style")).toBe("grid-column: 19 / 20");
  });

  it("a one-date point moves its date", async () => {
    expect(point(MOBILE).getAttribute("style")).toBe("grid-column: 27");
    expect(point(MOBILE).querySelector("[data-tl-handle]")).toBeNull();
    await drag(point(MOBILE), MONTH);
    expect(writes()).toEqual([["createJournalPage", "2026-10-09T12:00:00"], ["upsertBlockProperty", MOBILE, ident("Project", "Start"), expect.any(Number)]]);
    expect(point(MOBILE).getAttribute("style")).toBe("grid-column: 28");
  });

  it("under 4 px is a click: it opens the node and writes nothing", async () => {
    await drag(bar(ACME), CLICK_PX - 1);
    expect(writes()).toEqual([]);
    expect(openNode).toHaveBeenCalledWith(ACME, { sidebar: false });
  });

  it("a drag back to where it started writes nothing and opens nothing", async () => {
    const el = bar(ACME);
    ptr(el, "pointerdown", 100);
    ptr(el, "pointermove", 100 + 2 * MONTH);
    ptr(el, "pointermove", 101);
    ptr(el, "pointerup", 101);
    el.click();
    await ws.idle();
    expect(writes()).toEqual([]);
    expect(openNode).not.toHaveBeenCalled();
    expect(el.getAttribute("style")).toBe("grid-column: 19 / 28");
  });

  it("Escape aborts: the bar goes back, no write, the release opens nothing; Escape then has nothing more to close", async () => {
    const el = bar(ACME);
    ptr(el, "pointerdown", 100);
    ptr(el, "pointermove", 100 + 3 * MONTH);
    expect(ws.escape()).toBe(true);
    expect(el.getAttribute("style")).toBe("grid-column: 19 / 28");
    expect(el.hasAttribute("data-tl-dragging")).toBe(false);
    ptr(el, "pointermove", 100 + 5 * MONTH);
    ptr(el, "pointerup", 100 + 5 * MONTH);
    el.click();
    await ws.idle();
    expect(writes()).toEqual([]);
    expect(openNode).not.toHaveBeenCalled();
    expect(el.getAttribute("style")).toBe("grid-column: 19 / 28");
    expect(ws.escape()).toBe(false);
  });

  it("pointercancel aborts with no write", async () => {
    const el = bar(ACME);
    ptr(el, "pointerdown", 100);
    ptr(el, "pointermove", 100 + 3 * MONTH);
    ptr(el, "pointercancel", 100 + 3 * MONTH);
    await ws.idle();
    expect(writes()).toEqual([]);
    expect(el.getAttribute("style")).toBe("grid-column: 19 / 28");
  });

  it("the bar shows at its new place, pending and without handles, until the write settles", async () => {
    let release!: () => void;
    graph.state.hold = new Promise<void>((r) => (release = r));
    const el = bar(ACME);
    ptr(el, "pointerdown", 100);
    ptr(el, "pointermove", 100 + MONTH);
    ptr(el, "pointerup", 100 + MONTH);
    const pending = bar(ACME);
    expect(pending.hasAttribute("data-tl-pending")).toBe(true);
    expect(pending.getAttribute("style")).toBe("grid-column: 20 / 29");
    expect(pending.querySelector("[data-tl-handle]")).toBeNull();
    expect(pending.hasAttribute("data-tl-editable")).toBe(false);
    release();
    await ws.idle();
    expect(bar(ACME).hasAttribute("data-tl-pending")).toBe(false);
    expect(bar(ACME).getAttribute("style")).toBe("grid-column: 20 / 29");
  });

  it("a live refresh waits for the drag: nothing is read or redrawn until the drop, then it runs", async () => {
    const el = bar(ACME);
    ptr(el, "pointerdown", 100);
    ptr(el, "pointermove", 100 + 2 * MONTH);
    const before = reads;
    await ws.refresh();
    expect(el.isConnected).toBe(true);
    expect(el.getAttribute("style")).toBe("grid-column: 21 / 30");
    expect(reads).toBe(before);
    ptr(el, "pointermove", 100);
    ptr(el, "pointerup", 100); // back where it started: no write, the deferred refresh runs
    await ws.idle();
    expect(writes()).toEqual([]);
    expect(reads).toBeGreaterThan(before);
  });

  it("a failed write puts the bar back and shows the error", async () => {
    graph.state.silent = true; // the host call resolves and writes nothing
    await drag(bar(ACME), 2 * MONTH);
    expect($("[data-region=error]")!.textContent).toContain('Start of "Acme rollout" was not saved as 2 Oct (read back differs). The timeline shows what the graph holds.');
    expect(bar(ACME).getAttribute("style")).toBe("grid-column: 19 / 28");
    expect(bar(ACME).hasAttribute("data-tl-pending")).toBe(false);
  });

  it("a bar clipped at the range's start has no start handle; its end and its move stay editable", () => {
    const site = bar(SITE); // 23 Sep – 23 Oct in 13 Sep – 7 Nov: not clipped in Month
    expect(site.querySelectorAll("[data-tl-handle]")).toHaveLength(2);
  });
});

describe("locked items", () => {
  beforeEach(() => click("[data-tl-edit]"));

  it("Week zoom: a bar clipped at an edge has no handle on that side, keeps the other and moves", async () => {
    await click("[data-tl-zoom=week]"); // 20 Sep – 10 Oct: Website relaunch runs past the end
    const site = bar(SITE);
    expect(site.hasAttribute("data-clip-end")).toBe(true);
    expect([...site.querySelectorAll("[data-tl-handle]")].map((h) => h.getAttribute("data-tl-handle"))).toEqual(["start"]);
    expect(site.hasAttribute("data-tl-move")).toBe(true);
  });

  it("task markers are locked; a span derived from tasks is locked with no handles", async () => {
    $$("[data-tl-toggle]").forEach((t) => t.click());
    await ws.idle();
    const markers = $$("[data-tl-marker]");
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((m) => m.hasAttribute("data-tl-locked"))).toBe(true);
    graph.edits.set(MOBILE, { [`:${ident("Project", "Start")}`]: null }); // no Start: its span comes from its task (Wireframes)
    await ws.refresh();
    const derived = $$('[data-tl-bar][data-kind="derived"]');
    expect(derived.map((d) => d.dataset.tlOpen)).toEqual([MOBILE]);
    for (const d of derived) {
      expect(d.hasAttribute("data-tl-locked")).toBe(true);
      expect(d.querySelector("[data-tl-handle]")).toBeNull();
      expect(d.hasAttribute("aria-describedby")).toBe(false);
    }
    const before = graph.calls.length;
    await drag(derived[0], 3 * MONTH);
    expect(graph.calls.length).toBe(before);
  });

  it("Day zoom: Date values are locked (a day cannot move by minutes)", async () => {
    await click("[data-tl-zoom=day]");
    const site = bar(SITE);
    expect(site.hasAttribute("data-tl-locked")).toBe(true);
    expect(site.querySelector("[data-tl-handle]")).toBeNull();
  });
});

describe("DateTime values (#Meeting Date: a point)", () => {
  beforeEach(async () => {
    await click(`[data-tag-id="${tag("Meeting").id}"]`);
    await click("[data-tl-edit]");
  });

  it("Week zoom: a move by a day keeps the time of day (epoch ms one day later)", async () => {
    await click("[data-tl-zoom=week]");
    await drag(point(KICKOFF), TRACK_PX.week);
    expect(writes()).toEqual([["upsertBlockProperty", KICKOFF, ident("Meeting", "Date"), KICKOFF_MS + 86_400_000]]);
    expect(graph.calls).toContainEqual(["readDate", KICKOFF, `:${ident("Meeting", "Date")}`, "datetime"]);
  });

  it("Day zoom: moves by 15-minute tracks", async () => {
    await click("[data-tl-zoom=day]");
    expect(point(KICKOFF).getAttribute("style")).toBe("grid-column: 44"); // 10:30 = track 42
    await drag(point(KICKOFF), 2 * DAY_TRACK_PX);
    expect(writes()).toEqual([["upsertBlockProperty", KICKOFF, ident("Meeting", "Date"), KICKOFF_MS + 30 * 60_000]]);
    expect(point(KICKOFF).getAttribute("style")).toBe("grid-column: 46");
  });
});

describe("keyboard", () => {
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    return e;
  };

  it("off: Alt+Arrow on a bar is not handled", async () => {
    expect(key(bar(ACME), "ArrowRight", { altKey: true }).defaultPrevented).toBe(false);
    await ws.idle();
    expect(writes()).toEqual([]);
  });

  it("Alt+Right moves a focused bar one track; Alt+Shift+Left changes its End; focus stays on it; both are handled", async () => {
    await click("[data-tl-edit]");
    bar(ACME).focus();
    expect(key(bar(ACME), "ArrowRight", { altKey: true }).defaultPrevented).toBe(true);
    await ws.idle();
    expect(bar(ACME).getAttribute("style")).toBe("grid-column: 20 / 29");
    expect(document.activeElement).toBe(bar(ACME));
    graph.calls.length = 0;
    expect(key(bar(ACME), "ArrowLeft", { altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    await ws.idle();
    expect(writes()).toEqual([["createJournalPage", "2026-10-08T12:00:00"], ["upsertBlockProperty", ACME, ident("Project", "End"), expect.any(Number)]]);
    expect(bar(ACME).getAttribute("style")).toBe("grid-column: 20 / 28");
  });

  it("a point moves with Alt+Left; Alt+Shift does nothing on a point (move only) but is still handled", async () => {
    await click("[data-tl-edit]");
    expect(key(point(MOBILE), "ArrowLeft", { altKey: true }).defaultPrevented).toBe(true);
    await ws.idle();
    expect(point(MOBILE).getAttribute("style")).toBe("grid-column: 26");
    graph.calls.length = 0;
    expect(key(point(MOBILE), "ArrowLeft", { altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    await ws.idle();
    expect(writes()).toEqual([]);
  });

  it("a locked bar: handled, nothing written", async () => {
    await click("[data-tl-edit]");
    await click("[data-tl-zoom=day]");
    expect(key(bar(SITE), "ArrowRight", { altKey: true }).defaultPrevented).toBe(true);
    await ws.idle();
    expect(writes()).toEqual([]);
  });
});

describe("stylesheet (happy-dom does not apply CSS)", () => {
  it("the track widths a drag divides by are the ones timeline.css sets", () => {
    expect(timelineCss).toMatch(new RegExp(`\\.pl-tl \\{[^}]*--pl-tl-track: ${TRACK_PX.month}px`));
    expect(timelineCss).toMatch(new RegExp(`\\.pl-tl\\[data-zoom="week"\\] \\{ --pl-tl-track: ${TRACK_PX.week}px`));
    expect(timelineCss).toMatch(/\.pl-tl\[data-zoom="quarter"\] \{ --pl-tl-track: calc\(52px \/ 7\)/);
    expect(TRACK_PX.quarter).toBe(52 / 7);
  });

  it("handles are the first / last 6 px with a resize cursor; editable items take no browser panning; locked ones the default cursor", () => {
    expect(timelineCss).toMatch(/\.pl-tl-handle \{[^}]*width: 6px;[^}]*cursor: ew-resize/);
    expect(timelineCss).toMatch(/\[data-tl-editable\][^{]*\{[^}]*touch-action: none/);
    expect(timelineCss).toMatch(/\[data-tl-locked\][^{]*\{ cursor: default; \}/);
  });
});
