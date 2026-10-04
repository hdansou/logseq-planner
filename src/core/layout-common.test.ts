import { describe, expect, it } from "vitest";
import {
  addDays, categoryOf, daysBetween, dueDate, formatDay, formatMonth, formatRange, formatSpan, isLate, nestItems, nodeLabel, startOfWeek, viewItems, weekdayName, weekStartFromHost,
  type ViewItem,
} from "./layout-common";
import type { ClosedValue, LocalDate, PlannerNode, PlannerTask } from "../types";

describe("calendar-day arithmetic", () => {
  it("adds days across month and year ends and leap days", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-13", "2026-10-23")).toBe(40);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("counts every day once across both DST transitions (US 2026: 8 Mar and 1 Nov)", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-01", "2026-03-15")).toBe(14);
    expect(daysBetween("2026-10-25", "2026-11-08")).toBe(14);
  });

  it("finds the start of the week for Sunday and Monday starts", () => {
    expect(startOfWeek("2026-10-03", 0)).toBe("2026-09-27"); // Sat → Sun before
    expect(startOfWeek("2026-10-03", 1)).toBe("2026-09-28"); // Sat → Mon before
    expect(startOfWeek("2026-09-27", 0)).toBe("2026-09-27");
    expect(startOfWeek("2026-09-27", 1)).toBe("2026-09-21"); // a Sunday belongs to the Monday before
  });
});

describe("formatting", () => {
  it("formats days, months and ranges like the Timeline", () => {
    expect(formatDay("2026-09-23")).toBe("23 Sep");
    expect(formatDay("2026-09-23", true)).toBe("23 Sep 2026");
    expect(formatMonth("2026-10-03")).toBe("October 2026");
    expect(formatRange("2026-09-27", "2026-10-03")).toBe("27 Sep – 3 Oct 2026");
    expect(formatRange("2026-12-27", "2027-01-02")).toBe("27 Dec 2026 – 2 Jan 2027");
    expect(weekdayName("2026-10-03")).toBe("Sat");
  });
});

describe("host week start (Logseq preferredStartOfWeek: 0–6 = Monday–Sunday)", () => {
  it("converts to the layouts' 0 = Sunday … 6 = Saturday", () => {
    expect(weekStartFromHost(6)).toBe(0); // Logseq's default: Sunday
    expect(weekStartFromHost(0)).toBe(1); // Monday
    expect(weekStartFromHost(5)).toBe(6); // Saturday
  });

  it("accepts a numeric string (the SDK types it as a string)", () => {
    expect(weekStartFromHost("0")).toBe(1);
    expect(weekStartFromHost("6")).toBe(0);
  });

  it("throws on anything else", () => {
    for (const bad of [undefined, null, 7, -1, 1.5, "", "x", "7", " ", {}, NaN]) {
      expect(() => weekStartFromHost(bad), String(bad)).toThrow(/preferredStartOfWeek/);
    }
  });
});

describe("category colour", () => {
  it("is 1–6 and stable per uuid", () => {
    const c = categoryOf("6a000000-0000-4000-8000-000000000001");
    expect(c).toBeGreaterThanOrEqual(1);
    expect(c).toBeLessThanOrEqual(6);
    expect(categoryOf("6a000000-0000-4000-8000-000000000001")).toBe(c);
  });
});

describe("due date and lateness", () => {
  const day = (s: string): LocalDate => ({ day: s, time: null });
  const task = (scheduled: string | null, deadline: string | null): PlannerTask => ({
    id: 1, uuid: "t1", title: "T", status: null, isNode: false, nodeIds: [1], scheduled: scheduled ? day(scheduled) : null, deadline: deadline ? day(deadline) : null,
  });

  it("the due date is the Deadline, else the Scheduled date, else none", () => {
    expect(dueDate(task("2026-10-01", "2026-10-05"))).toEqual(day("2026-10-05"));
    expect(dueDate(task("2026-10-01", null))).toEqual(day("2026-10-01"));
    expect(dueDate(task(null, "2026-10-05"))).toEqual(day("2026-10-05"));
    expect(dueDate(task(null, null))).toBeNull();
  });

  it("an open task is late when its due day is before today; today, later, done and undated are not", () => {
    expect(isLate(task(null, "2026-10-02"), false, "2026-10-03")).toBe(true);
    expect(isLate(task("2026-10-02", null), false, "2026-10-03")).toBe(true);
    expect(isLate(task(null, "2026-10-03"), false, "2026-10-03")).toBe(false);
    expect(isLate(task("2026-10-03", null), false, "2026-10-03")).toBe(false);
    expect(isLate(task("2026-10-02", null), true, "2026-10-03")).toBe(false);
    expect(isLate(task(null, null), false, "2026-10-03")).toBe(false);
  });

  it("with both dates the Deadline decides: a past Scheduled date before a future Deadline is not late, and the reverse is", () => {
    expect(isLate(task("2026-10-01", "2026-10-09"), false, "2026-10-03")).toBe(false);
    expect(isLate(task("2026-10-09", "2026-10-01"), false, "2026-10-03")).toBe(true);
  });
});

