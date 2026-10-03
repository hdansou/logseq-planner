// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos, type Dq } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq } from "./test-fakes";
import calendarCss from "./calendar.css?inline";

const TODAY = "2026-10-03";
const SITE = "6a000000-0000-4000-8000-000000000001";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const ACME = "6a000000-0000-4000-8000-000000000003";
const ARCHIVE = "6a000000-0000-4000-8000-000000000004";
const DRAFT = "6a000000-0000-4000-8000-000000000021";
const CONTRACT = "6a000000-0000-4000-8000-000000000025";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let openNode: ReturnType<typeof vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>>;
let store: ReturnType<typeof createViewStore>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const style = (el: Element | null) => el?.getAttribute("style") ?? "";

async function click(sel: string, init: MouseEventInit = {}) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
  await ws.idle();
}

/** Opens the Planner on #Project (or `tagTitle`) in the Calendar. */
async function setup(opts: { dq?: Dq; weekStart?: number; tagTitle?: string } = {}) {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  openNode = vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>();
  store = createViewStore(fakeStorage());
  ws = createWorkspace(root, {
    dq: opts.dq ?? fixtureDq(), views: store, onClose: vi.fn(), openNode, zone: () => -300, today: () => TODAY,
    weekStart: async () => opts.weekStart ?? 0,
  });
  await ws.open();
  await click(`[data-tag-id="${tag(opts.tagTitle ?? "Project").id}"]`);
  await click("[data-view-kind=calendar]");
}

/** Bands of `uuid` in week row `week`. */
const bandsIn = (week: string, uuid: string) => $$(`[data-cal-week="${week}"] [data-cal-band][data-cal-open="${uuid}"]`);
const chip = (uuid: string) => $(`[data-cal-chip][data-cal-open="${uuid}"]`);

beforeEach(() => setup());

