import { describe, expect, it } from "vitest";
import { loadTagInfos } from "./schema";
import { loadNodesAndTasks } from "./queries";
import { titlesByUuid } from "./display-title";
import { viewItems } from "./layout-common";
import {
  calendarRange, layoutCalendar, MONTH_SLOTS, shiftCalendarAnchor, type CalendarInput, type CalendarLayout, type CalendarView,
} from "./calendar-layout";
import { fixtureDq } from "../ui/test-fakes";
import type { LocalDate, PlannerNode, PlannerTask, TagInfo } from "../types";

const dq = fixtureDq();
const tags = await loadTagInfos(dq);
const tag = (title: string): TagInfo => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
const west5 = () => -300;
const dateIdent = (t: TagInfo, title: string) => t.dateProps.find((p) => p.title === title)!.ident;
const statusValues = tags.flatMap((t) => t.choiceProps).find((p) => p.ident === ":logseq.property/status")!.values;
const TODAY = "2026-10-03"; // a Saturday
const d = (day: string, time: string | null = null): LocalDate => ({ day, time });

/** Lays the fixture nodes of `tagTitle` out with the tag's default Start/End (Meeting: Date only). */
async function layout(tagTitle: string, view: CalendarView, over: Partial<CalendarInput> = {}): Promise<CalendarLayout> {
  const t = tag(tagTitle);
  const { nodes, tasks } = await loadNodesAndTasks(dq, tags, [t], { childTags: true, zone: west5 });
  const start = t.dateProps.find((p) => p.title === "Start" || p.title === "Date")!.ident;
  const end = t.dateProps.find((p) => p.title === "End")?.ident ?? null;
  return layoutCalendar({
    items: viewItems(nodes, tasks, () => ({ start: start, end: end }), statusValues), layout: view, anchor: TODAY, today: TODAY, weekStart: 0,
    statusValues, titles: titlesByUuid(nodes), ...over,
  });
}

/** Synthetic Project nodes: [title, start, end|null]; tasks optional. */
function synthetic(spec: [string, string, string | null][], view: CalendarView, over: Partial<CalendarInput> = {}, tasks: PlannerTask[] = []) {
  const p = tag("Project");
  const s = dateIdent(p, "Start");
  const e = dateIdent(p, "End");
  const nodes: PlannerNode[] = spec.map(([title, start, end], i) => ({
    id: i + 1, uuid: `u${i + 1}`, title, tagIds: [], tag: "", dependsOn: [], dates: { [s]: d(start), ...(end ? { [e]: d(end) } : {}) }, choices: {},
  }));
  return layoutCalendar({
    items: viewItems(nodes, tasks, () => ({ start: s, end: e }), statusValues), layout: view, anchor: TODAY, today: TODAY, weekStart: 0, statusValues,
    titles: titlesByUuid(nodes), ...over,
  });
}

const week = (l: CalendarLayout, start: string) => {
  const w = l.weeks.find((x) => x.start === start);
  if (!w) throw new Error(`no week ${start}`);
  return w;
};
const band = (l: CalendarLayout, weekStart: string, title: string) => week(l, weekStart).bands.find((b) => b.title === title);
const dayOf = (l: CalendarLayout, day: string) => l.weeks.flatMap((w) => w.days).find((x) => x.day === day)!;
const chipsOn = (l: CalendarLayout, day: string) =>
  l.weeks.flatMap((w) => w.chips.filter((c) => w.days[c.at].day === day));

