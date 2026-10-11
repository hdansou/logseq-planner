import { describe, expect, it } from "vitest";
import { loadTagInfos } from "./schema";
import { titlesByUuid } from "./display-title";
import { viewItems } from "./layout-common";
import { calendarRange, layoutCalendar, shiftCalendarAnchor, type CalendarInput, type CalendarView, type TimeGrid } from "./calendar-layout";
import { fixtureDq } from "../ui/test-fakes";
import type { LocalDate, PlannerNode, PlannerTask, TagInfo } from "../types";

const tags = await loadTagInfos(fixtureDq());
const project: TagInfo = tags.find((t) => t.title === "Project")!;
const startIdent = project.dateProps.find((p) => p.title === "Start")!.ident;
const endIdent = project.dateProps.find((p) => p.title === "End")!.ident;
const statusValues = tags.flatMap((t) => t.choiceProps).find((p) => p.ident === ":logseq.property/status")!.values;
const TODAY = "2026-10-03"; // a Saturday
const d = (day: string, time: string | null = null): LocalDate => ({ day, time });

type Spec = { title: string; start: LocalDate; end?: LocalDate };
const nodeOf = (spec: Spec, i: number): PlannerNode => ({
  id: i + 1, uuid: `u${i + 1}`, title: spec.title, tagIds: [], tag: "", links: [], dependsOn: [], choices: {},
  dates: { [startIdent]: spec.start, ...(spec.end ? { [endIdent]: spec.end } : {}) },
});
const task = (id: number, title: string, over: Partial<PlannerTask> = {}): PlannerTask =>
  ({ id, uuid: `t${id}`, title, status: null, nodeIds: [1], isNode: false, deadline: null, scheduled: null, ...over });

function grid(view: CalendarView, specs: Spec[], over: Partial<CalendarInput> = {}, tasks: PlannerTask[] = []): TimeGrid {
  const nodes = specs.map(nodeOf);
  const l = layoutCalendar({
    items: viewItems(nodes, tasks, () => ({ start: startIdent, end: endIdent }), statusValues), layout: view, anchor: TODAY, today: TODAY, time: "13:30",
    weekStart: 0, statusValues, titles: titlesByUuid(nodes), ...over,
  });
  if (!l.grid) throw new Error(`no grid for ${view}`);
  return l.grid;
}
const blocksOn = (g: TimeGrid, day: string) => g.blocks.filter((b) => b.day === day);

describe("range and navigation of the time grids", () => {
  it("3 days: yesterday, today and tomorrow around the anchor", () => {
    expect(calendarRange("3days", TODAY, 0)).toEqual({ start: "2026-10-02", end: "2026-10-04", label: "2 – 4 Oct 2026" });
  });

  it("Day: the anchor, labelled with its weekday", () => {
    expect(calendarRange("day", TODAY, 0)).toEqual({ start: TODAY, end: TODAY, label: "Sat 3 Oct 2026" });
  });

  it("Week: the anchor's week, as before", () => {
    expect(calendarRange("week", TODAY, 0)).toEqual({ start: "2026-09-27", end: "2026-10-03", label: "27 Sep – 3 Oct 2026" });
  });

  it("the arrows move a day, three days, a week", () => {
    expect(shiftCalendarAnchor(TODAY, "day", 1)).toBe("2026-10-04");
    expect(shiftCalendarAnchor(TODAY, "day", -1)).toBe("2026-10-02");
    expect(shiftCalendarAnchor(TODAY, "3days", 1)).toBe("2026-10-06");
    expect(shiftCalendarAnchor(TODAY, "3days", -1)).toBe("2026-09-30");
    expect(shiftCalendarAnchor(TODAY, "week", 1)).toBe("2026-10-10");
  });

  it("3 days over a month end", () => {
    expect(calendarRange("3days", "2026-10-31", 0).label).toBe("30 Oct – 1 Nov 2026");
  });
});

