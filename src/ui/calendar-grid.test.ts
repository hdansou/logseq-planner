// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq, noDateWrites, noWrites } from "./test-fakes";
import { HOUR_PX, LABEL_ROOM_PX, SHORT_BLOCK_MIN } from "./calendar";
import calendarCss from "./calendar.css?inline";

const TODAY = "2026-10-03"; // a Saturday
const DRAFT = "6a000000-0000-4000-8000-000000000021"; // a task of Website relaunch: Deadline 5 Oct 17:00

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let openNode: ReturnType<typeof vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>>;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
/** An item's placement: on its drag holder for a band or chip (N69), else on the element. */
const style = (el: Element | null) => (el?.closest(".pl-cal-item") ?? el)?.getAttribute("style") ?? "";
const click = async (sel: string, init: MouseEventInit = {}) => {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
  await ws.idle();
};

async function setup(tagTitle: string, layout: string, time = "13:30") {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  openNode = vi.fn();
  ws = createWorkspace(root, {
    dq: fixtureDq(), views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode, zone: () => -300, today: () => TODAY, time: () => time,
    kanban: noWrites, dates: noDateWrites, weekStart: async () => 0,
  });
  await ws.open();
  await click(`[data-tag-id="${tags.find((t) => t.title === tagTitle)!.id}"]`);
  await click("[data-view-kind=calendar]");
  await click(`[data-cal-layout=${layout}]`);
}
afterEach(() => ws?.stop());

