// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { PlannerNode, TagInfo } from "../types";
import { viewItems } from "../core/layout-common";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq, noWrites } from "./test-fakes";
import timelineCss from "./timeline.css?inline";
import { DAY_TRACK_PX, drawLinks, linkPath, renderTimeline } from "./timeline";
import { layoutTimeline } from "../core/timeline-layout";

/** A layout with no items (range of today, Month), to render summaries alone. */
const emptyLayout = () => layoutTimeline({ items: [], zoom: "month", anchor: TODAY, today: TODAY, now: "13:30", weekStart: 0, statusValues: [], titles: new Map() });

const TODAY = "2026-10-03";
const SITE = "6a000000-0000-4000-8000-000000000001";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let openNode: ReturnType<typeof vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>>;
let store: ReturnType<typeof createViewStore>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;

async function click(sel: string, init: MouseEventInit = {}) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
  await ws.idle();
}
const rowOf = (title: string) => {
  const r = $$("[data-tl-row]").find((x) => x.querySelector(".pl-tl-name")?.textContent === title);
  if (!r) throw new Error(`no row ${title}`);
  return r;
};
const rowTitles = () => $$("[data-tl-row]").map((r) => r.querySelector(".pl-tl-name")!.textContent);

beforeEach(async () => {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  openNode = vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>();
  store = createViewStore(fakeStorage());
  ws = createWorkspace(root, { dq: fixtureDq(), views: store, onClose: vi.fn(), openNode, zone: () => -300, today: () => TODAY, time: () => "13:30", kanban: noWrites, weekStart: async () => 0 });
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`);
});

describe("toolbar", () => {
  it("shows the zoom switch (Month by default), prev / today / next and the range label", () => {
    expect($$("[data-region=view-toolbar] [data-tl-zoom]").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
      .toEqual([["Day", "false"], ["Week", "false"], ["Month", "true"], ["Quarter", "false"]]);
    for (const nav of ["prev", "today", "next"]) expect($(`[data-region=view-toolbar] [data-tl-nav=${nav}]`)!.tagName).toBe("BUTTON");
    expect($("[data-tl-nav=prev]")!.getAttribute("aria-label")).toBe("Previous");
    expect(text("[data-tl-range]")).toBe("13 Sep – 7 Nov 2026");
    expect($$("[data-tl-col]")).toHaveLength(56);
  });

  it("zoom changes the view config (saved with the view) and the columns", async () => {
    await click("[data-tl-zoom=week]");
    expect(ws.config()).toMatchObject({ kind: "timeline", zoom: "week" });
    expect($("[data-tl-zoom=week]")!.getAttribute("aria-pressed")).toBe("true");
    expect(text("[data-tl-range]")).toBe("20 Sep – 10 Oct 2026");
    expect($("[data-timeline]")!.dataset.zoom).toBe("week");
    expect($$("[data-tl-col]")).toHaveLength(21);
    await click("[data-tl-zoom=quarter]");
    expect(text("[data-tl-range]")).toBe("30 Aug – 26 Dec 2026");
    expect($$("[data-tl-col]")).toHaveLength(17);

    const create = vi.spyOn(store, "create");
    await click("[data-control=saved-views]");
    await click("[data-action=save-view]");
    expect(create.mock.calls[0][1]).toMatchObject({ zoom: "quarter" });
    expect(create.mock.calls[0][1]).not.toHaveProperty("anchor");
  });

  it("prev / next move the range, Today returns to it; the anchor is session state, not config", async () => {
    const before = JSON.stringify(ws.config());
    await click("[data-tl-nav=next]");
    expect(text("[data-tl-range]")).toBe("4 Oct – 28 Nov 2026");
    expect($("[data-tl-today]")).toBeNull();
    await click("[data-tl-nav=prev]");
    await click("[data-tl-nav=prev]");
    expect(text("[data-tl-range]")).toBe("23 Aug – 17 Oct 2026");
    await click("[data-tl-nav=today]");
    expect(text("[data-tl-range]")).toBe("13 Sep – 7 Nov 2026");
    expect(JSON.stringify(ws.config())).toBe(before);
  });

  it("keeps focus on the nav button it re-rendered", async () => {
    $("[data-tl-nav=next]")!.focus();
    await click("[data-tl-nav=next]");
    expect(document.activeElement).toBe($("[data-tl-nav=next]"));
  });

  it("is only shown for the Timeline", async () => {
    await click("[data-view-kind=calendar]");
    expect($("[data-tl-zoom]")).toBeNull();
    expect($("[data-timeline]")).toBeNull();
    await click("[data-view-kind=kanban]");
    expect($("[data-tl-zoom]")).toBeNull();
    expect($("[data-timeline]")).toBeNull();
    expect($("[data-kanban]")).not.toBeNull();
  });
});

describe("Day zoom (N10)", () => {
  it("one grid of 96 quarter-hour tracks with the Day track width inline; the other zooms set the track count only", async () => {
    const month = $("[data-timeline]")!;
    expect(month.getAttribute("style")).toBe("--pl-tl-tracks: 56");
    expect(month.hasAttribute("data-tl-start")).toBe(false);
    await click("[data-tl-zoom=day]");
    const tl = $("[data-timeline]")!;
    expect(tl.dataset.zoom).toBe("day");
    expect(tl.getAttribute("style")).toBe(`--pl-tl-tracks: 96; --pl-tl-track: ${DAY_TRACK_PX}px`);
    expect(tl.dataset.tlStart).toBe(TODAY);
    expect(timelineCss).toMatch(/\.pl-tl\[data-zoom="week"\]\s*\{\s*--pl-tl-track:\s*44px/);
  });

  it("24 hour columns labelled 00 … 23, keyed by day and hour; the current hour is today's; no weekend or week marks", async () => {
    await click("[data-tl-zoom=day]");
    const cols = $$("[data-tl-col]");
    expect(cols.map((c) => c.textContent)).toEqual(Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")));
    expect(cols[13].dataset.tlCol).toBe(`${TODAY}T13`);
    expect(cols[13].getAttribute("style")).toContain("grid-column: 54 / 58");
    expect($$("[data-tl-col][data-today]").map((c) => c.dataset.tlCol)).toEqual([`${TODAY}T13`]);
    expect($$(".pl-tl-cell")).toHaveLength(24);
    expect($$(".pl-tl-cell[data-weekend], .pl-tl-cell[data-week-start], .pl-tl-cell[data-month-start]")).toHaveLength(0);
    expect(timelineCss).toMatch(/\.pl-tl\[data-zoom="day"\] \.pl-tl-cell\s*\{[^}]*box-shadow/);
  });

  it("Date-only spans across the day are clipped bars over all 96 tracks; a timed point sits at its quarter hour", async () => {
    await click("[data-tl-zoom=day]");
    const bar = rowOf("Website relaunch").querySelector<HTMLElement>("[data-tl-bar]")!;
    expect(bar.getAttribute("style")).toContain("grid-column: 2 / 98");
    expect(bar.hasAttribute("data-clip-start") && bar.hasAttribute("data-clip-end")).toBe(true);
    expect(bar.getAttribute("aria-label")).toBe("Website relaunch, 23 Sep – 23 Oct, 1 of 2 done, continues before this range, continues after this range");
    await click(`[data-tag-id="${tag("Meeting").id}"]`); // a new tag starts on its default view (Month)
    await click("[data-tl-zoom=day]");
    const kickoff = $("[data-tl-point]")!;
    expect(kickoff.getAttribute("style")).toContain("grid-column: 44"); // 10:30 = track 42
    expect(kickoff.getAttribute("aria-label")).toBe("Kickoff, 3 Oct 10:30");
    expect(text("[data-tl-outside-summary]")).toBe("1 later");
    expect($("[data-tl-jump=later]")!.dataset.tlDay).toBe("2026-10-04");
  });

  it("task markers at their time's track", async () => {
    await click("[data-tl-zoom=day]");
    await click("[data-tl-nav=next]");
    await click("[data-tl-nav=next]"); // Mon 5 Oct: Draft brief, deadline 17:00
    await click(`[data-tl-toggle="${rowOf("Website relaunch").dataset.tlRow}"]`);
    const marker = $("[data-tl-task] [data-tl-marker=deadline]")!;
    expect(marker.getAttribute("style")).toContain("grid-column: 70"); // 17:00 = track 68
    expect(marker.getAttribute("title")).toBe("due 5 Oct 17:00");
  });

  it("the now line sits at the current time, only on today; the CSS puts it at the track edge, not the middle", async () => {
    await click("[data-tl-zoom=day]");
    expect($("[data-tl-today]")!.getAttribute("style")).toContain("--pl-tl-today: 54"); // 13:30
    expect(timelineCss).toMatch(/\.pl-tl\[data-zoom="day"\] \.pl-tl-today\s*\{[^}]*left:\s*calc\(var\(--pl-tl-label-w\) \+ var\(--pl-tl-today\) \* var\(--pl-tl-track\)\)/);
    await click("[data-tl-nav=next]");
    expect($("[data-tl-today]")).toBeNull();
    expect($("[data-tl-col][data-today]")).toBeNull();
  });

  it("carries the scroll the Day view opens at: the earliest timed item with a 30-minute lead, else 08:00", async () => {
    await click("[data-tl-zoom=day]");
    expect($("[data-timeline]")!.dataset.tlScrollLeft).toBe(String(30 * DAY_TRACK_PX)); // Date-only spans only
    await click(`[data-tag-id="${tag("Meeting").id}"]`);
    await click("[data-tl-zoom=day]");
    expect($("[data-timeline]")!.dataset.tlScrollLeft).toBe(String(40 * DAY_TRACK_PX)); // Kickoff 10:30
  });
});

describe("rows", () => {
  it("one row per dated node sorted by start, bars on the day grid, a diamond for a one-date node", () => {
    expect(rowTitles()).toEqual(["Website relaunch", "Acme rollout", "Mobile app"]);
    const bar = rowOf("Website relaunch").querySelector<HTMLElement>("[data-tl-bar]")!;
    expect(bar.tagName).toBe("BUTTON");
    expect(bar.dataset.kind).toBe("mapped");
    expect(bar.getAttribute("style")).toContain("grid-column: 12 / 43");
    expect(bar.getAttribute("aria-label")).toBe("Website relaunch, 23 Sep – 23 Oct, 1 of 2 done");
    expect(bar.querySelector<HTMLElement>(".pl-tl-progress")!.getAttribute("style")).toContain("width: 50%");
    expect(text("[data-tl-row] .pl-tl-count")).toBe("1/2");
    const diamond = rowOf("Mobile app").querySelector<HTMLElement>("[data-tl-point]")!;
    expect(diamond.tagName).toBe("BUTTON");
    expect(diamond.getAttribute("style")).toContain("grid-column: 27");
    expect(rowOf("Mobile app").querySelector("[data-tl-bar]")).toBeNull();
  });

  it("marks a bar clipped at the range edge", async () => {
    await click("[data-tl-zoom=week]");
    const bar = rowOf("Website relaunch").querySelector<HTMLElement>("[data-tl-bar]")!;
    expect(bar.hasAttribute("data-clip-end")).toBe(true);
    expect(bar.hasAttribute("data-clip-start")).toBe(false);
    expect(bar.querySelector("[data-tl-clip=end]")).not.toBeNull();
    expect(bar.getAttribute("aria-label")).toContain("continues after this range");
  });

  it("renders no row for a node wholly outside the range; one summary line counts them (T13a)", async () => {
    expect($("[data-tl-outside-summary]")).toBeNull(); // every dated #Project node is in range
    for (let i = 0; i < 4; i++) await click("[data-tl-nav=next]");
    expect(rowTitles()).toEqual([]);
    expect($$("[data-tl-outside]")).toHaveLength(0);
    expect(text("[data-tl-outside-summary]")).toBe("3 earlier");
    expect($("[data-tl-jump=later]")).toBeNull();
    const earlier = $("[data-tl-jump=earlier]")!;
    expect(earlier.tagName).toBe("BUTTON");
    expect(earlier.dataset.tlDay).toBe("2026-10-23");
    expect(earlier.getAttribute("aria-label")).toBe("3 earlier nodes: go to the nearest, 23 Oct");
  });

  it("the earlier / later buttons move the range to the nearest node outside it", async () => {
    for (let i = 0; i < 4; i++) await click("[data-tl-nav=next]");
    await click("[data-tl-jump=earlier]");
    expect(rowTitles()).toContain("Website relaunch");
    expect(text("[data-tl-range]")).toBe("4 Oct – 28 Nov 2026");
    for (let i = 0; i < 8; i++) await click("[data-tl-nav=prev]");
    expect(text("[data-tl-outside-summary]")).toBe("3 later");
    await click("[data-tl-jump=later]");
    expect(rowTitles()).toContain("Website relaunch");
  });

  it("formats large counts and separates both sides", () => {
    const html = renderTimeline({ ...emptyLayout(), earlier: { count: 412, nearest: "2026-01-02" }, later: { count: 1105, nearest: "2026-12-01" } }, "#Load item", new Set());
    const box = document.createElement("div");
    box.innerHTML = html;
    expect(box.querySelector("[data-tl-outside-summary]")!.textContent!.replace(/\s+/g, " ").trim()).toBe("412 earlier · 1,105 later");
  });

  it("draws the today line in range, in the accent colour", () => {
    const line = $("[data-tl-today]")!;
    expect(line.getAttribute("style")).toContain("--pl-tl-today: 20");
    expect(line.getAttribute("aria-hidden")).toBe("true");
    expect($("[data-tl-col][data-today]")!.dataset.tlCol).toBe(TODAY);
    expect(timelineCss).toMatch(/\.pl-tl-today\s*\{[^}]*var\(--pl-today\)/);
  });

  it("lists undated nodes in a footnote with buttons that open them", async () => {
    expect(text("[data-tl-undated]")).toBe("No dates: Archive cleanup");
    await click("[data-tl-undated] [data-tl-open]");
    expect(openNode).toHaveBeenCalledWith("6a000000-0000-4000-8000-000000000004", { sidebar: false });
  });

  it("Meeting: DateTime nodes are diamonds, the untimed one is in the footnote", async () => {
    await click(`[data-tag-id="${tag("Meeting").id}"]`);
    expect(rowTitles()).toEqual(["Kickoff", "Late review"]);
    expect($$("[data-tl-point]")).toHaveLength(2);
    expect($("[data-tl-point]")!.getAttribute("aria-label")).toBe("Kickoff, 3 Oct 10:30");
    expect(text("[data-tl-undated]")).toBe("No dates: Untimed meeting");
  });
});

describe("task rows", () => {
  it("expand shows a node's tasks with resolved titles and date markers; collapse hides them", async () => {
    const site = rowOf("Website relaunch");
    const toggle = site.querySelector<HTMLElement>("[data-tl-toggle]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Show tasks of Website relaunch");
    expect($$("[data-tl-task]")).toHaveLength(0);

    await click(`[data-tl-toggle="${site.dataset.tlRow}"]`);
    const tasks = $$(`[data-tl-task][data-tl-parent="${site.dataset.tlRow}"]`);
    expect(tasks.map((t) => t.querySelector(".pl-tl-name")!.textContent)).toEqual(["Draft brief Website relaunch", "Ship homepage Website relaunch", "Survey users Website relaunch"]);
    expect(root.textContent).not.toContain("[[");
    const marker = tasks[0].querySelector<HTMLElement>("[data-tl-marker]")!;
    expect(marker.dataset.tlMarker).toBe("deadline");
    expect(marker.getAttribute("style")).toContain("grid-column: 24");
    expect(tasks[1].querySelector("[data-tl-marker]")).toBeNull();
    expect(tasks[1].dataset.status).toBe("done");
    expect(text(`[data-tl-task="${tasks[1].dataset.tlTask}"] .pl-tl-nodate`)).toBe("no date");
    expect($(`[data-tl-toggle="${site.dataset.tlRow}"]`)!.getAttribute("aria-expanded")).toBe("true");

    await click("[data-tl-zoom=week]"); // expansion survives a zoom change
    expect($$("[data-tl-task]")).toHaveLength(3);
    await click(`[data-tl-toggle="${site.dataset.tlRow}"]`);
    expect($$("[data-tl-task]")).toHaveLength(0);
  });

  it("a late marker is red on both shapes: the scheduled ring by its border, the deadline diamond by its fill", () => {
    expect(timelineCss).toMatch(/\.pl-tl-marker\[data-late\]\s*\{[^}]*border-color:\s*var\(--pl-red\)/);
    expect(timelineCss).toMatch(/\.pl-tl-marker\[data-tl-marker="deadline"\]\[data-late\]\s*\{[^}]*background:\s*var\(--pl-red\)/);
  });

  it("marks an open task past its deadline as late", async () => {
    await click(`[data-tl-toggle="${rowOf("Acme rollout").dataset.tlRow}"]`);
    expect($("[data-tl-task] [data-tl-marker=deadline]")!.hasAttribute("data-late")).toBe(true);
  });
});

describe("opening nodes", () => {
  it("click on a row label opens the node; Shift+click on its bar opens it in the sidebar", async () => {
    await click(`[data-tl-row] .pl-tl-name[data-tl-open="${SITE}"]`);
    expect(openNode).toHaveBeenLastCalledWith(SITE, { sidebar: false });
    await click(`[data-tl-bar][data-tl-open="${SITE}"]`, { shiftKey: true });
    expect(openNode).toHaveBeenLastCalledWith(SITE, { sidebar: true });
    expect(openNode).toHaveBeenCalledTimes(2);
  });

  it("a task row opens the task block", async () => {
    await click(`[data-tl-toggle="${rowOf("Website relaunch").dataset.tlRow}"]`);
    await click("[data-tl-task] [data-tl-open]");
    expect(openNode).toHaveBeenCalledWith("6a000000-0000-4000-8000-000000000021", { sidebar: false });
  });

  it("a diamond opens its node", async () => {
    await click("[data-tl-point]", { shiftKey: true });
    expect(openNode).toHaveBeenCalledWith("6a000000-0000-4000-8000-000000000002", { sidebar: true });
  });
});

describe("stylesheet (happy-dom does not apply CSS)", () => {
  it("uses tokens only: no colour literals", () => {
    expect(timelineCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const colours = [...timelineCss.matchAll(/(?:^|[;{\s])(?:color|background|border(?:-[a-z]+)?|box-shadow|outline):\s*([^;}]+)/g)].map((m) => m[1]);
    for (const c of colours) expect(c.replace(/var\([^)]*\)/g, "")).not.toMatch(/\b(?:red|green|blue|black|white|gray|grey)\b/);
  });

  it("keeps the fallback stack wherever a font-family is set", () => {
    for (const m of timelineCss.matchAll(/font-family:\s*([^;}]+)/g)) expect(m[1]).toMatch(/var\(--pl-font\)|sans-serif|monospace/);
  });

  it("dashes derived spans and lays the axis on one grid of day tracks", () => {
    expect(timelineCss).toMatch(/\.pl-tl-bar\[data-kind="derived"\]\s*\{[^}]*dashed/);
    expect(timelineCss).toMatch(/grid-template-columns:\s*var\(--pl-tl-label-w\)\s+repeat\(var\(--pl-tl-tracks\),\s*var\(--pl-tl-track\)\)/);
  });
});

describe("dependency connectors (N12)", () => {
  /** Week (20 Sep – 10 Oct): N1 a bar, N2 and N3 bars that depend on N1, N4 a point that depends on N2 and N3. */
  const linked = () => {
    const p = tag("Project");
    const s = p.dateProps.find((x) => x.title === "Start")!.ident;
    const e = p.dateProps.find((x) => x.title === "End")!.ident;
    const node = (id: number, start: string, end: string | null, deps: number[] = []): PlannerNode =>
      ({ id, uuid: `u${id}`, title: `N${id} <b>`, tagIds: [], dependsOn: deps, choices: {}, dates: { [s]: { day: start, time: null }, ...(end ? { [e]: { day: end, time: null } } : {}) } });
    const nodes = [node(1, "2026-09-28", "2026-10-01"), node(2, "2026-10-02", "2026-10-05", [1]), node(3, "2026-10-02", "2026-10-06", [1]), node(4, "2026-10-08", null, [2, 3])];
    return layoutTimeline({ items: viewItems(nodes, [], s, e, []), zoom: "week", anchor: TODAY, today: TODAY, now: "13:30", weekStart: 0, statusValues: [], titles: new Map() });
  };
  const host = (html: string) => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  };

  it("one hidden, non-interactive svg inside the timeline, between the head and the rows, with a path per link", () => {
    const el = host(renderTimeline(linked(), "#Project", new Set()));
    const svg = el.querySelector("[data-timeline] > svg.pl-tl-links[data-tl-links]")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.previousElementSibling!.classList.contains("pl-tl-head")).toBe(true);
    expect(svg.nextElementSibling!.classList.contains("pl-tl-rows")).toBe(true);
    expect([...svg.querySelectorAll("path[data-tl-link]")].map((p) => p.getAttribute("data-tl-link"))).toEqual(["u1:u2", "u1:u3", "u2:u4", "u3:u4"]);
    for (const path of svg.querySelectorAll("path[data-tl-link]")) expect(path.getAttribute("marker-end")).toBe("url(#pl-tl-arrow)");
    expect(svg.querySelector("marker#pl-tl-arrow")).not.toBeNull();
  });

  it("no svg without links", () => {
    expect(host(renderTimeline(emptyLayout(), "#Project", new Set())).querySelector("[data-tl-links]")).toBeNull();
    expect($("[data-tl-links]")).toBeNull(); // the fixture Project view: no dependency property
  });

  it("a bar or point with dependencies says so in its label (titles, escaped); others are unchanged", () => {
    const el = host(renderTimeline(linked(), "#Project", new Set()));
    const span = (uuid: string) => el.querySelector(`[data-tl-open="${uuid}"]:is([data-tl-bar], [data-tl-point])`)!;
    expect(span("u1").getAttribute("aria-label")).toBe("N1 <b>, 28 Sep – 1 Oct");
    expect(span("u2").getAttribute("aria-label")).toBe("N2 <b>, 2 Oct – 5 Oct, depends on N1 <b>");
    expect(span("u4").getAttribute("aria-label")).toBe("N4 <b>, 8 Oct, depends on N2 <b>, N3 <b>");
    expect(span("u4").getAttribute("title")).toBe(span("u4").getAttribute("aria-label"));
    expect(el.querySelector("b")).toBeNull(); // escaped: no element made from a title
  });

  describe("linkPath (rects relative to the timeline's origin)", () => {
    const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
    const origin = { left: 100, top: 50 };

    it("dependent starts after the end: right from the dependency's right edge middle, a stub, down, then into the left edge middle", () => {
      // from: 200–300 at rows 60–80 (middle 70); to: 340–400 at 92–112 (middle 102)
      expect(linkPath(rect(200, 60, 300, 80), rect(340, 92, 400, 112), origin)).toBe("M200 20 H208 V52 H240");
    });

    it("dependent above the dependency (rows sorted otherwise): the same route, going up", () => {
      expect(linkPath(rect(200, 124, 300, 144), rect(340, 92, 400, 112), origin)).toBe("M200 84 H208 V52 H240");
    });

    it("dependent starts before the dependency's end (overlap): out, down to just above the dependent, back left, down, in", () => {
      // to.left 250 < from.right 300: elbow at to.top - 6 = 86 → 36 relative
      expect(linkPath(rect(200, 60, 300, 80), rect(250, 92, 400, 112), origin)).toBe("M200 20 H208 V36 H142 V52 H150");
    });

    it("dependent starts earlier and sits above: the elbow runs just below the dependent", () => {
      expect(linkPath(rect(200, 124, 300, 144), rect(120, 92, 180, 112), origin)).toBe("M200 84 H208 V68 H12 V52 H20");
    });

    it("too little room for a straight route (less than two stubs) takes the elbow", () => {
      expect(linkPath(rect(200, 60, 300, 80), rect(310, 92, 400, 112), origin)).toBe("M200 20 H208 V36 H202 V52 H210");
    });

    it("keeps fractions to one decimal", () => {
      expect(linkPath(rect(200.26, 60, 300.04, 80.5), rect(340.33, 92, 400, 113), origin)).toBe("M200 20.3 H208 V52.5 H240.3");
    });
  });

  describe("drawLinks (post-render: geometry from the DOM)", () => {
    /** Fake layout boxes: the timeline at (0,0) 1000 wide, each span by its uuid. */
    const boxes = (el: HTMLElement, spans: Record<string, [number, number, number, number]>, width = 1000) =>
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const uuid = this.getAttribute("data-tl-open");
        const r = this.hasAttribute("data-timeline") ? [0, 0, width, 500] : uuid && (this.hasAttribute("data-tl-bar") || this.hasAttribute("data-tl-point")) ? spans[uuid] : [0, 0, 0, 0];
        const [left, top, right, bottom] = r ?? [0, 0, 0, 0];
        return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) } as DOMRect;
      });

    it("sets every path's d from the measured spans", () => {
      const el = host(renderTimeline(linked(), "#Project", new Set()));
      const spy = boxes(el, { u1: [300, 40, 400, 60], u2: [420, 72, 480, 92], u3: [420, 104, 500, 124], u4: [560, 140, 571, 151] });
      drawLinks(el.querySelector<HTMLElement>("[data-timeline]")!);
      spy.mockRestore();
      const d = (link: string) => el.querySelector(`[data-tl-link="${link}"]`)!.getAttribute("d");
      expect(d("u1:u2")).toBe("M400 50 H408 V82 H420");
      expect(d("u2:u4")).toBe("M480 82 H488 V145.5 H560");
    });

    it("does nothing while the timeline has no size (Planner hidden) or has no links", () => {
      const el = host(renderTimeline(linked(), "#Project", new Set()));
      const spy = boxes(el, { u1: [300, 40, 400, 60], u2: [420, 72, 480, 92], u3: [420, 104, 500, 124], u4: [560, 140, 571, 151] }, 0);
      drawLinks(el.querySelector<HTMLElement>("[data-timeline]")!);
      expect(el.querySelector("[data-tl-link]")!.hasAttribute("d")).toBe(false);
      const none = host(renderTimeline(emptyLayout(), "#Project", new Set()));
      const calls = spy.mock.calls.length;
      drawLinks(none.querySelector<HTMLElement>("[data-timeline]")!);
      expect(spy.mock.calls.length).toBe(calls); // returns before measuring anything
      spy.mockRestore();
    });
  });

  it("stylesheet: the svg covers the timeline above the backdrop, ignores the pointer, and strokes in a neutral token", () => {
    expect(timelineCss).toMatch(/\.pl-tl-links\s*\{[^}]*position:\s*absolute[^}]*pointer-events:\s*none/);
    expect(timelineCss).toMatch(/\.pl-tl-links\s*\{[^}]*z-index:\s*1/);
    expect(timelineCss).toMatch(/\.pl-tl-link\s*\{[^}]*stroke-width:\s*1\.5/);
  });
});