describe("the grid's days and now line", () => {
  it("one column per day, labelled, today and weekend flagged", () => {
    const g = grid("3days", []);
    expect(g.days.map((x) => [x.day, x.label, x.today, x.weekend])).toEqual([
      ["2026-10-02", "Fri 2", false, false], ["2026-10-03", "Sat 3", true, true], ["2026-10-04", "Sun 4", false, true],
    ]);
    expect(grid("week", []).days).toHaveLength(7);
    expect(grid("day", []).days).toHaveLength(1);
  });

  it("the now line is today's current minute; none when today is out of range", () => {
    expect(grid("3days", []).now).toEqual({ day: TODAY, minute: 13 * 60 + 30 });
    expect(grid("3days", [], { anchor: "2026-10-20" }).now).toBeNull();
    expect(grid("3days", [], { time: undefined }).now).toBeNull();
  });

  it("opens at an hour and a half above now; else an hour above the earliest block; else 08:00", () => {
    expect(grid("3days", []).focusMinute).toBe(13 * 60 + 30 - 90);
    expect(grid("3days", [{ title: "Standup", start: d("2026-10-21", "09:30"), end: d("2026-10-21", "10:00") }], { anchor: "2026-10-21" }).focusMinute).toBe(8 * 60 + 30);
    expect(grid("3days", [], { anchor: "2026-10-21" }).focusMinute).toBe(8 * 60);
    expect(grid("3days", [{ title: "Early", start: d("2026-10-21", "00:30"), end: d("2026-10-21", "01:00") }], { anchor: "2026-10-21" }).focusMinute).toBe(0);
  });
});

describe("timed blocks", () => {
  it("a span with Start and End times on one day is a block from Start to End", () => {
    const g = grid("3days", [{ title: "Learn", start: d(TODAY, "20:35"), end: d(TODAY, "21:05") }]);
    expect(blocksOn(g, TODAY)).toEqual([expect.objectContaining({
      kind: "span", uuid: "u1", title: "Learn", startMin: 20 * 60 + 35, endMin: 21 * 60 + 5, timeLabel: "20:35 – 21:05", col: 0, cols: 1,
    })]);
    expect(g.allDay.bands).toEqual([]);
  });

  it("a block shorter than the minimum is drawn at the minimum, its label keeps the real times", () => {
    const g = grid("day", [{ title: "Ping", start: d(TODAY, "09:00"), end: d(TODAY, "09:05") }]);
    expect(g.blocks[0]).toMatchObject({ startMin: 540, endMin: 560, timeLabel: "09:00 – 09:05" });
  });

  it("a one-date node with a time is a 30-minute block at that time", () => {
    const g = grid("day", [{ title: "Review", start: d(TODAY, "16:15") }]);
    expect(g.blocks[0]).toMatchObject({ kind: "point", startMin: 16 * 60 + 15, endMin: 16 * 60 + 45, timeLabel: "16:15" });
  });

  it("a task's timed Scheduled and Deadline are blocks (the Deadline flagged), linked to their node once", () => {
    const g = grid("day", [{ title: "Site", start: d("2026-09-01"), end: d("2026-12-01") }], {}, [
      task(1, "Draft", { scheduled: d(TODAY, "10:00"), deadline: d(TODAY, "17:00") }),
    ]);
    const kinds = g.blocks.map((b) => [b.kind, b.uuid, b.timeLabel, b.node]);
    expect(kinds).toEqual([["scheduled", "t1", "10:00", "Site"], ["deadline", "t1", "17:00", "Site"]]);
  });

  it("a done task is done, an open one past its deadline is late", () => {
    const done = statusValues.find((v) => /done/i.test(v.title))!;
    const g = grid("day", [{ title: "Site", start: d("2026-09-01"), end: d("2026-12-01") }], { time: "18:00" }, [
      task(1, "Shipped", { status: done as never, deadline: d(TODAY, "09:00") }),
      task(2, "Slipped", { deadline: d(TODAY, "11:00") }),
    ]);
    expect(g.blocks.find((b) => b.uuid === "t1")).toMatchObject({ done: true, late: false });
    expect(g.blocks.find((b) => b.uuid === "t2")).toMatchObject({ done: false });
  });

  it("blocks that overlap share the column; a later one that fits goes back to the first", () => {
    const g = grid("day", [
      { title: "A", start: d(TODAY, "09:00"), end: d(TODAY, "10:00") },
      { title: "B", start: d(TODAY, "09:30"), end: d(TODAY, "10:30") },
      { title: "C", start: d(TODAY, "10:00"), end: d(TODAY, "10:30") },
      { title: "D", start: d(TODAY, "14:00"), end: d(TODAY, "15:00") },
    ]);
    const at = (t: string) => g.blocks.find((b) => b.title === t)!;
    expect([at("A").col, at("A").cols]).toEqual([0, 2]);
    expect([at("B").col, at("B").cols]).toEqual([1, 2]);
    expect([at("C").col, at("C").cols]).toEqual([0, 2]);
    expect([at("D").col, at("D").cols]).toEqual([0, 1]);
  });

  it("blocks are on their own day, by start time", () => {
    const g = grid("3days", [
      { title: "Late", start: d("2026-10-04", "22:00"), end: d("2026-10-04", "23:00") },
      { title: "Early", start: d("2026-10-04", "07:00"), end: d("2026-10-04", "08:00") },
      { title: "Today", start: d(TODAY, "12:00"), end: d(TODAY, "13:00") },
    ]);
    expect(blocksOn(g, "2026-10-04").map((b) => b.title)).toEqual(["Early", "Late"]);
    expect(blocksOn(g, TODAY).map((b) => b.title)).toEqual(["Today"]);
    expect(blocksOn(g, "2026-10-02")).toEqual([]);
  });

  it("items outside the range are left out", () => {
    const g = grid("day", [{ title: "Other day", start: d("2026-10-05", "09:00"), end: d("2026-10-05", "10:00") }]);
    expect(g.blocks).toEqual([]);
  });
});

