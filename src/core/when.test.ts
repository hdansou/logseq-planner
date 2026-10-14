// N67: periods by When (the Kanban's When columns) and the date writes a move into one makes.
import { describe, expect, it } from "vitest";
import type { DateProp, NodeSpan, PlannerNode } from "../types";
import { periodKey, whenMove, whenPeriods, type Period } from "./when";

const TUE = "2026-10-13"; // weeks start Monday (1)
const start: DateProp = { id: 1, ident: ":user.property/start", title: "Start", type: "date" };
const end: DateProp = { id: 2, ident: ":user.property/end", title: "End", type: "date" };
const due: DateProp = { id: 3, ident: ":logseq.property/deadline", title: "Deadline", type: "datetime" };
const d = (day: string, time: string | null = null) => ({ day, time });
const node = (dates: PlannerNode["dates"]): PlannerNode => ({ id: 1, uuid: "u-1", title: "Plan", tagIds: [], tag: ":user.class/Project", links: [], dependsOn: [], dates, choices: {} });
const span = (kind: NodeSpan["kind"], s: string | null, e: string | null): NodeSpan => ({ kind, start: s ? d(s) : null, end: e ? d(e) : null });
const period = (key: string) => whenPeriods(TUE, 1).find((p) => p.key === key)!;

describe("whenPeriods", () => {
  it("from Overdue to No date, each a run of days after the one before; a move writes the period's last day", () => {
    const rows = whenPeriods(TUE, 1).map((p: Period) => [p.key, p.title, p.first, p.last, p.drop]);
    expect(rows).toEqual([
      ["overdue", "Overdue", null, "2026-10-12", null],
      ["today", "Today", TUE, TUE, TUE],
      ["tomorrow", "Tomorrow", "2026-10-14", "2026-10-14", "2026-10-14"],
      ["week", "This week", "2026-10-15", "2026-10-18", "2026-10-18"],
      ["next", "Next week", "2026-10-19", "2026-10-25", "2026-10-25"],
      ["month", "This month", "2026-10-26", "2026-10-31", "2026-10-31"],
      ["quarter", "This quarter", "2026-11-01", "2026-12-31", "2026-12-31"],
      ["later", "Later", "2027-01-01", null, null],
      ["none", "No date", null, null, null],
    ]);
  });

  it("weeks follow the host's week start", () => {
    expect([period("week").last, whenPeriods(TUE, 0).find((p) => p.key === "week")!.last]).toEqual(["2026-10-18", "2026-10-17"]);
  });

  it("a period with no days left is left out (late in a month: This month; on the week's last day: This week)", () => {
    expect(whenPeriods("2026-10-28", 1).map((p) => p.key)).not.toContain("month"); // next week ends 8 Nov
    expect(whenPeriods("2026-10-17", 1).map((p) => p.key)).not.toContain("week"); // Sat: tomorrow is the week's last day
  });

  it("files a day in its period; no day = No date", () => {
    const ps = whenPeriods(TUE, 1);
    expect(["2026-09-01", TUE, "2026-10-17", "2026-10-30", "2026-12-31", "2027-05-01", null].map((x) => periodKey(ps, x)))
      .toEqual(["overdue", "today", "week", "month", "quarter", "later", "none"]);
  });
});

describe("whenMove", () => {
  it("a Start–End span keeps its length: End on the period's last day, Start moved by the same days", () => {
    const writes = whenMove(node({ [start.ident]: d("2026-10-01"), [end.ident]: d("2026-10-05") }), span("mapped", "2026-10-01", "2026-10-05"), { start, end }, period("next"));
    expect(writes.map((w) => [w.prop.title, w.previous?.day, w.next?.day])).toEqual([["End", "2026-10-05", "2026-10-25"], ["Start", "2026-10-01", "2026-10-21"]]);
  });

  it("a one-date node moves that date; a DateTime keeps its time", () => {
    const writes = whenMove(node({ [due.ident]: d("2026-10-02", "17:00") }), { kind: "point", start: d("2026-10-02", "17:00"), end: d("2026-10-02", "17:00") }, { start: null, end: due }, period("today"));
    expect(writes).toEqual([{ prop: due, previous: d("2026-10-02", "17:00"), next: d(TUE, "17:00") }]);
  });

  it("an undated node gets its End (else its Start); a DateTime at 00:00", () => {
    expect(whenMove(node({}), span("undated", null, null), { start, end }, period("tomorrow"))).toEqual([{ prop: end, previous: null, next: d("2026-10-14") }]);
    expect(whenMove(node({}), span("undated", null, null), { start, end: null }, period("tomorrow"))).toEqual([{ prop: start, previous: null, next: d("2026-10-14") }]);
    expect(whenMove(node({}), span("undated", null, null), { start: null, end: due }, period("week"))[0].next).toEqual(d("2026-10-18", "00:00"));
  });

  it("a card already in the period keeps its date", () => {
    expect(whenMove(node({ [end.ident]: d("2026-10-16") }), span("point", "2026-10-16", "2026-10-16"), { start, end }, period("week"))).toEqual([]);
  });

  it("to No date removes the dates the node has", () => {
    const writes = whenMove(node({ [start.ident]: d("2026-10-01"), [end.ident]: d("2026-10-05") }), span("mapped", "2026-10-01", "2026-10-05"), { start, end }, period("none"));
    expect(writes.map((w) => [w.prop.title, w.next])).toEqual([["End", null], ["Start", null]]);
  });

  it("a span derived from tasks: the node gets a date of its own (its End, else its Start)", () => {
    expect(whenMove(node({}), span("derived", "2026-10-01", "2026-10-09"), { start, end }, period("today"))).toEqual([{ prop: end, previous: null, next: d(TUE) }]);
  });

  it("refused: Overdue and Later, a node with no Start or End mapped", () => {
    const n = node({});
    expect(() => whenMove(n, span("undated", null, null), { start, end }, period("overdue"))).toThrow(/Overdue/);
    expect(() => whenMove(n, span("undated", null, null), { start, end }, period("later"))).toThrow(/Later/);
    expect(() => whenMove(n, span("undated", null, null), { start: null, end: null }, period("today"))).toThrow(/no Start or End/);
  });
});