describe("3 days (N46)", () => {
  beforeEach(() => setup("Meeting", "3days"));

  it("the switch lists Day, 3 days, Week, Month; 3 days is pressed and stored in the config", () => {
    expect($$("[data-region=view-toolbar] [data-cal-layout]").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
      .toEqual([["Day", "false"], ["3 days", "true"], ["Week", "false"], ["Month", "false"]]);
    expect(ws.config()).toMatchObject({ kind: "calendar", layout: "3days" });
    expect($("[data-calendar]")!.dataset.layout).toBe("3days");
  });

  it("yesterday, today and tomorrow, today marked; the arrows move three days, Today returns", async () => {
    expect(text("[data-cal-range]")).toBe("2 – 4 Oct 2026");
    expect($$("[data-cg-day]").map((d) => d.querySelector(".pl-cal-num")!.textContent)).toEqual(["Fri 2", "Sat 3", "Sun 4"]);
    expect($("[data-cg-day][data-today]")!.dataset.cgDay).toBe(TODAY);
    await click("[data-cal-nav=next]");
    expect(text("[data-cal-range]")).toBe("5 – 7 Oct 2026");
    await click("[data-cal-nav=prev]");
    await click("[data-cal-nav=prev]");
    expect(text("[data-cal-range]")).toBe("29 Sep – 1 Oct 2026");
    await click("[data-cal-nav=today]");
    expect(text("[data-cal-range]")).toBe("2 – 4 Oct 2026");
  });

  it("an hour axis of 24 labelled lines and one body column per day", () => {
    expect($$("[data-cg-hour]").map((h) => h.textContent)).toEqual(Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`));
    expect($$("[data-cg-col]").map((c) => c.dataset.cgCol)).toEqual(["2026-10-02", TODAY, "2026-10-04"]);
  });

  it("a timed item is a block on its day, placed by minute, with its title and time", () => {
    const kick = $(`[data-cg-col="${TODAY}"] [data-cg-block]`)!;
    expect(kick.textContent).toContain("Kickoff");
    expect(kick.querySelector("[data-cg-time]")!.textContent).toBe("10:30");
    expect(style(kick)).toContain("--pl-start: 630");
    expect(style(kick)).toContain("--pl-len: 30");
    expect(style(kick)).toContain("--pl-col: 0");
    expect(style(kick)).toContain("--pl-cols: 1");
    expect(kick.getAttribute("aria-label")).toBe("Kickoff, 3 Oct 10:30");
    expect($(`[data-cg-col="2026-10-04"] [data-cg-block]`)!.textContent).toContain("Late review");
  });

  it("a short block (a point or deadline: 30 minutes, 23 px) is marked, so its title and time share one line instead of the title being clipped", () => {
    const blocks = $$("[data-cg-block]");
    expect(blocks.length).toBeGreaterThan(1);
    for (const b of blocks) {
      const len = Number(/--pl-len:\s*(\d+)/.exec(style(b))![1]);
      expect(b.hasAttribute("data-cg-short"), `${b.textContent} (${len} min)`).toBe(len <= SHORT_BLOCK_MIN);
    }
    expect($(`[data-cg-col="${TODAY}"] [data-cg-block]`)!.hasAttribute("data-cg-short")).toBe(true);
  });

  it("the now line is in today's column at the current time, with a marker on the axis", () => {
    const now = $(`[data-cg-col="${TODAY}"] [data-cg-now]`)!;
    expect(style(now)).toContain("--pl-start: 810");
    expect($$("[data-cg-now]")).toHaveLength(1);
    expect($("[data-cg-now-mark]")).not.toBeNull();
  });

  it("opens scrolled so now is an hour and a half down: 12:00", () => {
    expect($("[data-region=view]")!.scrollTop).toBe(12 * HOUR_PX - LABEL_ROOM_PX);
  });

  it("a click on a block opens its node (Shift: the sidebar)", async () => {
    const uuid = $("[data-cg-block]")!.dataset.calOpen!;
    await click("[data-cg-block]");
    expect(openNode).toHaveBeenLastCalledWith(uuid, { sidebar: false });
    await click("[data-cg-block]", { shiftKey: true });
    expect(openNode).toHaveBeenLastCalledWith(uuid, { sidebar: true });
  });

  it("untimed items are in the all-day row, not in the hours", () => {
    expect($("[data-cg-allday]")).not.toBeNull();
    expect($("[data-cg-allday] [data-cg-block]")).toBeNull();
    expect($$("[data-cg-body] [data-cal-chip], [data-cg-body] [data-cal-band]")).toHaveLength(0);
  });
});

describe("a task block (N46)", () => {
  it("a task's timed Deadline is a flagged block with its node, in its day's column", async () => {
    await setup("Project", "3days");
    await click("[data-cal-nav=next]"); // 5 – 7 Oct
    const draft = $(`[data-cg-col="2026-10-05"] [data-cg-block][data-cal-open="${DRAFT}"]`)!;
    expect(draft.dataset.cgBlock).toBe("deadline");
    expect(draft.textContent).toContain("⚑");
    expect(draft.querySelector("[data-cg-time]")!.textContent).toBe("17:00");
    expect(draft.querySelector("[data-cal-node]")!.textContent).toBe("Website relaunch");
  });

  it("Project spans over the range are bands in the all-day row, after the hour axis column", async () => {
    await setup("Project", "3days");
    const band = $("[data-cg-allday] [data-cal-band]")!;
    expect(style(band)).toMatch(/grid-column: \d+ \/ \d+/);
    expect(Number(/grid-column: (\d+)/.exec(style(band))![1])).toBeGreaterThanOrEqual(2);
  });
});

describe("Day", () => {
  it("one column, labelled with the weekday and date; the arrows move a day", async () => {
    await setup("Meeting", "day");
    expect(text("[data-cal-range]")).toBe("Sat 3 Oct 2026");
    expect($$("[data-cg-day]")).toHaveLength(1);
    await click("[data-cal-nav=next]");
    expect(text("[data-cal-range]")).toBe("Sun 4 Oct 2026");
    expect($("[data-cg-block]")!.textContent).toContain("Late review");
  });
});

describe("opening scroll", () => {
  it("a day with no now and no block opens at 08:00; a new range scrolls again, a redraw of the same one keeps the user's scroll", async () => {
    await setup("Meeting", "3days", "13:30");
    await click("[data-cal-nav=next]"); // 5 – 7 Oct: today is out of range, no blocks
    expect($("[data-region=view]")!.scrollTop).toBe(8 * HOUR_PX - LABEL_ROOM_PX);
    $("[data-region=view]")!.scrollTop = 777;
    await ws.refresh();
    expect($("[data-region=view]")!.scrollTop).toBe(777);
  });
});

describe("keeping the scroll", () => {
  it("an action that redraws the same range (Today, where we are; another control) keeps where the user scrolled", async () => {
    await setup("Meeting", "3days");
    $("[data-region=view]")!.scrollTop = 321;
    await click("[data-cal-nav=today]");
    expect($("[data-region=view]")!.scrollTop).toBe(321);
    await click("[data-cal-nav=next]");
    expect($("[data-region=view]")!.scrollTop).not.toBe(321); // a new range opens at its focus minute
  });
});

describe("stylesheet", () => {
  it("keeps the hour height equal to the constant the scroll uses", () => {
    expect(calendarCss).toMatch(new RegExp(`--pl-cg-hour:\\s*${HOUR_PX}px`));
  });

  it("lays a short block out as one row, title taking what is left and the time never shrinking", () => {
    const rule = /\.pl-cg-block\[data-cg-short\]\s*{([^}]*)}/.exec(calendarCss)?.[1] ?? "";
    expect(rule).toMatch(/flex-direction:\s*row/);
    expect(calendarCss).toMatch(/\.pl-cg-block\[data-cg-short\]\s+\.pl-cg-time[^{]*{[^}]*flex:\s*none/);
    expect(calendarCss).toMatch(/\.pl-cg-block\[data-cg-short\]\s+\.pl-cg-title\s*{[^}]*flex:\s*1 1 auto/);
  });
});
