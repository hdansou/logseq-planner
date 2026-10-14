// N74: the piles (the Calendar's No date tray, the Agenda by node, the Matrix's Unplaced list, the Kanban's Overdue and
// No date columns by When) list the newest first, by the day each node (or, by node, its newest task) was created;
// nothing created sorts last, in the order it had.
import { describe, expect, it } from "vitest";
import { layoutCalendar } from "./calendar-layout";
import { layoutAgenda } from "./agenda";
import { layoutMatrix } from "./matrix";
import { layoutKanban } from "./kanban";
import { viewItems } from "./layout-common";
import { WHEN_KEY, whenColumnProp, whenPeriods } from "./when";
import type { ChoiceProp, LocalDate, PlannerNode, PlannerTask } from "../types";

const TODAY = "2026-10-14";
const END = ":user.property/end";
const PRIORITY: ChoiceProp = { id: 1, ident: ":user.property/priority", title: "Priority", values: [
  { id: 11, uuid: "p-low", ident: null, title: "Low", checkbox: null, canceled: false },
  { id: 12, uuid: "p-high", ident: null, title: "High", checkbox: null, canceled: false },
] } as unknown as ChoiceProp;
const none = new Map<string, string>();

const node = (id: number, title: string, created: string | undefined, end: string | null = null): PlannerNode => ({
  id, uuid: `n${id}`, title, tagIds: [], tag: ":user.class/Project", dates: end ? { [END]: { day: end, time: null } as LocalDate } : {}, choices: {},
  dependsOn: [], links: [], ...(created ? { created } : {}),
});
const task = (id: number, nodeId: number, title: string, created?: string): PlannerTask => ({
  id, uuid: `t${id}`, title, status: null, nodeIds: [nodeId], isNode: false, deadline: null, scheduled: null, ...(created ? { created } : {}),
});
// Alphabetical and by date the old ones come first; by created day the new ones do.
const NODES = [
  node(1, "Archive old wiki", "2025-01-10"),
  node(2, "Budget review", "2026-10-12"),
  node(3, "Customer onboarding", "2026-03-01"),
  node(4, "Draft pricing", "2026-10-13"),
  node(5, "Early import", undefined),
];
const items = (nodes = NODES, tasks: PlannerTask[] = []) => viewItems(nodes, tasks, () => ({ start: null, end: END }), []);
const NEWEST = ["Draft pricing", "Budget review", "Customer onboarding", "Archive old wiki", "Early import"];

describe("piles list the newest first (N74)", () => {
  it("the Calendar's No date tray", () => {
    const l = layoutCalendar({ items: items(), layout: "month", anchor: TODAY, today: TODAY, weekStart: 1, statusValues: [], titles: none });
    expect(l.undated.map((u) => u.title)).toEqual(NEWEST);
    const grid = layoutCalendar({ items: items(), layout: "week", anchor: TODAY, today: TODAY, weekStart: 1, statusValues: [], titles: none });
    expect(grid.undated.map((u) => u.title)).toEqual(NEWEST);
  });

  it("the Matrix's Unplaced list; the cells keep their due-date order", () => {
    const l = layoutMatrix({
      items: items(), x: { prop: whenColumnProp(whenPeriods(TODAY, 1)), reverse: false, first: ["overdue", "today", "tomorrow", "week"] },
      y: { prop: PRIORITY, reverse: true, first: ["p-high"] }, periods: whenPeriods(TODAY, 1), mode: "quadrants", showDone: false, labels: ["", "", "", ""],
      today: TODAY, doneValues: {}, titles: none, pending: new Set(),
    });
    expect(l.unplaced.map((c) => c.title)).toEqual(NEWEST);
  });

  it("the Agenda by node: a group is as new as its node or its newest task", () => {
    const tasks = [task(10, 1, "Review the wiki move", "2026-10-14")]; // an old node with a task added today
    const l = layoutAgenda({ items: items(NODES, tasks), groupBy: "node", showDone: false, today: TODAY, statusValues: [], choiceProps: [], doneValues: {}, titles: none });
    expect(l.groups.map((g) => g.node.title)).toEqual(["Archive old wiki", ...NEWEST.filter((t) => t !== "Archive old wiki")]);
  });

  it("the Kanban's Overdue and No date columns by When, whatever the Sort; the other columns follow the Sort", () => {
    const overdue = [node(6, "Alpha overdue", "2025-05-01", "2026-09-01"), node(7, "Beta overdue", "2026-10-10", "2026-10-01")];
    const soon = [node(8, "Zeta soon", "2026-10-13", "2026-10-15"), node(9, "Eta soon", "2025-01-01", "2026-10-15")];
    const periods = whenPeriods(TODAY, 1);
    const l = layoutKanban({
      items: items([...NODES, ...overdue, ...soon]), columnProp: whenColumnProp(periods), laneProp: null, sort: "title", today: TODAY, choiceProps: [],
      doneValues: {}, titles: none, pending: new Set(), hidden: [], when: { periods, fixed: () => false },
    });
    const cards = (key: string) => l.rows[0].cells.find((c) => c.column.key === key)!.cards.map((c) => c.title);
    expect(cards("none")).toEqual(NEWEST);
    expect(cards("overdue")).toEqual(["Beta overdue", "Alpha overdue"]);
    expect(cards("tomorrow")).toEqual(["Eta soon", "Zeta soon"]); // by title, the Sort
    expect(WHEN_KEY).toBe("@when");
  });
});