// ---------------------------------------------------------------- Kanban columns by When

import { findCell, layoutKanban, NO_VALUE } from "./kanban";
import { whenColumnProp } from "./when";
import type { ChoiceProp, ClosedValue } from "../types";

const doneValue: ClosedValue = { id: 11, uuid: "v-done", title: "Done", ident: ":logseq.property/status.done", order: "a1", checkbox: true, canceled: false };
const todoValue: ClosedValue = { id: 10, uuid: "v-todo", title: "Todo", ident: ":logseq.property/status.todo", order: "a0", checkbox: false, canceled: false };
const status: ChoiceProp = { id: 9, ident: ":logseq.property/status", title: "Status", values: [todoValue, doneValue] };

/** Items: [title, deadline day | null, span kind, done]. */
function board(spec: [string, string | null, NodeSpan["kind"], boolean][]) {
  const ps = whenPeriods(TUE, 1);
  const items = spec.map(([title, day, kind, isDone], i) => {
    const n = { ...node(day ? { [due.ident]: d(day, "17:00") } : {}), id: i + 1, uuid: `u-${i + 1}`, title, choices: { [status.ident]: isDone ? doneValue : todoValue } };
    const s: NodeSpan = day ? { kind, start: d(day, "17:00"), end: d(day, "17:00") } : { kind: "undated", start: null, end: null };
    return { node: n, span: s, tasks: [], progress: { done: 0, total: 0 } };
  });
  return layoutKanban({
    items, columnProp: whenColumnProp(ps), laneProp: null, sort: "due", today: TUE, choiceProps: [status], doneValues: {}, titles: new Map(),
    pending: new Set(), hidden: [], when: { periods: ps, fixed: (item) => item.span.kind === "derived" },
  });
}

describe("Kanban columns by When", () => {
  const l = board([
    ["Invoice", "2026-10-10", "point", false], ["Venue", TUE, "point", false], ["Notes", "2026-10-16", "point", false],
    ["Offsite", "2026-11-20", "point", false], ["Archive", "2027-03-01", "point", false], ["Typo", null, "undated", false],
    ["Shipped", "2026-10-01", "point", true], ["Roadmap", "2026-10-20", "derived", false],
  ]);
  const titles = (key: string) => findCell(l, key, null).cards.map((c) => c.title);

  it("one column per period, then No date; Overdue and Later take no drop", () => {
    expect(l.columns.map((c) => [c.key, c.title, c.drop])).toEqual([
      ["overdue", "Overdue", false], ["today", "Today", true], ["tomorrow", "Tomorrow", true], ["week", "This week", true], ["next", "Next week", true],
      ["month", "This month", true], ["quarter", "This quarter", true], ["later", "Later", false], [NO_VALUE, "No date", true],
    ]);
  });

  it("each card in the period of its date; done cards left out and counted", () => {
    expect([titles("overdue"), titles("today"), titles("week"), titles("next"), titles("quarter"), titles("later"), titles(NO_VALUE)])
      .toEqual([["Invoice"], ["Venue"], ["Notes"], ["Roadmap"], ["Offsite"], ["Archive"], ["Typo"]]);
    expect(l.doneHidden).toBe(1);
  });

  it("a card is fixed only when the board says so (no Start or End mapped)", () => {
    expect(findCell(l, "next", null).cards[0].fixed).toBe(true); // the test's `fixed` marks the derived one
    expect(findCell(l, "today", null).cards[0].fixed).toBe(false);
  });
});

describe("Kanban card dates", () => {
  it("a 00:00 time is no time on a card, as in the Agenda (N62)", () => {
    const ps = whenPeriods(TUE, 1);
    const n = { ...node({ [due.ident]: d("2026-10-18", "00:00") }), title: "Midnight" };
    const l = layoutKanban({
      items: [{ node: n, span: { kind: "point", start: d("2026-10-18", "00:00"), end: d("2026-10-18", "00:00") }, tasks: [], progress: { done: 0, total: 0 } }],
      columnProp: whenColumnProp(ps), laneProp: null, sort: "due", today: TUE, choiceProps: [], doneValues: {}, titles: new Map(), pending: new Set(), hidden: [],
      when: { periods: ps, fixed: () => false },
    });
    expect(findCell(l, "week", null).cards[0].when).toBe("18 Oct");
  });
});

describe("a day as a target (N68: an Agenda day heading)", () => {
  it("dayPeriod(day) writes that day, keeping a span's length and a DateTime's time", async () => {
    const { dayPeriod } = await import("./when");
    const writes = whenMove(node({ [due.ident]: d("2026-10-20", "17:00") }), { kind: "point", start: d("2026-10-20", "17:00"), end: d("2026-10-20", "17:00") }, { start: null, end: due }, dayPeriod("2026-10-16"));
    expect(writes).toEqual([{ prop: due, previous: d("2026-10-20", "17:00"), next: d("2026-10-16", "17:00") }]);
    expect(whenMove(node({ [end.ident]: d("2026-10-16") }), span("point", "2026-10-16", "2026-10-16"), { start, end }, dayPeriod("2026-10-16"))).toEqual([]);
  });
});