describe("the all-day row", () => {
  it("Date values and spans over several days are bands on stable lanes, with continuation flags", () => {
    const g = grid("3days", [
      { title: "Sprint", start: d("2026-09-28"), end: d("2026-10-03") },
      { title: "Offsite", start: d("2026-10-03", "09:00"), end: d("2026-10-04", "17:00") },
      { title: "One day", start: d("2026-10-04"), end: d("2026-10-04") },
    ]);
    expect(g.allDay.bands.map((b) => [b.title, b.lane, b.from, b.to, b.continuesBefore, b.continuesAfter])).toEqual([
      ["Sprint", 0, 0, 2, true, false],
      ["Offsite", 1, 1, 3, false, false],
      ["One day", 0, 2, 3, false, false],
    ]);
    expect(g.blocks).toEqual([]);
  });

  it("untimed one-date nodes, tasks' untimed Scheduled and Deadline are chips under the bands", () => {
    const g = grid("3days", [{ title: "Launch", start: d(TODAY) }, { title: "Site", start: d("2026-09-01"), end: d("2026-12-01") }], {}, [
      task(1, "Plan", { scheduled: d(TODAY) }),
      task(2, "Ship", { deadline: d("2026-10-04") }),
    ]);
    const chips = g.allDay.chips.map((c) => [c.kind, c.title, c.at]);
    expect(chips).toEqual(expect.arrayContaining([["point", "Launch", 1], ["scheduled", "Plan", 1], ["deadline", "Ship", 2]]));
    expect(g.allDay.rows).toBe(Math.max(...g.allDay.chips.map((c) => c.row + 1), ...g.allDay.bands.map((b) => b.lane + 1)));
  });

  it("nodes without a date are listed apart", () => {
    const nodes = [nodeOf({ title: "Floating", start: d(TODAY) }, 0)];
    delete nodes[0].dates[startIdent];
    const l = layoutCalendar({
      items: viewItems(nodes, [], () => ({ start: startIdent, end: endIdent }), statusValues), layout: "3days", anchor: TODAY, today: TODAY,
      weekStart: 0, statusValues, titles: titlesByUuid(nodes),
    });
    expect(l.undated.map((u) => u.title)).toEqual(["Floating"]);
  });
});