describe("formatSpan and nodeLabel", () => {
  const d = (day: string, time: string | null = null): LocalDate => ({ day, time });
  it("reads a span whose ends are the same date and time as one date", () => {
    expect(formatSpan(d("2026-10-09", "09:00"), d("2026-10-09", "09:00"))).toBe("9 Oct 09:00");
    expect(formatSpan(d("2026-10-09"), d("2026-10-09"))).toBe("9 Oct");
  });
  it("keeps a range for different times on one day, or different days", () => {
    expect(formatSpan(d("2026-10-09", "09:00"), d("2026-10-09", "17:00"))).toBe("9 Oct 09:00 – 9 Oct 17:00");
    expect(formatSpan(d("2026-10-09"), d("2026-10-10"))).toBe("9 Oct – 10 Oct");
  });
  it("labels a derived one-point span as one date from its tasks", () => {
    const span = { kind: "derived" as const, start: d("2026-10-09", "09:00"), end: d("2026-10-09", "09:00") };
    expect(nodeLabel("Mobile app", span, { done: 0, total: 1 })).toBe("Mobile app, 9 Oct 09:00 from its tasks, 0 of 1 done");
  });
  it("still labels a derived range as a range", () => {
    const span = { kind: "derived" as const, start: d("2026-10-09", "09:00"), end: d("2026-10-12") };
    expect(nodeLabel("Mobile app", span, { done: 1, total: 2 })).toBe("Mobile app, 9 Oct 09:00 – 12 Oct from its tasks, 1 of 2 done");
  });
});

describe("viewItems over several tags (N14)", () => {
  const day = (s: string): LocalDate => ({ day: s, time: null });
  const node = (id: number, tag: string, dates: Record<string, LocalDate>): PlannerNode => ({ id, uuid: `n${id}`, title: `N${id}`, tagIds: [], tag, dependsOn: [], links: [], dates, choices: {} });
  const task = (id: number, nodeIds: number[], isNode: boolean): PlannerTask => ({ id, uuid: `t${id}`, title: `T${id}`, status: null, isNode, nodeIds, scheduled: day("2026-10-02"), deadline: null });
  const mapping: Record<string, { start: string | null; end: string | null }> = { ":a/A": { start: ":p/start", end: ":p/end" }, ":a/B": { start: ":p/due", end: null } };

  it("each node takes its own tag's Start / End", () => {
    const items = viewItems([node(1, ":a/A", { ":p/start": day("2026-10-01"), ":p/end": day("2026-10-05"), ":p/due": day("2026-10-09") }), node(2, ":a/B", { ":p/start": day("2026-10-01"), ":p/due": day("2026-10-09") })],
      [], (n) => mapping[n.tag], []);
    expect(items.map((i) => [i.span.kind, i.span.start?.day, i.span.end?.day])).toEqual([["mapped", "2026-10-01", "2026-10-05"], ["point", "2026-10-09", "2026-10-09"]]);
  });

  it("a linked task that is itself a node of the view is not one of the node's task rows, but counts in its rollup", () => {
    const [item] = viewItems([node(1, ":a/A", {})], [task(10, [1], false), task(11, [1], true)], (n) => mapping[n.tag], []);
    expect(item.tasks.map((t) => t.id)).toEqual([10]);
    expect(item.progress).toEqual({ done: 0, total: 2 });
    expect(item.span.kind).toBe("derived"); // from both tasks' dates, as before
  });
});

