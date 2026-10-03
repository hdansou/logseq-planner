import { describe, expect, it } from "vitest";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos } from "./schema";
import { loadNodesAndTasks } from "./queries";
import { fixtureDq } from "../ui/test-fakes";
import { titlesByUuid } from "./display-title";
import { viewItems } from "./layout-common";
import { layoutTimeline, shiftAnchor, timelineRange, type TimelineInput, type TimelineLayout, type Zoom } from "./timeline-layout";
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
const d = (day: string, time: string | null = null): LocalDate => ({ day, time });

async function load(tagTitle: string) {
  const t = tag(tagTitle);
  const { nodes, tasks } = await loadNodesAndTasks(dq, tags, t, { childTags: true, zone: west5 });
  return { t, nodes, tasks };
}

/** Lays the fixture nodes of `tagTitle` out with the tag's default Start/End. */
async function layout(tagTitle: string, zoom: Zoom, over: Partial<TimelineInput> = {}): Promise<TimelineLayout> {
  const { t, nodes, tasks } = await load(tagTitle);
  const start = t.dateProps.find((p) => p.title === "Start" || p.title === "Date")!.ident;
  const end = t.dateProps.find((p) => p.title === "End")?.ident ?? null;
  return layoutTimeline({
    items: viewItems(nodes, tasks, start, end, statusValues), zoom, anchor: TODAY, today: TODAY, weekStart: 0,
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
  const node: PlannerNode = { id: 1, uuid: "u1", title: "Edge", tagIds: [], dates: { [s]: d(start), ...(end ? { [e]: d(end) } : {}) }, choices: {} };
  return layoutTimeline({ items: viewItems([node], [], s, e, statusValues), zoom, anchor, today: TODAY, weekStart, statusValues, titles: new Map() });
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
    expect(l.range).toEqual({ start: "2026-09-20", end: "2026-10-10", days: 21, label: "20 Sep – 10 Oct 2026" });
    expect(l.columns).toHaveLength(21);
    expect(l.columns.every((c) => c.to - c.from === 1)).toBe(true);
    expect(l.columns[0]).toMatchObject({ start: "2026-09-20", end: "2026-09-20", label: "Sun 20", weekend: true, weekStart: true });
    expect(l.columns[13]).toMatchObject({ start: TODAY, today: true, label: "Sat 3" });
  });

  it("month: 56 narrow day columns starting two weeks before the anchor's week, labelled on week starts", async () => {
    const l = await layout("Project", "month");
    expect(l.range).toEqual({ start: "2026-09-13", end: "2026-11-07", days: 56, label: "13 Sep – 7 Nov 2026" });
    expect(l.columns).toHaveLength(56);
    expect(l.columns.filter((c) => c.label).map((c) => c.label)).toEqual(["13 Sep", "20 Sep", "27 Sep", "4 Oct", "11 Oct", "18 Oct", "25 Oct", "1 Nov"]);
  });

  it("quarter: 17 week columns of seven days each", async () => {
    const l = await layout("Project", "quarter");
    expect(l.range).toEqual({ start: "2026-08-30", end: "2026-12-26", days: 119, label: "30 Aug – 26 Dec 2026" });
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
    expect(row(l, "Website relaunch")).toMatchObject({ kind: "mapped", bar: { from: 10, to: 41, clipStart: false, clipEnd: false }, point: null, outside: null });
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

  it("a span or point wholly outside the range has no bar and says on which side it is", () => {
    expect(synthetic("2026-08-01", "2026-08-20", "week").rows[0]).toMatchObject({ bar: null, point: null, outside: "before" });
    expect(synthetic("2026-12-01", null, "week").rows[0]).toMatchObject({ bar: null, point: null, outside: "after" });
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
      items: viewItems(bare, tasks, dateIdent(p, "Start"), dateIdent(p, "End"), statusValues), zoom: "month", anchor: TODAY, today: TODAY,
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

  it("drops a marker outside the range", async () => {
    const l = await layout("Project", "week", { anchor: "2026-11-28" });
    expect(row(l, "Acme rollout").tasks[0].markers).toEqual([]);
  });

  it("sorts dated tasks first by date, then undated by title", () => {
    const p = tag("Project");
    const node: PlannerNode = { id: 1, uuid: "u1", title: "N", tagIds: [], dates: { [dateIdent(p, "Start")]: d("2026-10-01") }, choices: {} };
    const t = (id: number, title: string, deadline: string | null): PlannerTask =>
      ({ id, uuid: `t${id}`, title, status: null, nodeIds: [1], deadline: deadline ? d(deadline) : null, scheduled: null });
    const tasks = [t(1, "b undated", null), t(2, "late", "2026-10-09"), t(3, "a undated", null), t(4, "early", "2026-10-02")];
    const l = layoutTimeline({ items: viewItems([node], tasks, dateIdent(p, "Start"), null, statusValues), zoom: "month", anchor: TODAY, today: TODAY, weekStart: 0, statusValues, titles: new Map() });
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
