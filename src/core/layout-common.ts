// Shared by the view layouts (Timeline, Calendar): calendar-day arithmetic and formatting, the host week start,
// category colour, the view items (span + linked tasks + rollup) and the accessible label pieces.
// Pure: no DOM, no SDK, no clock. Days are `YYYY-MM-DD` calendar days; all arithmetic runs on UTC midnights, which have
// no DST, so a day is always one day.
import type { ClosedValue, LocalDate, NodeSpan, PlannerNode, PlannerTask, Rollup } from "../types";
import { compareDates, isDone, resolveSpan, rollup } from "./nodes";

// ---------------------------------------------------------------- calendar days

const DAY_MS = 86_400_000;
const utc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => iso(utc(day) + n * DAY_MS);
export const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY_MS);
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (day: string): number => new Date(utc(day)).getUTCDay();
/** The first day of `day`'s week; `weekStart` 0 = Sunday … 6 = Saturday. */
export const startOfWeek = (day: string, weekStart: number): string => addDays(day, -((weekday(day) - weekStart + 7) % 7));
/** The 1st of `day`'s month moved by `months` (any sign). */
export const firstOfMonth = (day: string, months = 0): string => {
  const [y, m] = day.split("-").map(Number);
  return iso(Date.UTC(y, m - 1 + months, 1));
};
export { compareDates };

/** "1 day" / "N days". */
export const dayCount = (n: number): string => `${n} day${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- formatting

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Sat". */
export const weekdayName = (day: string): string => WEEKDAYS[weekday(day)];
/** "23 Sep"; with `year`, "23 Sep 2026". */
export const formatDay = (day: string, year = false): string =>
  `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}${year ? ` ${day.slice(0, 4)}` : ""}`;
/** "October 2026". */
export const formatMonth = (day: string): string => `${MONTHS_LONG[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
/** "27 Sep – 3 Oct 2026"; both years when they differ. */
export const formatRange = (start: string, end: string): string =>
  `${formatDay(start, start.slice(0, 4) !== end.slice(0, 4))} – ${formatDay(end, true)}`;
/** "3 Oct 10:30" or "3 Oct". */
export const formatDate = (d: LocalDate): string => formatDay(d.day) + (d.time ? ` ${d.time}` : "");
/** "23 Sep – 23 Oct"; one date ("9 Oct 09:00") when both ends are the same day and time. */
export const formatSpan = (start: LocalDate, end: LocalDate): string =>
  start.day === end.day && start.time === end.time ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;

// ---------------------------------------------------------------- host week start

/**
 * Logseq's `preferredStartOfWeek` (0–6 = Monday–Sunday, default 6 = Sunday; the host converts with
 * `(mod (inc n) 7)`) → the layouts' 0 = Sunday … 6 = Saturday. Live it arrives as a number; the SDK types it as a
 * string, so a numeric string is accepted too. Anything else throws.
 */
export function weekStartFromHost(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && /^[0-6]$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 6) throw new Error(`Logseq preferredStartOfWeek is ${JSON.stringify(value) ?? String(value)}, expected 0–6`);
  return (n + 1) % 7;
}

// ---------------------------------------------------------------- items, colour, labels

/** A small stable hash of the uuid → category 1–6 (7, red, is left out: it reads as late). */
export const categoryOf = (uuid: string): number => {
  let h = 0;
  for (const c of uuid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 6) + 1;
};

/** A node with what a view needs: its resolved span, linked tasks and rollup. */
export interface ViewItem {
  node: PlannerNode;
  span: NodeSpan;
  tasks: PlannerTask[];
  progress: Rollup;
}

/** Resolves spans, linked tasks and rollups for `nodes` (the view's Start/End idents, either may be null). */
export function viewItems(nodes: PlannerNode[], tasks: PlannerTask[], start: string | null, end: string | null, statusValues: ClosedValue[]): ViewItem[] {
  // Tasks by node id, in task order (what `tasksOf` returns per node), built once: 2,000 nodes × 2,000 tasks (T13a).
  const byNode = new Map<number, PlannerTask[]>();
  for (const t of tasks) {
    for (const id of new Set(t.nodeIds)) {
      const list = byNode.get(id);
      if (list) list.push(t);
      else byNode.set(id, [t]);
    }
  }
  return nodes.map((node) => {
    const own = byNode.get(node.id) ?? [];
    return { node, span: resolveSpan(node, own, start, end), tasks: own, progress: rollup(own, statusValues) };
  });
}

/** A task's status key (last segment of the Status ident: `todo`, `doing`, `done`, `canceled`, …; null without one) and done flag. */
export function taskState(task: PlannerTask, statusValues: ClosedValue[]): { status: string | null; done: boolean } {
  const value = task.status ? statusValues.find((v) => v.ident === task.status!.ident) : undefined;
  return { status: task.status ? task.status.ident.split(".").pop()! : null, done: value ? isDone(value) : false };
}

/** A task's due date: its Deadline, or its Scheduled date when it has no Deadline (null when it has neither). */
export const dueDate = (task: PlannerTask): LocalDate | null => task.deadline ?? task.scheduled;

/** The one lateness rule for tasks in every view: an open task whose due date (`dueDate`) is on a day before today. */
export const isLate = (task: PlannerTask, done: boolean, today: string): boolean => {
  const due = dueDate(task);
  return !done && !!due && due.day < today;
};

/** "Draft brief Website relaunch, Todo, due 5 Oct 17:00" (`title` is the display title). */
export function taskLabel(task: PlannerTask, title: string): string {
  const when = [task.scheduled && `scheduled ${formatDate(task.scheduled)}`, task.deadline && `due ${formatDate(task.deadline)}`].filter(Boolean).join(", ") || "no date";
  return [title, task.status?.title, when].filter(Boolean).join(", ");
}

/** "Website relaunch, 23 Sep – 23 Oct, 1 of 2 done" for a dated node (`title` is the display title). */
export function nodeLabel(title: string, span: NodeSpan, progress: Rollup): string {
  const start = span.start!;
  const end = span.end!;
  const dates = span.kind === "point" ? formatDate(start) : `${formatSpan(start, end)}${span.kind === "derived" ? " from its tasks" : ""}`;
  return [title, dates, progress.total ? `${progress.done} of ${progress.total} done` : ""].filter(Boolean).join(", ");
}