describe("month grid", () => {
  it("October 2026 (starts on a Thursday), Sunday start: five whole weeks, outside days flagged", async () => {
    const l = await layout("Project", "month");
    expect(l.range).toEqual({ start: "2026-09-27", end: "2026-10-31", label: "October 2026" });
    expect(l.weeks.map((w) => w.start)).toEqual(["2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"]);
    expect(l.weeks.every((w) => w.days.length === 7)).toBe(true);
    expect(l.weekdays).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(l.weeks[0].days.map((x) => [x.day, x.label, x.outside])).toEqual([
      ["2026-09-27", "27", true], ["2026-09-28", "28", true], ["2026-09-29", "29", true], ["2026-09-30", "30", true],
      ["2026-10-01", "1", false], ["2026-10-02", "2", false], ["2026-10-03", "3", false],
    ]);
    expect(dayOf(l, TODAY).today).toBe(true);
    expect(l.weeks.flatMap((w) => w.days).filter((x) => x.today)).toHaveLength(1);
    expect(dayOf(l, "2026-10-04").weekend).toBe(true);
    expect(dayOf(l, "2026-10-05").weekend).toBe(false);
  });

  it("Monday start: weekday headers and weeks start on Monday", async () => {
    const l = await layout("Project", "month", { weekStart: 1 });
    expect(l.weekdays).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(l.weeks.map((w) => w.start)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(l.range).toMatchObject({ start: "2026-09-28", end: "2026-11-01" });
  });

  it("a month starting on the week start has no leading days (Feb 2026, Sunday start: exactly four weeks)", () => {
    const r = calendarRange("month", "2026-02-14", 0);
    expect(r).toEqual({ start: "2026-02-01", end: "2026-02-28", label: "February 2026" });
  });

  it("a month needing six week rows (August 2026 starts on a Saturday)", () => {
    expect(calendarRange("month", "2026-08-10", 0)).toMatchObject({ start: "2026-07-26", end: "2026-09-05" });
    const l = synthetic([], "month", { anchor: "2026-08-10" });
    expect(l.weeks).toHaveLength(6);
  });

  it("a month spanning a DST change (US: 1 Nov 2026) has 35 distinct consecutive days", () => {
    const l = synthetic([["Over DST", "2026-10-30", "2026-11-03"]], "month", { anchor: "2026-11-15" });
    const days = l.weeks.flatMap((w) => w.days.map((x) => x.day));
    expect(days[0]).toBe("2026-11-01");
    expect(days).toHaveLength(35);
    expect(new Set(days).size).toBe(35);
    expect(days.slice(0, 3)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(week(l, "2026-11-01").bands[0]).toMatchObject({ from: 0, to: 3, continuesBefore: true, continuesAfter: false });
  });

  it("December → January: next from December is January of the next year; the grid crosses the year", () => {
    expect(shiftCalendarAnchor("2026-12-17", "month", 1)).toBe("2027-01-01");
    expect(shiftCalendarAnchor("2027-01-31", "month", -1)).toBe("2026-12-01");
    expect(calendarRange("month", "2026-12-01", 0)).toEqual({ start: "2026-11-29", end: "2027-01-02", label: "December 2026" });
    const jan = calendarRange("month", "2027-01-01", 0);
    expect(jan).toEqual({ start: "2026-12-27", end: "2027-02-06", label: "January 2027" });
  });
});

describe("week grid", () => {
  it("seven day columns of the anchor's week, labelled with weekday and day", async () => {
    const l = await layout("Project", "week");
    expect(l.range).toEqual({ start: "2026-09-27", end: "2026-10-03", label: "27 Sep – 3 Oct 2026" });
    expect(l.weeks).toHaveLength(1);
    expect(l.weeks[0].days.map((x) => x.label)).toEqual(["Sun 27", "Mon 28", "Tue 29", "Wed 30", "Thu 1", "Fri 2", "Sat 3"]);
    expect(l.weeks[0].days.every((x) => !x.outside)).toBe(true);
  });

  it("follows the week start (Monday)", () => {
    expect(calendarRange("week", TODAY, 1)).toEqual({ start: "2026-09-28", end: "2026-10-04", label: "28 Sep – 4 Oct 2026" });
  });

  it("prev / next move by a week", () => {
    expect(shiftCalendarAnchor(TODAY, "week", 1)).toBe("2026-10-10");
    expect(shiftCalendarAnchor(TODAY, "week", -1)).toBe("2026-09-26");
  });

  it("a week across the year end", () => {
    expect(calendarRange("week", "2026-12-31", 0).label).toBe("27 Dec 2026 – 2 Jan 2027");
  });
});

describe("bands (span nodes)", () => {
  it("Project, October: Website relaunch and Acme rollout keep their lanes across every week row", async () => {
    const l = await layout("Project", "month");
    const lanes = (title: string) => l.weeks.map((w) => w.bands.find((b) => b.title === title)?.lane ?? null);
    expect(lanes("Website relaunch")).toEqual([0, 0, 0, 0, null]);
    expect(lanes("Acme rollout")).toEqual([1, 1, null, null, null]);
  });

  it("splits a band at week edges with continuation flags", async () => {
    const l = await layout("Project", "month");
    expect(band(l, "2026-09-27", "Website relaunch")).toMatchObject({ from: 0, to: 7, continuesBefore: true, continuesAfter: true, kind: "mapped" });
    expect(band(l, "2026-10-18", "Website relaunch")).toMatchObject({ from: 0, to: 6, continuesBefore: true, continuesAfter: false });
    expect(band(l, "2026-09-27", "Acme rollout")).toMatchObject({ from: 3, to: 7, continuesBefore: false, continuesAfter: true });
    expect(band(l, "2026-10-04", "Acme rollout")).toMatchObject({ from: 0, to: 5, continuesBefore: true, continuesAfter: false });
  });

  it("lanes stay stable when an earlier band ends: a later band does not jump lanes between weeks", () => {
    // A (Oct 1–6) lane 0, B (Oct 2–20) lane 1. In week 11 Oct A is gone but B stays in lane 1.
    const l = synthetic([["A", "2026-10-01", "2026-10-06"], ["B", "2026-10-02", "2026-10-20"], ["C", "2026-10-08", "2026-10-09"]], "month");
    const lanes = (title: string) => l.weeks.map((w) => w.bands.find((b) => b.title === title)?.lane ?? null);
    expect(lanes("A")).toEqual([0, 0, null, null, null]);
    expect(lanes("B")).toEqual([1, 1, 1, 1, null]);
    expect(lanes("C")).toEqual([null, 0, null, null, null]); // reuses lane 0 once A has ended
  });

  it("labels bands like Timeline rows, adding the continuation", async () => {
    const l = await layout("Project", "month");
    expect(band(l, "2026-10-18", "Website relaunch")!.label).toBe("Website relaunch, 23 Sep – 23 Oct, 1 of 2 done, continues from the previous week");
    expect(band(l, "2026-09-27", "Acme rollout")!.label).toBe("Acme rollout, 30 Sep – 8 Oct, 0 of 1 done, continues next week");
  });

  it("derived spans are bands flagged derived", async () => {
    const t = tag("Project");
    const { nodes, tasks } = await loadNodesAndTasks(dq, tags, [t], { childTags: true, zone: west5 });
    const bare = nodes.map((n) => (n.title === "Mobile app" ? { ...n, dates: {} } : n));
    const l = layoutCalendar({
      items: viewItems(bare, tasks, () => ({ start: dateIdent(t, "Start"), end: dateIdent(t, "End") }), statusValues), layout: "month", anchor: TODAY, today: TODAY,
      weekStart: 0, statusValues, titles: titlesByUuid(nodes),
    });
    expect(band(l, "2026-10-04", "Mobile app")).toMatchObject({ kind: "derived", from: 5, to: 6 }); // Wireframes, Scheduled 9 Oct
  });

  it("carries the node's category colour (same function as the Timeline)", async () => {
    const l = await layout("Project", "month");
    const b = band(l, "2026-09-27", "Website relaunch")!;
    expect(b.cat).toBeGreaterThanOrEqual(1);
    expect(b.cat).toBeLessThanOrEqual(6);
  });
});

describe("chips", () => {
  it("point nodes are chips on their day (Project: Mobile app on 8 Oct, below the two bands)", async () => {
    const l = await layout("Project", "month");
    const [c] = chipsOn(l, "2026-10-08");
    expect(c).toMatchObject({ kind: "point", title: "Mobile app", uuid: "6a000000-0000-4000-8000-000000000002", row: 2, late: false, at: 4 });
    expect(c.label).toBe("Mobile app, 8 Oct, 0 of 1 done");
  });

  it("linked tasks' deadlines are chips in their node's colour; open past deadlines are late; Scheduled is not shown", async () => {
    const l = await layout("Project", "month");
    const site = band(l, "2026-09-27", "Website relaunch")!;
    const acme = band(l, "2026-09-27", "Acme rollout")!;
    const [draft] = chipsOn(l, "2026-10-05");
    expect(draft).toMatchObject({ kind: "deadline", title: "Draft brief Website relaunch", node: "Website relaunch", cat: site.cat, late: false, done: false, status: "todo" });
    expect(draft.date).toEqual(d("2026-10-05", "17:00"));
    expect(draft.time).toBe("17:00");
    expect(draft.label).toBe("Draft brief Website relaunch, Todo, due 5 Oct 17:00, Website relaunch");
    const [contract] = chipsOn(l, "2026-10-02");
    expect(contract).toMatchObject({ kind: "deadline", title: "Acme contract", node: "Acme rollout", cat: acme.cat, late: true });
    expect(contract.label).toBe("Acme contract, Todo, due 2 Oct 12:00, late, Acme rollout");
    expect(chipsOn(l, "2026-10-09")).toEqual([]); // Wireframes has Scheduled 9 Oct only
  });

  it("a task with only a past Scheduled date has no chip (Scheduled is not shown), so lateness adds none", () => {
    const task: PlannerTask = { id: 8, uuid: "t8", title: "Sched only", status: null, isNode: false, nodeIds: [1], deadline: null, scheduled: d("2026-10-01") };
    const l = synthetic([["One", "2026-10-01", "2026-10-02"]], "month", {}, [task]);
    expect(chipsOn(l, "2026-10-01").filter((c) => c.kind === "deadline")).toEqual([]);
  });

  it("a task linked to two nodes gives one chip, in the first node's colour", () => {
    const task: PlannerTask = { id: 9, uuid: "t9", title: "Shared", status: null, isNode: false, nodeIds: [1, 2], deadline: d("2026-10-14"), scheduled: null };
    const l = synthetic([["One", "2026-10-12", "2026-10-13"], ["Two", "2026-10-20", null]], "month", {}, [task]);
    expect(chipsOn(l, "2026-10-14")).toHaveLength(1);
    expect(chipsOn(l, "2026-10-14")[0].node).toBe("One");
  });

  it("Meeting, week of 27 Sep: Kickoff carries its time; Late review 4 Oct 23:45 is in the next week", async () => {
    const l = await layout("Meeting", "week");
    const [kick] = chipsOn(l, TODAY);
    expect(kick).toMatchObject({ kind: "point", title: "Kickoff", time: "10:30", row: 0 });
    expect(kick.label).toBe("Kickoff, 3 Oct 10:30");
    const next = await layout("Meeting", "week", { anchor: "2026-10-04" });
    expect(chipsOn(next, "2026-10-04")[0]).toMatchObject({ title: "Late review", time: "23:45" });
  });

  it("Week: untimed chips first, then by time (then title); rows stack below the bands", () => {
    const p = tag("Project");
    const s = dateIdent(p, "Start");
    const e = dateIdent(p, "End");
    const node = (id: number, title: string, start: LocalDate, end?: LocalDate): PlannerNode =>
      ({ id, uuid: `u${id}`, title, tagIds: [], tag: "", dependsOn: [], dates: { [s]: start, ...(end ? { [e]: end } : {}) }, choices: {} });
    const nodes = [
      node(1, "Span", d("2026-09-28"), d("2026-10-02")),
      node(2, "Late one", d("2026-09-30", "16:00")), node(3, "Early one", d("2026-09-30", "08:15")),
      node(4, "Untimed b", d("2026-09-30")), node(5, "Untimed a", d("2026-09-30")),
    ];
    const l = layoutCalendar({ items: viewItems(nodes, [], () => ({ start: s, end: e }), statusValues), layout: "week", anchor: TODAY, today: TODAY, weekStart: 0, statusValues, titles: new Map() });
    const chips = chipsOn(l, "2026-09-30");
    expect(chips.map((c) => [c.title, c.time, c.row])).toEqual([
      ["Untimed a", null, 1], ["Untimed b", null, 2], ["Early one", "08:15", 3], ["Late one", "16:00", 4],
    ]);
    expect(l.weeks[0].rows).toBe(5);
    expect(dayOf(l, "2026-09-30").more).toBe(0);
  });
});

describe("Month overflow", () => {
  // Four overlapping bands (lanes 0–3) over 5–7 Oct and two point nodes on 6 Oct.
  const spec: [string, string, string | null][] = [
    ["A", "2026-10-05", "2026-10-07"], ["B", "2026-10-05", "2026-10-07"], ["C", "2026-10-05", "2026-10-07"], ["D", "2026-10-05", "2026-10-07"],
    ["P1", "2026-10-06", null], ["P2", "2026-10-06", null], ["Q", "2026-10-08", null],
  ];

  it(`shows ${MONTH_SLOTS} lanes per day and counts the rest as "+N more"`, () => {
    expect(MONTH_SLOTS).toBe(3);
    const l = synthetic(spec, "month");
    const w = week(l, "2026-10-04");
    expect(w.bands.map((b) => [b.title, b.lane])).toEqual([["A", 0], ["B", 1], ["C", 2]]); // D (lane 3) is hidden
    expect(dayOf(l, "2026-10-05").more).toBe(1);
    expect(dayOf(l, "2026-10-06").more).toBe(3); // D + P1 + P2
    expect(chipsOn(l, "2026-10-06")).toEqual([]);
    expect(dayOf(l, "2026-10-08").more).toBe(0);
    expect(chipsOn(l, "2026-10-08")[0]).toMatchObject({ title: "Q", row: 0 }); // a free day fills from the top
    expect(w.rows).toBe(3);
  });

  it("chips take free slots under shorter bands", () => {
    const l = synthetic([["A", "2026-10-05", "2026-10-07"], ["B", "2026-10-06", "2026-10-07"], ["P", "2026-10-05", null]], "month");
    expect(chipsOn(l, "2026-10-05")[0]).toMatchObject({ title: "P", row: 1 }); // B does not cover 5 Oct
  });

  it("Week shows everything: all lanes, no '+N more'", () => {
    const l = synthetic(spec, "week", { anchor: "2026-10-06" });
    expect(l.weeks[0].bands.map((b) => b.lane)).toEqual([0, 1, 2, 3]);
    expect(chipsOn(l, "2026-10-06").map((c) => [c.title, c.row])).toEqual([["P1", 4], ["P2", 5]]);
    expect(l.weeks[0].days.every((x) => x.more === 0)).toBe(true);
  });
});

describe("undated", () => {
  it("lists nodes without any date apart, by title", async () => {
    expect((await layout("Project", "month")).undated.map((u) => u.title)).toEqual(["Archive cleanup"]);
    expect((await layout("Meeting", "week")).undated.map((u) => u.title)).toEqual(["Untimed meeting"]);
  });
});

describe("navigation", () => {
  it("month prev / next go to the first of the adjacent month", () => {
    expect(shiftCalendarAnchor(TODAY, "month", 1)).toBe("2026-11-01");
    expect(shiftCalendarAnchor(TODAY, "month", -1)).toBe("2026-09-01");
    expect(shiftCalendarAnchor("2026-03-31", "month", -1)).toBe("2026-02-01");
  });
});
