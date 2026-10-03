// Agenda layout: the visible nodes and their linked tasks as dated entries, filed into buckets (overdue, today, each of
// the next 14 days, later, no date, earlier) or grouped by node. Pure: no DOM, no SDK, no clock (`today` is injected).
//
// Filing rules (REQUIREMENTS "Agenda"):
// - An entry has a start and an end day. A node uses its resolved span (Start/End, one date = a point); a task uses
//   Scheduled and Deadline (one of them = a point). No date = "none".
// - It ended before today: Overdue when it is open and could be late (a task always can; a node only when its tag has
//   a done notion), else Earlier. Done entries are never overdue.
// - It covers today (started on or before today, ends today or later): Today. Starts later: its start day while that is
//   within 14 days, else Later.
// - Done (a node by the view's done values, a task by its Status flags; canceled counts) and canceled entries are hidden
//   unless Show done is on. Show done reveals those filed under Today, a day, Earlier (at most 14 days back) or No
//   date; a done entry never goes under Later.
// - A node whose span is derived from its tasks is not listed by date (its tasks are); by node it keeps its group.
import type { ChoiceProp, ClosedValue, LocalDate, PlannerNode, PlannerTask, Rollup } from "../types";
import { displayTitle } from "./display-title";
import {
  addDays, categoryOf, compareDates, daysBetween, formatDate, formatDay, taskLabel, taskState, weekdayName, type ViewItem,
} from "./layout-common";
import { isDone } from "./nodes";

/** REQUIREMENTS: Agenda ranges other than 14 days are a non-goal. */
export const HORIZON_DAYS = 14;

export type AgendaGroupBy = "node" | "date";
/** "overdue" | "today" | "later" | "none" | "earlier" | a day `YYYY-MM-DD` (tomorrow … today + 14). */
export type BucketKey = string;

export interface AgendaEntry {
  kind: "node" | "task";
  /** What a click opens: the node or the task block. */
  uuid: string;
  /** Display title (inline refs resolved). */
  title: string;
  /** Tasks: the node's display title; null for nodes. */
  node: string | null;
  /** Category colour 1–6 of the node (a task takes its node's). */
  cat: number;
  /** Tasks: Status key (`todo`, `doing`, `done`, `canceled`, …) or null; null for nodes. */
  status: string | null;
  bucket: BucketKey;
  /** Sort date: the end when it ended, the start when it is ahead, today when it covers today (with the time of that day's start or end). */
  at: LocalDate | null;
  done: boolean;
  /** Open and past its end: it is in Overdue. */
  late: boolean;
  /** "due 5 Oct 17:00", "23 Sep – 23 Oct", "due 2 Oct 12:00, 1 day late", "no date". */
  when: string;
  /** Accessible name: title, when, state, node. */
  label: string;
}

export interface AgendaBucket {
  key: BucketKey;
  /** "Overdue", "Today · Sat 3 Oct", "Tomorrow · Sun 4 Oct", "Mon 5 Oct", "Later than 14 days", "No date", "Earlier". */
  label: string;
  /** Later, No date and Earlier start folded. */
  collapsed: boolean;
  entries: AgendaEntry[];
}

export interface AgendaGroup {
  /** The node's own dated line. */
  node: AgendaEntry;
  /** Its visible tasks: overdue first, then by date, then title. */
  tasks: AgendaEntry[];
  progress: Rollup;
  /** Linked tasks that are not done (hidden or not). */
  open: number;
  /** Choice values for the header, in the tag's property order (Status, Owner). */
  meta: string[];
}

export interface AgendaLayout {
  groupBy: AgendaGroupBy;
  /** Date grouping; empty for node grouping. */
  buckets: AgendaBucket[];
  /** Node grouping; empty for date grouping. */
  groups: AgendaGroup[];
  /** Nothing to list in the chosen grouping. */
  empty: boolean;
}