describe("nestItems: parents and children (N14 step 2)", () => {
  const day = (s: string): LocalDate => ({ day: s, time: null });
  const value = (uuid: string, title: string, ident: string | null, checkbox: boolean | null, canceled = false): ClosedValue =>
    ({ id: uuid.length, uuid, title, ident, order: "a", checkbox, canceled });
  const DONE = value("done-uuid", "Done", ":logseq.property/status.done", true);
  const TODO = value("todo", "Todo", ":logseq.property/status.todo", false);
  const CANCELED = value("canceled-uuid", "Canceled", ":logseq.property/status.canceled", null, true);
  const STATUS = ":logseq.property/status";
  /** An item starting on `start` (null = undated), linking `links`, with an optional Status. */
  const item = (id: number, start: string | null, links: number[], status?: ClosedValue, tasks: PlannerTask[] = []): ViewItem => ({
    node: { id, uuid: `n${id}`, title: `N${id}`, tagIds: [], tag: ":t/x", dependsOn: [], links, dates: {}, choices: status ? { [STATUS]: status } : {} },
    span: start ? { kind: "point", start: day(start), end: day(start) } : { kind: "undated", start: null, end: null },
    tasks, progress: { done: 0, total: 0 },
  });
  const task = (id: number, status: ClosedValue | null): PlannerTask =>
    ({ id, uuid: `t${id}`, title: `T${id}`, status: status && { ident: status.ident!, title: status.title }, isNode: false, nodeIds: [1], scheduled: null, deadline: null });
  const parents = (items: ViewItem[]) => Object.fromEntries(nestItems(items, [DONE, TODO, CANCELED], {}).parentOf);

  it("a node linking another goes under it; with several candidates, under the first in row order", () => {
    expect(parents([item(1, "2026-10-05", []), item(2, "2026-10-01", [1])])).toEqual({ 2: 1 });
    expect(parents([item(1, "2026-10-05", []), item(3, "2026-10-02", []), item(2, "2026-10-09", [1, 3])])).toEqual({ 2: 3 });
    expect(parents([item(1, null, []), item(3, "2026-10-02", []), item(2, "2026-10-09", [1, 3])])).toEqual({ 2: 3 }); // undated rows come last
  });

  it("a cycle: of two nodes linking each other, the later one in row order is the child, never both", () => {
    expect(parents([item(1, "2026-10-01", [2]), item(2, "2026-10-05", [1])])).toEqual({ 2: 1 });
    expect(parents([item(2, "2026-10-05", [1]), item(1, "2026-10-01", [2])])).toEqual({ 2: 1 });
  });

  it("one level: a grandchild stays top level; a node with children is never a child", () => {
    // 3 links 2, 2 links 1: 2 goes under 1, so 3 has no parent that is not itself a child.
    expect(parents([item(1, "2026-10-01", []), item(2, "2026-10-02", [1]), item(3, "2026-10-03", [2])])).toEqual({ 2: 1 });
    // 1 (earlier) took 2 as its parent before 2 was looked at: 2 is a parent, so it stays top level although it links 3.
    expect(parents([item(1, "2026-10-01", [2]), item(2, "2026-10-02", [3]), item(3, "2026-10-03", [])])).toEqual({ 1: 2 });
    expect(parents([item(1, "2026-10-01", [9])])).toEqual({}); // a link to a node that is not shown
  });

  it("progress counts the children (done by the view's done values, canceled left out) and the tasks that are not nodes, each once", () => {
    const items = [
      item(1, "2026-10-01", [], undefined, [task(10, DONE), task(11, null)]),
      item(2, "2026-10-02", [1], DONE), item(3, "2026-10-03", [1], TODO), item(4, "2026-10-04", [1], CANCELED), item(5, "2026-10-05", [1]),
    ];
    const { items: out } = nestItems(items, [DONE, TODO, CANCELED], {});
    expect(out[0].progress).toEqual({ done: 2, total: 5 }); // T10 done, T11 open; N2 done, N3 and N5 open; N4 canceled
    expect(out.map((i) => i.node.id)).toEqual([1, 2, 3, 4, 5]);
    expect(nestItems(items, [DONE, TODO, CANCELED], { [STATUS]: [TODO.uuid] }).items[0].progress).toEqual({ done: 2, total: 5 }); // N3 done, N2 not
    expect(out[1].progress).toEqual({ done: 0, total: 0 });
  });
});
