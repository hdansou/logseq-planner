import { describe, expect, it } from "vitest";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos } from "./schema";
import { loadNodesAndTasks } from "./queries";
import { fixtureDq } from "../ui/test-fakes";
import { titlesByUuid } from "./display-title";
import { viewItems } from "./layout-common";
import { dayFocus, layoutTimeline, shiftAnchor, timelineRange, type TimelineInput, type TimelineLayout, type Zoom } from "./timeline-layout";
import type { LocalDate, PlannerNode, PlannerTask, TagInfo } from "../types";

const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
const tag = (title: string): TagInfo => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
const west5 = () => -300;
const dq = fixtureDq();
const dateIdent = (t: TagInfo, title: string) => t.dateProps.find((p) => p.title === title)!.ident;
const statusValues = tags.flatMap((t) => t.choiceProps).find((p) => p.ident === ":logseq.property/status")!.values;
const TODAY = "2026-10-03"; // a Saturday
const NOW = "13:30";
const d = (day: string, time: string | null = null): LocalDate => ({ day, time });

async function load(tagTitle: string) {
  const t = tag(tagTitle);
  const { nodes, tasks } = await loadNodesAndTasks(dq, tags, [t], { childTags: true, zone: west5 });
  return { t, nodes, tasks };
}

/** Lays the fixture nodes of `tagTitle` out with the tag's default Start/End. */
async function layout(tagTitle: string, zoom: Zoom, over: Partial<TimelineInput> = {}): Promise<TimelineLayout> {
  const { t, nodes, tasks } = await load(tagTitle);
  const start = t.dateProps.find((p) => p.title === "Start" || p.title === "Date")!.ident;
  const end = t.dateProps.find((p) => p.title === "End")?.ident ?? null;
  return layoutTimeline({
    items: viewItems(nodes, tasks, () => ({ start: start, end: end }), statusValues), zoom, anchor: TODAY, today: TODAY, now: NOW, weekStart: 0,
    statusValues, titles: titlesByUuid(nodes), ...over,
  });
}
const row = (l: TimelineLayout, title: string) => {
  const r = l.rows.find((x) => x.title === title);
  if (!r) throw new Error(`no row ${title}`);
  return r;
};

/** One synthetic node with a mapped span (or point when `end` is null) for edge cases. */
function synthetic(start: string, end: string | null, zoom: Zoom, anchor = TODAY, weekStart = 0) {
  const p = tag("Project");
  const s = dateIdent(p, "Start");
  const e = dateIdent(p, "End");
  const node: PlannerNode = { id: 1, uuid: "u1", title: "Edge", tagIds: [], tag: "", dependsOn: [], dates: { [s]: d(start), ...(end ? { [e]: d(end) } : {}) }, choices: {} };
  return layoutTimeline({ items: viewItems([node], [], () => ({ start: s, end: e }), statusValues), zoom, anchor, today: TODAY, now: NOW, weekStart, statusValues, titles: new Map() });
}

