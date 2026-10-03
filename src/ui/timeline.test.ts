// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq } from "./test-fakes";
import timelineCss from "./timeline.css?inline";

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
  ws = createWorkspace(root, { dq: fixtureDq(), views: store, onClose: vi.fn(), openNode, zone: () => -300, today: () => TODAY, weekStart: async () => 0 });
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`);
});

describe("toolbar", () => {
  it("shows the zoom switch (Month by default), prev / today / next and the range label", () => {
    expect($$("[data-region=view-toolbar] [data-tl-zoom]").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
      .toEqual([["Week", "false"], ["Month", "true"], ["Quarter", "false"]]);
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

  it("is only shown for the Timeline; kinds not built yet keep their placeholder", async () => {
    await click("[data-view-kind=calendar]");
    expect($("[data-tl-zoom]")).toBeNull();
    expect($("[data-timeline]")).toBeNull();
    await click("[data-view-kind=agenda]");
    expect($("[data-tl-zoom]")).toBeNull();
    expect(text("[data-region=view-placeholder]")).toContain("Agenda");
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

  it("shows a node wholly outside the range as an edge hint, not a bar", async () => {
    for (let i = 0; i < 4; i++) await click("[data-tl-nav=next]");
    const outside = rowOf("Acme rollout").querySelector<HTMLElement>("[data-tl-outside]")!;
    expect(outside.dataset.tlOutside).toBe("before");
    expect(outside.textContent).toContain("30 Sep");
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
    expect(timelineCss).toMatch(/grid-template-columns:\s*var\(--pl-tl-label-w\)\s+repeat\(var\(--pl-tl-days\),\s*var\(--pl-tl-day\)\)/);
  });
});