export interface AgendaInput {
  items: ViewItem[];
  groupBy: AgendaGroupBy;
  showDone: boolean;
  today: string;
  /** Task Status closed values (built-in flags decide done). */
  statusValues: ClosedValue[];
  /** The tag's choice properties: they say what has a done notion and name the node's header values. */
  choiceProps: ChoiceProp[];
  /** The view's done override: closed-value uuids by choice property ident. */
  doneValues: Record<string, string[]>;
  /** Titles of the loaded nodes by uuid (`titlesByUuid`), for inline refs in titles. */
  titles: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------- filing

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Which bucket a span `start`…`end` is filed under, and the date it sorts by. */
function file(start: LocalDate | null, end: LocalDate | null, done: boolean, canBeLate: boolean, today: string): { bucket: BucketKey; at: LocalDate | null } {
  if (!start || !end) return { bucket: "none", at: null };
  if (end.day < today) return { bucket: done || !canBeLate ? "earlier" : "overdue", at: end };
  if (start.day <= today) return { bucket: "today", at: { day: today, time: start.day === today ? start.time : end.day === today ? end.time : null } };
  return { bucket: daysBetween(today, start.day) <= HORIZON_DAYS ? start.day : "later", at: start };
}

/** "2 Oct 12:00" / "23 Sep – 23 Oct" for a node, "due …" / "scheduled …" for a task; ", N days late" when overdue. */
function whenText(parts: string[], end: LocalDate | null, late: boolean, today: string): string {
  const base = parts.join(", ") || "no date";
  return late && end ? `${base}, ${plural(daysBetween(end.day, today))} late` : base;
}

const bucketLabel = (key: BucketKey, today: string): string => {
  switch (key) {
    case "overdue": return "Overdue";
    case "today": return `Today · ${weekdayName(today)} ${formatDay(today)}`;
    case "later": return `Later than ${HORIZON_DAYS} days`;
    case "none": return "No date";
    case "earlier": return "Earlier";
    default: return key === addDays(today, 1) ? `Tomorrow · ${weekdayName(key)} ${formatDay(key)}` : `${weekdayName(key)} ${formatDay(key)}`;
  }
};

/** Fixed bucket order; the days between Today and Later sort by date. */
const rank = (key: BucketKey): number => ({ overdue: 0, today: 1, later: 3, none: 4, earlier: 5 } as Record<string, number>)[key] ?? 2;
const COLLAPSED = new Set(["later", "none", "earlier"]);

/** Dated before undated, then by date and time, then title. */
const byAt = (a: AgendaEntry, b: AgendaEntry): number =>
  (a.at ? (b.at ? compareDates(a.at, b.at) : -1) : b.at ? 1 : 0) || a.title.localeCompare(b.title);

// ---------------------------------------------------------------- layout

interface Built {
  node: AgendaEntry;
  derived: boolean;
  tasks: AgendaEntry[];
  item: ViewItem;
}

export function layoutAgenda(input: AgendaInput): AgendaLayout {
  const { today } = input;
  const hasDoneNotion = input.choiceProps.some((p) => p.values.some((v) => isDone(v, input.doneValues[p.ident])));
  const nodeDone = (n: PlannerNode) => Object.entries(n.choices).some(([ident, v]) => isDone(v, input.doneValues[ident]));
  const seenTasks = new Set<number>();

  const built: Built[] = input.items.map((item) => {
    const { node, span, tasks, progress } = item;
    const title = displayTitle(node.title, input.titles);
    const cat = categoryOf(node.uuid);
    const done = nodeDone(node);
    const { bucket, at } = file(span.start, span.end, done, hasDoneNotion, today);
    const late = bucket === "overdue";
    const when = whenText(
      span.start && span.end ? [span.start.day === span.end.day && span.start.time === span.end.time ? formatDate(span.start) : `${formatDate(span.start)} – ${formatDate(span.end)}`] : [],
      span.end, late, today,
    );
    const nodeEntry: AgendaEntry = {
      kind: "node", uuid: node.uuid, title, node: null, cat, status: null, bucket, at, done, late, when,
      label: [title, when, progress.total ? `${progress.done} of ${progress.total} done` : "", done && "done"].filter(Boolean).join(", "),
    };
    const taskEntries: AgendaEntry[] = [];
    for (const task of tasks) {
      if (seenTasks.has(task.id)) continue; // linked to several nodes: the first wins
      seenTasks.add(task.id);
      taskEntries.push(taskEntry(task, title, cat));
    }
    return { node: nodeEntry, derived: span.kind === "derived", tasks: taskEntries, item };
  });

  function taskEntry(task: PlannerTask, nodeTitle: string, cat: number): AgendaEntry {
    const { status, done } = taskState(task, input.statusValues);
    const title = displayTitle(task.title, input.titles);
    const ends = [task.scheduled, task.deadline].filter((x): x is LocalDate => x !== null).sort(compareDates);
    const start = ends[0] ?? null;
    const end = ends[ends.length - 1] ?? null;
    const { bucket, at } = file(start, end, done, true, today);
    const late = bucket === "overdue";
    const when = whenText(
      [task.scheduled && `scheduled ${formatDate(task.scheduled)}`, task.deadline && `due ${formatDate(task.deadline)}`].filter((x): x is string => !!x),
      end, late, today,
    );
    return {
      kind: "task", uuid: task.uuid, title, node: nodeTitle, cat, status, bucket, at, done, late, when,
      label: [taskLabel(task, title), late && `${plural(daysBetween(end!.day, today))} late`, nodeTitle].filter(Boolean).join(", "),
    };
  }

  /** Done and canceled entries need Show done, and then only where the buckets show them (see the header). */
  const shown = (e: AgendaEntry): boolean => {
    if (!e.done) return true;
    if (!input.showDone || e.bucket === "later") return false;
    return e.bucket !== "earlier" || daysBetween(e.at!.day, today) <= HORIZON_DAYS;
  };

  if (input.groupBy === "date") {
    const entries = built.flatMap((b) => [...(b.derived ? [] : [b.node]), ...b.tasks]).filter(shown);
    const buckets = new Map<BucketKey, AgendaEntry[]>();
    for (const e of entries) buckets.set(e.bucket, [...(buckets.get(e.bucket) ?? []), e]);
    const list: AgendaBucket[] = [...buckets]
      .map(([key, es]) => ({ key, label: bucketLabel(key, today), collapsed: COLLAPSED.has(key), entries: es.sort(byAt) }))
      .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
    return { groupBy: "date", buckets: list, groups: [], empty: list.length === 0 };
  }

  const groups: AgendaGroup[] = built
    .map((b) => ({ b, tasks: b.tasks.filter(shown).sort(byAt) }))
    .filter(({ b, tasks }) => shown(b.node) || tasks.length > 0)
    .map(({ b, tasks }) => ({
      node: b.node, tasks, progress: b.item.progress, open: b.tasks.filter((t) => !t.done).length,
      meta: input.choiceProps.map((p) => b.item.node.choices[p.ident]?.title).filter((t): t is string => !!t),
    }));
  const lead = (g: AgendaGroup) => [...(shown(g.node) ? [g.node] : []), ...g.tasks].filter((e) => e.at).sort(byAt)[0];
  const overdue = (g: AgendaGroup) => (shown(g.node) && g.node.late) || g.tasks.some((t) => t.late);
  groups.sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || byAt(lead(a) ?? a.node, lead(b) ?? b.node) || 0);
  return { groupBy: "node", buckets: [], groups, empty: groups.length === 0 };
}