describe("calendar days (arithmetic itself: layout-common.test.ts)", () => {
  it("lays a DST week out with seven distinct consecutive day columns and a bar of the right length", () => {
    const l = synthetic("2026-10-30", "2026-11-03", "week", "2026-11-01");
    expect(l.range).toMatchObject({ start: "2026-10-25", end: "2026-11-14", days: 21 });
    const days = l.columns.map((c) => c.start);
    expect(new Set(days).size).toBe(21);
    expect(days.slice(6, 9)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(l.rows[0].bar).toEqual({ from: 5, to: 10, clipStart: false, clipEnd: false });
  });
});

describe("visible range per zoom (week start Sunday, today Sat 3 Oct 2026)", () => {
  it("week: 21 wide day columns from the week before the anchor's week", async () => {
    const l = await layout("Project", "week");
    expect(l.range).toEqual({ start: "2026-09-20", end: "2026-10-10", days: 21, tracks: 21, label: "20 Sep – 10 Oct 2026" });
    expect(l.columns).toHaveLength(21);
    expect(l.columns.every((c) => c.to - c.from === 1)).toBe(true);
    expect(l.columns[0]).toMatchObject({ start: "2026-09-20", end: "2026-09-20", label: "Sun 20", weekend: true, weekStart: true });
    expect(l.columns[13]).toMatchObject({ start: TODAY, today: true, label: "Sat 3" });
  });

  it("month: 56 narrow day columns starting two weeks before the anchor's week, labelled on week starts", async () => {
    const l = await layout("Project", "month");
    expect(l.range).toEqual({ start: "2026-09-13", end: "2026-11-07", days: 56, tracks: 56, label: "13 Sep – 7 Nov 2026" });
    expect(l.columns).toHaveLength(56);
    expect(l.columns.filter((c) => c.label).map((c) => c.label)).toEqual(["13 Sep", "20 Sep", "27 Sep", "4 Oct", "11 Oct", "18 Oct", "25 Oct", "1 Nov"]);
  });

  it("quarter: 17 week columns of seven days each", async () => {
    const l = await layout("Project", "quarter");
    expect(l.range).toEqual({ start: "2026-08-30", end: "2026-12-26", days: 119, tracks: 119, label: "30 Aug – 26 Dec 2026" });
    expect(l.columns).toHaveLength(17);
    expect(l.columns[0]).toMatchObject({ start: "2026-08-30", end: "2026-09-05", from: 0, to: 7, label: "30 Aug" });
    expect(l.columns.every((c) => c.to - c.from === 7 && !c.weekend)).toBe(true);
    expect(l.columns.findIndex((c) => c.today)).toBe(4); // 27 Sep – 3 Oct
  });

  it("marks month starts so the axis can draw the boundary (30 Sep → 1 Oct)", async () => {
    const l = await layout("Project", "month");
    const i = l.columns.findIndex((c) => c.start === "2026-10-01");
    expect(l.columns[i - 1].start).toBe("2026-09-30");
    expect(l.columns[i].monthStart).toBe(true);
    expect(l.columns[i - 1].monthStart).toBe(false);
    const q = await layout("Project", "quarter");
    expect(q.columns.filter((c) => c.monthStart).map((c) => c.start)).toEqual(["2026-08-30", "2026-09-27", "2026-11-01", "2026-11-29"]); // the week column holding a 1st
  });

  it("follows the week start (Monday)", () => {
    expect(timelineRange("week", TODAY, 1)).toMatchObject({ start: "2026-09-21", end: "2026-10-11" });
  });

  it("prev / next move by a week (Week), three weeks (Month) and six weeks (Quarter)", () => {
    expect(shiftAnchor(TODAY, "week", 1)).toBe("2026-10-10");
    expect(shiftAnchor(TODAY, "week", -1)).toBe("2026-09-26");
    expect(shiftAnchor(TODAY, "month", 1)).toBe("2026-10-24");
    expect(shiftAnchor(TODAY, "quarter", -1)).toBe("2026-08-22");
  });

  it("labels a range across a year end with both years", () => {
    expect(timelineRange("week", "2026-12-31", 0).label).toBe("20 Dec 2026 – 9 Jan 2027");
  });
});

describe("rows", () => {
  it("sorts nodes by start and lists undated nodes apart", async () => {
    const l = await layout("Project", "month");
    expect(l.rows.map((r) => r.title)).toEqual(["Website relaunch", "Acme rollout", "Mobile app"]);
    expect(l.undated.map((u) => u.title)).toEqual(["Archive cleanup"]);
  });

  it("places mapped spans as bars by day index (month)", async () => {
    const l = await layout("Project", "month");
    expect(row(l, "Website relaunch")).toMatchObject({ kind: "mapped", bar: { from: 10, to: 41, clipStart: false, clipEnd: false }, point: null });
    expect(row(l, "Acme rollout").bar).toEqual({ from: 17, to: 26, clipStart: false, clipEnd: false });
  });

  it("places the same spans in week columns' day units (quarter)", async () => {
    const l = await layout("Project", "quarter");
    expect(row(l, "Website relaunch").bar).toEqual({ from: 24, to: 55, clipStart: false, clipEnd: false });
    expect(row(l, "Mobile app").point).toBe(39);
  });

  it("clips a span at the end edge (week)", async () => {
    const l = await layout("Project", "week");
    expect(row(l, "Website relaunch").bar).toEqual({ from: 3, to: 21, clipStart: false, clipEnd: true });
    expect(row(l, "Acme rollout").bar).toEqual({ from: 10, to: 19, clipStart: false, clipEnd: false });
  });

  it("clips a span at both edges, and at the start edge alone", () => {
    expect(synthetic("2026-01-01", "2027-01-01", "week").rows[0].bar).toEqual({ from: 0, to: 21, clipStart: true, clipEnd: true });
    expect(synthetic("2026-09-01", "2026-09-25", "week").rows[0].bar).toEqual({ from: 0, to: 6, clipStart: true, clipEnd: false });
  });

  it("a span or point wholly outside the range has no row; it is counted earlier or later (T13a)", () => {
    const before = synthetic("2026-08-01", "2026-08-20", "week");
    expect(before.rows).toEqual([]);
    expect(before.earlier).toEqual({ count: 1, nearest: "2026-08-20" });
    expect(before.later).toEqual({ count: 0, nearest: null });
    const after = synthetic("2026-12-01", null, "week");
    expect(after.rows).toEqual([]);
    expect(after.later).toEqual({ count: 1, nearest: "2026-12-01" });
    expect(after.earlier).toEqual({ count: 0, nearest: null });
  });

  it("nearest = the latest end before the range and the earliest start after it; an anchor there brings that node in", () => {
    const p = tag("Project");
    const s = dateIdent(p, "Start");
    const e = dateIdent(p, "End");
    const node = (id: number, start: string, end: string): PlannerNode =>
      ({ id, uuid: `u${id}`, title: `N${id}`, tagIds: [], tag: "", dependsOn: [], dates: { [s]: d(start), [e]: d(end) }, choices: {} });
    const nodes = [node(1, "2026-07-01", "2026-07-10"), node(2, "2026-08-01", "2026-09-05"), node(3, "2026-09-25", "2026-09-30"),
      node(4, "2026-11-02", "2026-11-20"), node(5, "2026-10-20", "2026-12-01"), node(6, "2027-01-05", "2027-01-06")];
    const at = (anchor: string) => layoutTimeline({ items: viewItems(nodes, [], () => ({ start: s, end: e }), statusValues), zoom: "week", anchor, today: TODAY, now: NOW, weekStart: 0, statusValues, titles: new Map() });
    const l = at(TODAY); // 20 Sep – 10 Oct
    expect(l.rows.map((r) => r.title)).toEqual(["N3"]);
    expect(l.earlier).toEqual({ count: 2, nearest: "2026-09-05" });
    expect(l.later).toEqual({ count: 3, nearest: "2026-10-20" });
    expect(at(l.earlier.nearest!).rows.map((r) => r.title)).toContain("N2");
    expect(at(l.later.nearest!).rows.map((r) => r.title)).toContain("N5");
  });

  it("one-date nodes are points (diamonds) at their day", async () => {
    const l = await layout("Project", "month");
    expect(row(l, "Mobile app")).toMatchObject({ kind: "point", bar: null, point: 25 });
    const m = await layout("Meeting", "week");
    expect(m.rows.map((r) => [r.title, r.kind, r.point])).toEqual([["Kickoff", "point", 13], ["Late review", "point", 14]]);
    expect(m.undated.map((u) => u.title)).toEqual(["Untimed meeting"]);
  });

  it("flags spans derived from linked tasks", async () => {
    const { nodes, tasks } = await load("Project");
    const p = tag("Project");
    const bare = nodes.map((n) => (n.title === "Mobile app" ? { ...n, dates: {} } : n));
    const l = layoutTimeline({
      items: viewItems(bare, tasks, () => ({ start: dateIdent(p, "Start"), end: dateIdent(p, "End") }), statusValues), zoom: "month", anchor: TODAY, today: TODAY, now: NOW,
      weekStart: 0, statusValues, titles: titlesByUuid(nodes),
    });
    expect(row(l, "Mobile app")).toMatchObject({ kind: "derived", bar: { from: 26, to: 27 } }); // Wireframes, Scheduled 9 Oct
  });

  it("carries progress as done / (all − canceled)", async () => {
    const l = await layout("Project", "month");
    expect(row(l, "Website relaunch").progress).toEqual({ done: 1, total: 2 });
    expect(row(l, "Acme rollout").progress).toEqual({ done: 0, total: 1 });
    expect(row(l, "Mobile app").progress).toEqual({ done: 0, total: 1 });
  });

  it("gives each row an accessible description with dates and progress", async () => {
    const l = await layout("Project", "month");
    expect(row(l, "Website relaunch").label).toBe("Website relaunch, 23 Sep – 23 Oct, 1 of 2 done");
    expect(row(l, "Mobile app").label).toBe("Mobile app, 8 Oct, 0 of 1 done");
    const m = await layout("Meeting", "week");
    expect(row(m, "Kickoff").label).toBe("Kickoff, 3 Oct 10:30");
  });

  it("gives every node a stable category colour 1–6 by uuid", async () => {
    const a = await layout("Project", "month");
    const b = await layout("Project", "quarter");
    for (const r of a.rows) {
      expect(r.cat).toBeGreaterThanOrEqual(1);
      expect(r.cat).toBeLessThanOrEqual(6);
      expect(row(b, r.title).cat).toBe(r.cat);
    }
  });
});

describe("task rows", () => {
  it("lists a node's tasks with display titles (inline ref resolved) and markers at their dates", async () => {
    const l = await layout("Project", "month");
    const site = row(l, "Website relaunch");
    expect(site.tasks.map((t) => t.title)).toEqual(["Draft brief Website relaunch", "Ship homepage Website relaunch", "Survey users Website relaunch"]);
    const draft = site.tasks[0];
    expect(draft).toMatchObject({ status: "todo", done: false });
    expect(draft.markers).toEqual([{ kind: "deadline", date: d("2026-10-05", "17:00"), at: 22, late: false }]);
    expect(draft.label).toBe("Draft brief Website relaunch, Todo, due 5 Oct 17:00");
    expect(site.tasks[1]).toMatchObject({ status: "done", done: true, markers: [] });
    expect(site.tasks[2]).toMatchObject({ status: "canceled", done: true, markers: [] });
    expect(site.tasks[1].label).toBe("Ship homepage Website relaunch, Done, no date");
  });

  it("marks an open task past its deadline as late and a scheduled date as a scheduled marker", async () => {
    const l = await layout("Project", "month");
    expect(row(l, "Acme rollout").tasks[0].markers).toEqual([{ kind: "deadline", date: d("2026-10-02", "12:00"), at: 19, late: true }]);
    expect(row(l, "Mobile app").tasks[0].markers).toEqual([{ kind: "scheduled", date: d("2026-10-09", "09:00"), at: 26, late: false }]);
  });

  it("lateness counts the Scheduled date when there is no Deadline; with both dates only the deadline marker is late", () => {
    const p = tag("Project");
    const s = dateIdent(p, "Start");
    const node: PlannerNode = { id: 1, uuid: "u1", title: "N", tagIds: [], tag: "", dependsOn: [], dates: { [s]: d("2026-10-01") }, choices: {} };
    const todo = statusValues.find((v) => v.title === "Todo")!;
    const status = { ident: todo.ident!, title: todo.title };
    const mk = (id: number, scheduled: string | null, deadline: string | null): PlannerTask => ({
      id, uuid: `t${id}`, title: `T${id}`, status, isNode: false, nodeIds: [1], scheduled: scheduled ? d(scheduled) : null, deadline: deadline ? d(deadline) : null,
    });
    const l = layoutTimeline({
      items: viewItems([node], [mk(1, "2026-10-01", null), mk(2, "2026-10-01", "2026-10-02"), mk(3, "2026-10-03", null), mk(4, "2026-10-01", "2026-10-09")], () => ({ start: s, end: null }), statusValues),
      zoom: "month", anchor: TODAY, today: TODAY, now: NOW, weekStart: 0, statusValues, titles: new Map(),
    });
    const lateOf = (title: string) => l.rows[0].tasks.find((t) => t.title === title)!.markers.map((m) => [m.kind, m.late]);
    expect(lateOf("T1")).toEqual([["scheduled", true]]);
    expect(lateOf("T2")).toEqual([["scheduled", false], ["deadline", true]]);
    expect(lateOf("T3")).toEqual([["scheduled", false]]);
    expect(lateOf("T4")).toEqual([["scheduled", false], ["deadline", false]]);
  });

  it("drops a marker outside the range", async () => {
    // 4 – 24 Oct: Acme rollout (30 Sep – 8 Oct) is clipped in range; its task's deadline (2 Oct) lies before it
    const l = await layout("Project", "week", { anchor: "2026-10-11" });
    expect(row(l, "Acme rollout").bar).toMatchObject({ clipStart: true });
    expect(row(l, "Acme rollout").tasks[0].markers).toEqual([]);
  });

  it("sorts dated tasks first by date, then undated by title", () => {
    const p = tag("Project");
    const node: PlannerNode = { id: 1, uuid: "u1", title: "N", tagIds: [], tag: "", dependsOn: [], dates: { [dateIdent(p, "Start")]: d("2026-10-01") }, choices: {} };
    const t = (id: number, title: string, deadline: string | null): PlannerTask =>
      ({ id, uuid: `t${id}`, title, status: null, isNode: false, nodeIds: [1], deadline: deadline ? d(deadline) : null, scheduled: null });
    const tasks = [t(1, "b undated", null), t(2, "late", "2026-10-09"), t(3, "a undated", null), t(4, "early", "2026-10-02")];
    const l = layoutTimeline({ items: viewItems([node], tasks, () => ({ start: dateIdent(p, "Start"), end: null }), statusValues), zoom: "month", anchor: TODAY, today: TODAY, now: NOW, weekStart: 0, statusValues, titles: new Map() });
    expect(l.rows[0].tasks.map((x) => x.title)).toEqual(["early", "late", "a undated", "b undated"]);
    expect(l.rows[0].tasks[0].status).toBeNull();
  });
});

describe("today line", () => {
  it("sits on today's day index when today is in range", async () => {
    expect((await layout("Project", "week")).todayAt).toBe(13);
    expect((await layout("Project", "month")).todayAt).toBe(20);
    expect((await layout("Project", "quarter")).todayAt).toBe(34);
  });

  it("is absent when today is out of range", async () => {
    const l = await layout("Project", "month", { anchor: shiftAnchor(TODAY, "month", 1) });
    expect(l.range.start).toBe("2026-10-04");
    expect(l.todayAt).toBeNull();
    expect(l.columns.some((c) => c.today)).toBe(false);
  });
});

describe("Day zoom (N10): one day of 96 tracks of 15 minutes, 24 hour columns", () => {
  /** Nodes with Start/End (either may be null: a point) and their tasks, laid out on Sat 3 Oct in Day zoom. */
  function day(specs: [LocalDate | null, LocalDate | null][], over: Partial<TimelineInput> = {}, tasks: PlannerTask[] = []) {
    const p = tag("Project");
    const s = dateIdent(p, "Start");
    const e = dateIdent(p, "End");
    const nodes = specs.map(([start, end], i): PlannerNode => ({
      id: i + 1, uuid: `u${i + 1}`, title: `N${i + 1}`, tagIds: [], tag: "", dependsOn: [], choices: {},
      dates: { ...(start ? { [s]: start } : {}), ...(end ? { [e]: end } : {}) },
    }));
    return layoutTimeline({ items: viewItems(nodes, tasks, () => ({ start: s, end: e }), statusValues), zoom: "day", anchor: TODAY, today: TODAY, now: NOW, weekStart: 0, statusValues, titles: new Map(), ...over });
  }
  const bar = (l: TimelineLayout, i = 0) => l.rows[i].bar;
  const todo = () => {
    const v = statusValues.find((x) => x.title === "Todo")!;
    return { ident: v.ident!, title: v.title };
  };
  const task = (id: number, scheduled: LocalDate | null, deadline: LocalDate | null): PlannerTask =>
    ({ id, uuid: `t${id}`, title: `T${id}`, status: todo(), isNode: false, nodeIds: [1], scheduled, deadline });

  it("range: exactly the anchor's day, whatever the week start, labelled with its weekday", () => {
    const want = { start: TODAY, end: TODAY, days: 1, tracks: 96, label: "Sat 3 Oct 2026" };
    expect(timelineRange("day", TODAY, 0)).toEqual(want);
    expect(timelineRange("day", TODAY, 1)).toEqual(want);
    expect(timelineRange("day", "2026-10-05", 0).label).toBe("Mon 5 Oct 2026");
  });

  it("prev / next move by one day", () => {
    expect(shiftAnchor(TODAY, "day", 1)).toBe("2026-10-04");
    expect(shiftAnchor(TODAY, "day", -1)).toBe("2026-10-02");
    expect(shiftAnchor("2026-12-31", "day", 1)).toBe("2027-01-01");
  });

  it("24 hour columns of 4 tracks labelled 00 … 23, without weekend, week or month decorations; today = the current hour", () => {
    const l = day([], { anchor: "2026-10-01" }); // a 1st
    expect(l.columns).toHaveLength(24);
    expect(l.columns.map((c) => c.label)).toEqual(Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")));
    expect(l.columns[13]).toEqual({ key: "2026-10-01T13", start: "2026-10-01", end: "2026-10-01", from: 52, to: 56, label: "13", weekend: false, today: false, weekStart: false, monthStart: false });
    const sat = day([]);
    expect(sat.columns.some((c) => c.weekend || c.weekStart || c.monthStart)).toBe(false);
    expect(sat.columns.filter((c) => c.today).map((c) => c.key)).toEqual(["2026-10-03T13"]);
  });

  it("keys the day columns by their day (the other zooms)", async () => {
    const l = await layout("Project", "week");
    expect(l.columns[13]).toMatchObject({ key: TODAY, start: TODAY });
  });

  it("places a span by its times: floor for the start track, ceil for the end", () => {
    expect(bar(day([[d(TODAY, "13:07"), d(TODAY, "14:08")]]))).toEqual({ from: 52, to: 57, clipStart: false, clipEnd: false });
    expect(bar(day([[d(TODAY, "13:00"), d(TODAY, "14:00")]]))).toEqual({ from: 52, to: 56, clipStart: false, clipEnd: false });
    expect(bar(day([[d(TODAY, "00:00"), d(TODAY, "23:59")]]))).toEqual({ from: 0, to: 96, clipStart: false, clipEnd: false });
  });

  it("a span takes at least one track", () => {
    expect(bar(day([[d(TODAY, "13:00"), d(TODAY, "13:00")]]))).toEqual({ from: 52, to: 53, clipStart: false, clipEnd: false });
    expect(bar(day([[d(TODAY, "13:05"), d(TODAY, "13:10")]]))).toEqual({ from: 52, to: 53, clipStart: false, clipEnd: false });
  });

  it("Date-only ends: a start without a time is 00:00, an end without one runs to the end of its day", () => {
    expect(bar(day([[d(TODAY), d(TODAY)]]))).toEqual({ from: 0, to: 96, clipStart: false, clipEnd: false });
    expect(bar(day([[d(TODAY, "09:00"), d(TODAY)]]))).toEqual({ from: 36, to: 96, clipStart: false, clipEnd: false });
    expect(bar(day([[d(TODAY), d(TODAY, "10:00")]]))).toEqual({ from: 0, to: 40, clipStart: false, clipEnd: false });
  });

  it("clips a span across midnight at the edge it runs past; a Date-only span over several days at both", () => {
    expect(bar(day([[d("2026-10-02", "22:00"), d(TODAY, "02:00")]]))).toEqual({ from: 0, to: 8, clipStart: true, clipEnd: false });
    expect(bar(day([[d(TODAY, "23:00"), d("2026-10-04", "01:00")]]))).toEqual({ from: 92, to: 96, clipStart: false, clipEnd: true });
    expect(bar(day([[d("2026-10-01"), d("2026-10-05")]]))).toEqual({ from: 0, to: 96, clipStart: true, clipEnd: true });
  });

  it("a one-date node is a point at its time's track; a Date-only one at track 0", () => {
    const l = day([[d(TODAY, "13:07"), null], [d(TODAY), null]]);
    expect(l.rows.map((r) => [r.title, r.kind, r.point, r.bar])).toEqual([["N2", "point", 0, null], ["N1", "point", 52, null]]);
    expect(l.rows[1].label).toBe("N1, 3 Oct 13:07");
  });

  it("nodes wholly before or after the day are counted; nearest = the day of the last / first track they cover", () => {
    const l = day([
      [d("2026-10-02", "09:00"), d("2026-10-02", "17:00")],
      [d("2026-10-02", "22:00"), d(TODAY, "00:00")], // ends at midnight: wholly on the 2nd
      [d("2026-10-04", "08:00"), null],
      [d("2026-10-05"), d("2026-10-06")],
      [d(TODAY, "10:00"), d(TODAY, "11:00")],
    ]);
    expect(l.rows.map((r) => r.title)).toEqual(["N5"]);
    expect(l.earlier).toEqual({ count: 2, nearest: "2026-10-02" });
    expect(l.later).toEqual({ count: 2, nearest: "2026-10-04" });
  });

  it("task markers sit at their time's track (Date-only at track 0); lateness is unchanged; other days are dropped", () => {
    const tasks = [task(1, d(TODAY, "09:10"), d(TODAY, "17:00")), task(2, null, d(TODAY)), task(3, d("2026-10-04", "01:00"), null)];
    const l = day([[d(TODAY, "08:00"), d(TODAY, "18:00")]], {}, tasks);
    const markers = (title: string) => l.rows[0].tasks.find((t) => t.title === title)!.markers.map((m) => [m.kind, m.at, m.late]);
    expect(markers("T1")).toEqual([["scheduled", 36, false], ["deadline", 68, false]]);
    expect(markers("T2")).toEqual([["deadline", 0, false]]);
    expect(markers("T3")).toEqual([]);
    const tomorrow = day([[d(TODAY, "08:00"), d(TODAY, "18:00")]], { today: "2026-10-04" }, tasks);
    expect(tomorrow.rows[0].tasks.find((t) => t.title === "T1")!.markers.map((m) => m.late)).toEqual([false, true]);
  });

  it("the now line sits at the current time in tracks, only on today", () => {
    expect(day([]).todayAt).toBe(54); // 13:30
    expect(day([], { now: "13:07" }).todayAt).toBeCloseTo(787 / 15);
    expect(day([], { now: "00:00" }).todayAt).toBe(0);
    expect(day([], { anchor: "2026-10-04" }).todayAt).toBeNull();
  });

  it("the other zooms ignore times: same placement as before", async () => {
    const l = synthetic("2026-10-03", "2026-10-03", "week");
    expect(l.rows[0].bar).toEqual({ from: 13, to: 14, clipStart: false, clipEnd: false });
    const m = await layout("Meeting", "week", { now: "23:59" });
    expect(m.rows.map((r) => r.point)).toEqual([13, 14]);
    expect(m.todayAt).toBe(13);
  });
});

describe("dayFocus (N10): where the Day zoom opens", () => {
  const p = () => tag("Project");
  function day(specs: [LocalDate | null, LocalDate | null][], tasks: PlannerTask[] = []) {
    const s = dateIdent(p(), "Start");
    const e = dateIdent(p(), "End");
    const nodes = specs.map(([start, end], i): PlannerNode => ({
      id: i + 1, uuid: `u${i + 1}`, title: `N${i + 1}`, tagIds: [], tag: "", dependsOn: [], choices: {},
      dates: { ...(start ? { [s]: start } : {}), ...(end ? { [e]: end } : {}) },
    }));
    return layoutTimeline({ items: viewItems(nodes, tasks, () => ({ start: s, end: e }), statusValues), zoom: "day", anchor: TODAY, today: TODAY, now: NOW, weekStart: 0, statusValues, titles: new Map() });
  }
  const task = (id: number, scheduled: LocalDate | null): PlannerTask => ({ id, uuid: `t${id}`, title: `T${id}`, status: null, isNode: false, nodeIds: [1], scheduled, deadline: null });

  it("the earliest bar or point that starts on the day at a time", () => {
    expect(dayFocus(day([[d(TODAY, "13:07"), d(TODAY, "14:08")], [d(TODAY, "10:00"), null]]), new Set())).toBe(40);
  });

  it("Date-only items and spans running in from the day before do not pull it to 00:00 when a timed item is there", () => {
    const l = day([[d(TODAY), d(TODAY)], [d("2026-10-02", "22:00"), d(TODAY, "02:00")], [d(TODAY), null], [d(TODAY, "13:07"), d(TODAY, "14:08")]]);
    expect(dayFocus(l, new Set())).toBe(52);
  });

  it("markers count only on expanded rows", () => {
    const l = day([[d(TODAY, "13:00"), d(TODAY, "14:00")]], [task(1, d(TODAY, "09:00"))]);
    expect(dayFocus(l, new Set())).toBe(52);
    expect(dayFocus(l, new Set([1]))).toBe(36);
  });

  it("a Date-only point or marker alone: 00:00; nothing on the day: null", () => {
    expect(dayFocus(day([[d(TODAY), null]]), new Set())).toBe(0);
    expect(dayFocus(day([[d(TODAY), d(TODAY)]]), new Set())).toBeNull();
    expect(dayFocus(day([]), new Set())).toBeNull();
  });
});

describe("dependency links (N12)", () => {
  const p = tag("Project");
  const s = dateIdent(p, "Start");
  const e = dateIdent(p, "End");
  /** A node with a span (or no dates when `start` is null) depending on the node ids `deps`. */
  const node = (id: number, start: string | null, end: string | null, deps: number[] = []): PlannerNode =>
    ({ id, uuid: `u${id}`, title: `N${id}`, tagIds: [], tag: "", dependsOn: deps, choices: {}, dates: { ...(start ? { [s]: d(start) } : {}), ...(end ? { [e]: d(end) } : {}) } });
  const lay = (nodes: PlannerNode[], zoom: Zoom = "week") =>
    layoutTimeline({ items: viewItems(nodes, [], () => ({ start: s, end: e }), statusValues), zoom, anchor: TODAY, today: TODAY, now: NOW, weekStart: 0, statusValues, titles: new Map() });

  it("links each on-screen dependency to its on-screen dependent (dependency uuid → dependent uuid), bars and points alike", () => {
    // week range 20 Sep – 10 Oct; N4 is a point (Start only)
    const l = lay([node(1, "2026-09-28", "2026-10-01"), node(2, "2026-10-02", "2026-10-05", [1]), node(3, "2026-10-02", "2026-10-06", [1]), node(4, "2026-10-08", null, [2, 3])]);
    expect(l.links).toEqual([{ from: "u1", to: "u2" }, { from: "u1", to: "u3" }, { from: "u2", to: "u4" }, { from: "u3", to: "u4" }]);
  });

  it("no link when either end has no row: out of range, undated, filtered out (not in the items) or not loaded", () => {
    const l = lay([node(1, "2026-08-01", "2026-08-05"), node(2, "2026-10-02", "2026-10-05", [1, 5, 99]), node(3, "2026-10-02", "2026-10-06", [2]), node(5, null, null)]);
    expect(l.rows.map((r) => r.title)).toEqual(["N2", "N3"]);
    expect(l.links).toEqual([{ from: "u2", to: "u3" }]);
    const filtered = lay([node(2, "2026-10-02", "2026-10-05"), node(3, "2026-10-02", "2026-10-06", [2])].slice(1)); // N2 filtered out
    expect(filtered.links).toEqual([]);
    const later = lay([node(1, "2026-10-02", "2026-10-05"), node(2, "2026-12-01", "2026-12-05", [1])]);
    expect(later.links).toEqual([]);
  });

  it("each row names the shown nodes it depends on (titles, on screen or not); [] without dependencies", () => {
    const l = lay([node(1, "2026-08-01", "2026-08-05"), node(2, "2026-10-02", "2026-10-05", [1, 99]), node(3, "2026-10-02", "2026-10-06", [2, 1])]);
    expect(l.rows.map((r) => [r.title, r.dependsOn])).toEqual([["N2", ["N1"]], ["N3", ["N2", "N1"]]]);
    expect(lay([node(1, "2026-10-02", "2026-10-05")]).rows[0].dependsOn).toEqual([]);
  });

  it("without dependencies there are no links", async () => {
    expect((await layout("Project", "month")).links).toEqual([]);
  });
});

describe("arranged by tag (N14)", () => {
  it("rows grouped in the tags' selection order, by date inside each group; no groups = by date", async () => {
    const both = [tag("Meeting"), tag("Project")];
    const { nodes, tasks } = await loadNodesAndTasks(dq, tags, both, { childTags: true, zone: west5 });
    const dates = { [tag("Meeting").ident]: { start: dateIdent(tag("Meeting"), "Date"), end: null }, [tag("Project").ident]: { start: dateIdent(tag("Project"), "Start"), end: dateIdent(tag("Project"), "End") } };
    const input: TimelineInput = {
      items: viewItems(nodes, tasks, (n) => dates[n.tag], statusValues), zoom: "month", anchor: TODAY, today: TODAY, now: NOW, weekStart: 0, statusValues, titles: titlesByUuid(nodes),
    };
    const byDate = layoutTimeline(input);
    expect(byDate.groups).toBeNull();
    const groups = both.map((t) => ({ tag: t.ident, title: `#${t.title}` }));
    const byTag = layoutTimeline({ ...input, groups });
    expect(byTag.groups).toEqual(groups);
    expect(byTag.rows.map((r) => r.title)).toEqual([
      ...byDate.rows.filter((r) => r.node.tag === tag("Meeting").ident).map((r) => r.title),
      ...byDate.rows.filter((r) => r.node.tag === tag("Project").ident).map((r) => r.title),
    ]);
    expect(byTag.rows.map((r) => r.title)).toEqual(["Kickoff", "Late review", "Website relaunch", "Acme rollout", "Mobile app"]);
    expect(new Set(byDate.rows.map((r) => r.title))).toEqual(new Set(byTag.rows.map((r) => r.title)));
  });
});
