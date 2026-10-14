// When (N67): the view's dates in periods, from Overdue to No date, and the date writes that move a node into one.
// Pure: `today` and the host's week start are injected; the writes go through Edit dates' `writeDates` (read back,
// rolled back on failure).
//
// Rules:
// - Periods follow each other without a gap: Overdue (before today), Today, Tomorrow, This week (to the week's last
//   day, by the host's week start), Next week, This month, This quarter, Later (after the quarter), then No date. Each
//   starts the day after the one before ends, so a period with no days left (This week on its last day, This month
//   when next week reaches the next month) is left out.
// - A move writes the period's last day ("due by"); Overdue and Later have none and take no move. A node already in
//   the period keeps its date. To No date removes the node's mapped dates.
// - What is written follows the node's span: Start and End = End on the day, Start moved by the same days (the length
//   is kept); one date = that date; none, or a span derived from its tasks = the End, else the Start (a DateTime at
//   00:00), so the node gets a date of its own. A DateTime keeps its time. A node whose tag maps no Start or End cannot
//   move.
import type { ChoiceProp, DateProp, LocalDate, NodeSpan, PlannerNode } from "../types";
import type { DateWrite } from "./date-edit";
import { addDays, daysBetween, firstOfMonth, startOfWeek } from "./layout-common";

/** The When pseudo-property: what the Kanban's Columns menu stores for columns by period. */
export const WHEN_KEY = "@when";

/** Every period that can be a value of When, in order (No date is no value). */
export const WHEN_KEYS: readonly string[] = ["overdue", "today", "tomorrow", "week", "next", "month", "quarter", "later"];

/** N70: When as a Matrix axis starts with these periods in its first band: up to the end of this week. */
export const WHEN_FIRST: string[] = ["overdue", "today", "tomorrow", "week"];

/**
 * N70: a When axis's first band as saved, for the first `count` of the periods `shown` today (in the axis's order): every
 * period key before the first one left out, so a period with no days today (This week on its last day) keeps its band
 * on the days it has some.
 */
export function whenFirst(shown: readonly string[], count: number, reverse: boolean): string[] {
  const order = reverse ? [...WHEN_KEYS].reverse() : [...WHEN_KEYS];
  const cut = shown[count];
  return cut === undefined ? order : order.slice(0, order.indexOf(cut));
}

/** The periods, and "day": one day as a target (N68, an Agenda day heading, `dayPeriod`). */
export type PeriodKey = "overdue" | "today" | "tomorrow" | "week" | "next" | "month" | "quarter" | "later" | "none" | "day";

export interface Period {
  key: PeriodKey;
  title: string;
  /** Its first and last day (null = open, or none for No date). */
  first: string | null;
  last: string | null;
  /** The day a move into it writes; null = it takes no move (Overdue, Later) or removes the dates (No date). */
  drop: string | null;
}

/** The node's mapped Start and End properties (the view's Dates for its tag). */
export interface WhenProps {
  start: DateProp | null;
  end: DateProp | null;
}

/** The periods on `today` with weeks starting on `weekStart` (0 = Sunday); see the rules above. */
export function whenPeriods(today: string, weekStart: number): Period[] {
  const weekEnd = addDays(startOfWeek(today, weekStart), 6);
  const month = Number(today.slice(5, 7));
  const ends: [PeriodKey, string, string][] = [
    ["today", "Today", today],
    ["tomorrow", "Tomorrow", addDays(today, 1)],
    ["week", "This week", weekEnd],
    ["next", "Next week", addDays(weekEnd, 7)],
    ["month", "This month", addDays(firstOfMonth(today, 1), -1)],
    ["quarter", "This quarter", addDays(firstOfMonth(today, 3 - ((month - 1) % 3)), -1)],
  ];
  const out: Period[] = [{ key: "overdue", title: "Overdue", first: null, last: addDays(today, -1), drop: null }];
  let first = today;
  for (const [key, title, last] of ends) {
    if (last < first) continue;
    out.push({ key, title, first, last, drop: last });
    first = addDays(last, 1);
  }
  out.push({ key: "later", title: "Later", first, last: null, drop: null }, { key: "none", title: "No date", first: null, last: null, drop: null });
  return out;
}

/**
 * The periods as the Kanban's column property (N67): one "value" per period but No date, keyed by period key (the
 * board adds its own "No" column, keyed "none" as No date is). Not a real property: never written as one.
 */
export const whenColumnProp = (periods: Period[]): ChoiceProp => ({
  id: 0, ident: WHEN_KEY, title: "When",
  values: periods.filter((p) => p.key !== "none").map((p) => ({ id: 0, uuid: p.key, title: p.title, ident: null, order: "", checkbox: null, canceled: false })),
});

/** One day as a move's target (N68: an Agenda day heading): a period of that day alone. */
export const dayPeriod = (day: string): Period => ({ key: "day", title: day, first: day, last: day, drop: day });

/** The period `day` is in; null = No date. */
export function periodKey(periods: Period[], day: string | null): PeriodKey {
  if (day === null) return "none";
  return periods.find((p) => p.key !== "none" && (p.first === null || day >= p.first) && (p.last === null || day <= p.last))?.key ?? "later";
}

/**
 * The date writes that move `node` (with `span`, its tag's `props`) into `target`, in order (End first); none when it is
 * already there. Throws when it cannot move: into Overdue or Later, or no Start or End mapped.
 */
export function whenMove(node: PlannerNode, span: NodeSpan, props: WhenProps, target: Period): DateWrite[] {
  const own = ([props.end, props.start].filter(Boolean) as DateProp[]).filter((p) => node.dates[p.ident]);
  if (target.key === "none") return own.map((prop) => ({ prop, previous: node.dates[prop.ident], next: null }));
  if (target.drop === null) throw new Error(`Nothing can be moved to ${target.title}: it has no last day to write.`);
  if (!props.start && !props.end) throw new Error(`"${node.title}" has no Start or End property in this view: choose one under Dates.`);
  const day = target.drop;
  if (span.end && span.end.day >= (target.first ?? day) && span.end.day <= day) return [];
  const at = (d: LocalDate | null, prop: DateProp, delta: number): LocalDate =>
    d ? { day: addDays(d.day, delta), time: d.time } : { day: addDays(day, delta), time: prop.type === "datetime" ? "00:00" : null };
  if (!own.length) {
    const prop = (props.end ?? props.start)!;
    return [{ prop, previous: null, next: at(null, prop, 0) }];
  }
  const delta = daysBetween(span.end!.day, day);
  return own.map((prop) => ({ prop, previous: node.dates[prop.ident], next: at(node.dates[prop.ident], prop, delta) }));
}