describe("toolbar", () => {
  it("shows the Month / Week switch (Month by default), prev / today / next and the month as the range label", () => {
    expect($$("[data-region=view-toolbar] [data-cal-layout]").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
      .toEqual([["Month", "true"], ["Week", "false"]]);
    for (const nav of ["prev", "today", "next"]) expect($(`[data-region=view-toolbar] [data-cal-nav=${nav}]`)!.tagName).toBe("BUTTON");
    expect($("[data-cal-nav=next]")!.getAttribute("aria-label")).toBe("Next");
    expect(text("[data-cal-range]")).toBe("October 2026");
    expect($("[data-tl-zoom]")).toBeNull();
    expect($("[data-region=view-placeholder]")).toBeNull();
  });

  it("prev / next move by a month, Today returns; the anchor is session state, not config", async () => {
    const before = JSON.stringify(ws.config());
    await click("[data-cal-nav=next]");
    expect(text("[data-cal-range]")).toBe("November 2026");
    expect($("[data-cal-day][data-today]")).toBeNull();
    await click("[data-cal-nav=prev]");
    await click("[data-cal-nav=prev]");
    expect(text("[data-cal-range]")).toBe("September 2026");
    await click("[data-cal-nav=today]");
    expect(text("[data-cal-range]")).toBe("October 2026");
    expect(JSON.stringify(ws.config())).toBe(before);
  });

  it("the layout is view config, saved with a view", async () => {
    await click("[data-cal-layout=week]");
    expect(ws.config()).toMatchObject({ kind: "calendar", layout: "week" });
    expect($("[data-cal-layout=week]")!.getAttribute("aria-pressed")).toBe("true");
    expect($("[data-calendar]")!.dataset.layout).toBe("week");
    const create = vi.spyOn(store, "create");
    await click("[data-control=saved-views]");
    await click("[data-action=save-view]");
    expect(create.mock.calls[0][1]).toMatchObject({ kind: "calendar", layout: "week" });
    expect(create.mock.calls[0][1]).not.toHaveProperty("anchor");
  });

  it("keeps focus on the nav button it re-rendered", async () => {
    $("[data-cal-nav=next]")!.focus();
    await click("[data-cal-nav=next]");
    expect(document.activeElement).toBe($("[data-cal-nav=next]"));
  });
});

describe("Month (October 2026, Sunday start)", () => {
  it("has weekday headers and five week rows of seven days; outside days and today are flagged", () => {
    expect($$("[data-cal-weekdays] span").map((h) => h.textContent)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect($$("[data-cal-week]").map((w) => w.dataset.calWeek)).toEqual(["2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"]);
    expect($$("[data-cal-day]")).toHaveLength(35);
    expect($$("[data-cal-day][data-outside]").map((d) => d.dataset.calDay)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
    const today = $("[data-cal-day][data-today]")!;
    expect(today.dataset.calDay).toBe(TODAY);
    expect(today.querySelector("[aria-current=date]")!.textContent).toBe("3");
    expect($(`[data-cal-day="2026-10-04"]`)!.hasAttribute("data-weekend")).toBe(true);
  });

  it("Monday start: headers and weeks start on Monday", async () => {
    await setup({ weekStart: 1 });
    expect($$("[data-cal-weekdays] span").map((h) => h.textContent)[0]).toBe("Mon");
    expect($$("[data-cal-week]")[0].dataset.calWeek).toBe("2026-09-28");
  });

  it("span nodes are bands on a stable lane, split per week with continuation flags", () => {
    const weeks = ["2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18"];
    for (const w of weeks) {
      const [b] = bandsIn(w, SITE);
      expect(b.tagName).toBe("BUTTON");
      expect(b.dataset.lane).toBe("0");
      expect(style(b)).toContain("grid-row: 2");
    }
    expect(bandsIn("2026-10-25", SITE)).toHaveLength(0);
    const first = bandsIn("2026-09-27", SITE)[0];
    expect(first.hasAttribute("data-cont-before")).toBe(true);
    expect(first.hasAttribute("data-cont-after")).toBe(true);
    expect(style(first)).toContain("grid-column: 1 / 8");
    const last = bandsIn("2026-10-18", SITE)[0];
    expect(last.hasAttribute("data-cont-after")).toBe(false);
    expect(style(last)).toContain("grid-column: 1 / 7");
    expect(last.getAttribute("aria-label")).toBe("Website relaunch, 23 Sep – 23 Oct, 1 of 2 done, continues from the previous week");
    expect(last.textContent).toContain("Website relaunch");

    const acme = bandsIn("2026-09-27", ACME)[0];
    expect(acme.dataset.lane).toBe("1");
    expect(style(acme)).toContain("grid-column: 4 / 8");
    expect(acme.hasAttribute("data-cont-before")).toBe(false);
    expect(bandsIn("2026-10-04", ACME)[0].dataset.lane).toBe("1");
    expect(acme.dataset.cat).toMatch(/^[1-6]$/);
  });

  it("a point node is a chip on its day; task deadlines are chips in their node's colour, late ones flagged", () => {
    const mobile = chip(MOBILE)!;
    expect(mobile.tagName).toBe("BUTTON");
    expect(mobile.dataset.calChip).toBe("point");
    expect(mobile.closest("[data-cal-week]")!.getAttribute("data-cal-week")).toBe("2026-10-04");
    expect(style(mobile)).toContain("grid-column: 5");
    expect(style(mobile)).toContain("grid-row: 4"); // below the two bands
    expect(mobile.getAttribute("aria-label")).toBe("Mobile app, 8 Oct, 0 of 1 done");

    const draft = chip(DRAFT)!;
    expect(draft.dataset.calChip).toBe("deadline");
    expect(draft.dataset.cat).toBe(bandsIn("2026-10-04", SITE)[0].dataset.cat);
    expect(draft.hasAttribute("data-late")).toBe(false);
    expect(draft.textContent).toContain("Draft brief Website relaunch");
    expect(draft.textContent).not.toContain("[[");
    expect(draft.getAttribute("aria-label")).toBe("Draft brief Website relaunch, Todo, due 5 Oct 17:00, Website relaunch");

    const contract = chip(CONTRACT)!;
    expect(contract.hasAttribute("data-late")).toBe(true);
    expect(contract.dataset.cat).toBe(bandsIn("2026-09-27", ACME)[0].dataset.cat);
    expect(contract.getAttribute("aria-label")).toContain("late");
    expect($("[data-cal-chip][data-cal-open='6a000000-0000-4000-8000-000000000024']")).toBeNull(); // Wireframes: Scheduled only
  });

  it("lists undated nodes apart, with buttons that open them", async () => {
    expect(text("[data-cal-undated]")).toBe("No dates: Archive cleanup");
    await click("[data-cal-undated] [data-cal-open]");
    expect(openNode).toHaveBeenCalledWith(ARCHIVE, { sidebar: false });
  });

  it("no '+N more' when everything fits", () => {
    expect($("[data-cal-more]")).toBeNull();
  });
});

describe("'+N more' (Month)", () => {
  // Three copies of Website relaunch push Acme rollout (lane 4) and one copy (lane 3) out of the three visible rows.
  beforeEach(() => setup({ dq: fixtureDq({ projectCopies: 3 }) }));

  it("counts hidden bands and chips per day", () => {
    expect($$("[data-cal-week='2026-09-27'] [data-cal-band]").map((b) => b.dataset.lane)).toEqual(["0", "1", "2"]);
    const more = $("[data-cal-more='2026-10-02']")!;
    expect(more.tagName).toBe("BUTTON");
    expect(more.textContent).toBe("+3 more"); // a copy, Acme rollout and the Acme contract deadline
    expect(more.getAttribute("aria-label")).toBe("3 more on 2 Oct, show the week");
    expect(style(more)).toContain("grid-column: 6");
    expect(style(more)).toContain("grid-row: 5");
    expect(text("[data-cal-more='2026-09-27']")).toBe("+1 more");
    expect(chip(CONTRACT)).toBeNull();
  });

  it("opens the Week layout on that week", async () => {
    await click("[data-cal-more='2026-10-02']");
    expect(ws.config()).toMatchObject({ kind: "calendar", layout: "week" });
    expect(text("[data-cal-range]")).toBe("27 Sep – 3 Oct 2026");
    expect($$("[data-cal-week='2026-09-27'] [data-cal-band]").map((b) => b.dataset.lane)).toEqual(["0", "1", "2", "3", "4"]);
    expect(chip(CONTRACT)).not.toBeNull();
    expect($("[data-cal-more]")).toBeNull();
    expect(document.activeElement).toBe($("[data-cal-layout=week]"));
  });
});

describe("Week", () => {
  it("week of 27 Sep: seven day columns labelled with weekday and day, today marked", async () => {
    await click("[data-cal-layout=week]");
    expect(text("[data-cal-range]")).toBe("27 Sep – 3 Oct 2026");
    expect($("[data-cal-weekdays]")).toBeNull();
    expect($$("[data-cal-day]").map((d) => d.querySelector(".pl-cal-num")!.textContent)).toEqual(["Sun 27", "Mon 28", "Tue 29", "Wed 30", "Thu 1", "Fri 2", "Sat 3"]);
    expect($$("[data-cal-day][data-outside]")).toHaveLength(0);
    expect($("[data-cal-day][data-today]")!.dataset.calDay).toBe(TODAY);
    expect(chip(CONTRACT)!.querySelector("[data-cal-time]")!.textContent).toBe("12:00");
  });

  it("week of 4 Oct: Acme band continues from the previous week, chips carry time labels and the node", async () => {
    await click("[data-cal-layout=week]");
    await click("[data-cal-nav=next]");
    expect(text("[data-cal-range]")).toBe("4 Oct – 10 Oct 2026");
    const acme = bandsIn("2026-10-04", ACME)[0];
    expect(acme.hasAttribute("data-cont-before")).toBe(true);
    expect(style(acme)).toContain("grid-column: 1 / 6");
    const draft = chip(DRAFT)!;
    expect(draft.querySelector("[data-cal-time]")!.textContent).toBe("17:00");
    expect(draft.querySelector("[data-cal-node]")!.textContent).toBe("Website relaunch");
    expect(chip(MOBILE)!.querySelector("[data-cal-time]")).toBeNull(); // a Date, no time
  });

  it("Meeting: chips sorted by time with their time label", async () => {
    await setup({ tagTitle: "Meeting" });
    await click("[data-cal-layout=week]");
    const kick = $("[data-cal-chip][data-cal-open]")!;
    expect(kick.textContent).toContain("Kickoff");
    expect(kick.querySelector("[data-cal-time]")!.textContent).toBe("10:30");
    expect(text("[data-cal-undated]")).toBe("No dates: Untimed meeting");
  });
});

describe("opening nodes", () => {
  it("click on a band opens the node; Shift+click opens it in the right sidebar", async () => {
    await click(`[data-cal-week="2026-09-27"] [data-cal-band][data-cal-open="${SITE}"]`);
    expect(openNode).toHaveBeenLastCalledWith(SITE, { sidebar: false });
    await click(`[data-cal-week="2026-09-27"] [data-cal-band][data-cal-open="${SITE}"]`, { shiftKey: true });
    expect(openNode).toHaveBeenLastCalledWith(SITE, { sidebar: true });
  });

  it("a task chip opens the task block; a point chip its node (Shift: sidebar)", async () => {
    await click(`[data-cal-chip][data-cal-open="${DRAFT}"]`);
    expect(openNode).toHaveBeenLastCalledWith(DRAFT, { sidebar: false });
    await click(`[data-cal-chip][data-cal-open="${MOBILE}"]`, { shiftKey: true });
    expect(openNode).toHaveBeenLastCalledWith(MOBILE, { sidebar: true });
    expect(openNode).toHaveBeenCalledTimes(2);
  });
});

describe("stylesheet (happy-dom does not apply CSS)", () => {
  it("uses tokens only: no colour literals", () => {
    expect(calendarCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const colours = [...calendarCss.matchAll(/(?:^|[;{\s])(?:color|background|border(?:-[a-z]+)?|box-shadow|outline):\s*([^;}]+)/g)].map((m) => m[1]);
    for (const c of colours) expect(c.replace(/var\([^)]*\)/g, "")).not.toMatch(/\b(?:red|green|blue|black|white|gray|grey)\b/);
  });

  it("keeps the fallback stack wherever a font-family is set", () => {
    for (const m of calendarCss.matchAll(/font-family:\s*([^;}]+)/g)) expect(m[1]).toMatch(/var\(--pl-font\)|sans-serif|monospace/);
  });

  it("lays each week row on seven equal columns; day cells span every row; items sit above them", () => {
    expect(calendarCss).toMatch(/\.pl-cal-week\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
    expect(calendarCss).toMatch(/\.pl-cal-day\s*\{[^}]*grid-row:\s*1\s*\/\s*-1/);
    expect(calendarCss).toMatch(/\.pl-cal-band,\s*\.pl-cal-chip\s*\{[^}]*z-index:\s*1/);
  });

  // D1 (live, T09): the first grid row was `auto`, sized by nothing (the number lives in the day cell spanning 1 / -1), so it
  // collapsed to 0px and lane-0 bands covered the day numbers. happy-dom cannot compute track sizes, so this checks the
  // inline template (both layouts) and that the stylesheet's fixed row fits the number's box, today included.
  it("reserves a fixed first row for the day number / label in both layouts, tall enough for the number", async () => {
    const px = (decl: string, rule: string) => {
      const m = new RegExp(`${rule}\\s*\\{[^}]*${decl}:\\s*([^;}]+)`).exec(calendarCss);
      if (!m) throw new Error(`no ${decl} in ${rule}`);
      return m[1].trim();
    };
    const head = Number(/^(\d+(?:\.\d+)?)px$/.exec(px("--pl-cal-head-h", "\\.pl-cal"))![1]);
    const num = Number(/^(\d+)px$/.exec(px("height", "\\.pl-cal-num"))![1]);
    const margins = px("margin", "\\.pl-cal-num").split(/\s+/).map((v) => Number(v.replace("px", "")));
    expect(num + margins[0] + margins[2]).toBeLessThanOrEqual(head);
    // today only recolours and bolds the number: no size, margin or padding change
    expect(calendarCss).not.toMatch(/\[data-today\][^{]*\.pl-cal-num\s*\{[^}]*(?:height|margin|padding|font-size)/);
    for (const layout of ["month", "week"]) {
      await click(`[data-cal-layout=${layout}]`);
      const weeks = $$("[data-cal-week]");
      expect(weeks.length).toBeGreaterThan(0);
      for (const w of weeks) expect(w.style.gridTemplateRows || style(w)).toMatch(/^(?:grid-template-rows:\s*)?var\(--pl-cal-head-h\)\s/);
    }
  });

  it("today in the accent colour; outside days dimmed; titles truncate", () => {
    expect(calendarCss).toMatch(/\[data-today\][^{]*\.pl-cal-num\s*\{[^}]*var\(--pl-today\)[^}]*font-weight:\s*700/);
    expect(calendarCss).toMatch(/\[data-outside\][^{]*\{[^}]*var\(--pl-fill\)/);
    expect(calendarCss).toMatch(/\.pl-cal-band\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it("squares a band's edge where it continues, dashes derived spans, late chips in red", () => {
    expect(calendarCss).toMatch(/\[data-cont-before\]\s*\{[^}]*border-(?:top|bottom)-left-radius:\s*0/);
    expect(calendarCss).toMatch(/\[data-cont-after\]\s*\{[^}]*border-(?:top|bottom)-right-radius:\s*0/);
    expect(calendarCss).toMatch(/\.pl-cal-band\[data-kind="derived"\]\s*\{[^}]*dashed/);
    expect(calendarCss).toMatch(/\.pl-cal-chip\[data-late\]\s*\{[^}]*var\(--pl-red-soft\)[^}]*var\(--pl-red-text\)/);
  });
});
