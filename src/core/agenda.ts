// Agenda layout: the visible nodes and their linked tasks as dated entries, filed into buckets (overdue, today, each of
// the next 14 days, later, no date, earlier) or grouped by node. Pure: no DOM, no SDK, no clock (`today` is injected).
//
// Filing rules (REQUIREMENTS "Agenda"):
// - An entry has a start and an end day. A node uses its resolved span (Start/End, one date = a point); a task uses
//   Scheduled and Deadline (one of them = a point). No date = "none".
// - A task is late by `isLate` (layout-common): open, and its due date (Deadline, else Scheduled) is before today. A late
//   task is Overdue, filed and sorted at its due date and "N days late" counts from it, whatever its other date is.
//   A task that is not late is filed by the rules below.
// - A node that ended before today: Overdue when it is open and its tag has a done notion, else Earlier. Done entries
//   are never overdue.
// - It covers today (started on or before today, ends today or later): Today. Starts later: its start day while that is
//   within 14 days, else Later.
// - Done (a node by the view's done values, a task by its Status flags; canceled counts) and canceled entries are hidden
//   unless Show done is on. Show done reveals those filed under Today, a day, Earlier (at most 14 days back) or No
//   date; a done entry never goes under Later.
// - A node whose span is derived from its tasks is not listed by date (its tasks are); by node it keeps its group.
// - Nested by node (N14 step 2, `nest`): a child node is an entry of its parent's group (with its own dates, late and
//   done state, and followed by its own task entries), never a group of its own.
import type { ChoiceProp, ClosedValue, LocalDate, PlannerNode, PlannerTask, Rollup } from "../types";
import { displayTitle } from "./display-title";
import {
  addDays, byNewest, categoryOf, compareDates, dayCount, daysBetween, dueDate, formatDate, formatDay, formatSpan, isLate, taskLabel, taskState, weekdayName, type ViewItem,
} from "./layout-common";
import { isDone, isNodeDone } from "./nodes";

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
  /** Open and past its due date (a node: its end): it is in Overdue. */
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
  /** Its visible tasks (nested, N14: and its child nodes and their tasks): overdue first, then by date, then title. */
  tasks: AgendaEntry[];
  progress: Rollup;
  /** Linked tasks (nested: and children) that are not done (hidden or not). */
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
  /** By node, nested (N14 step 2): the parent node id by child node id (`nestItems`); absent = every node its own group. */
  nest?: ReadonlyMap<number, number>;
}

// ---------------------------------------------------------------- filing

/** Which bucket a span `start`…`end` is filed under, and the date it sorts by. */
function file(start: LocalDate | null, end: LocalDate | null, done: boolean, canBeLate: boolean, today: string): { bucket: BucketKey; at: LocalDate | null } {
  if (!start || !end) return { bucket: "none", at: null };
  if (end.day < today) return { bucket: done || !canBeLate ? "earlier" : "overdue", at: end };
  if (start.day <= today) return { bucket: "today", at: { day: today, time: start.day === today ? start.time : end.day === today ? end.time : null } };
  return { bucket: daysBetween(today, start.day) <= HORIZON_DAYS ? start.day : "later", at: start };
}

/** "2 Oct 12:00" / "23 Sep – 23 Oct" for a node, "due …" / "scheduled …" for a task; ", N days late" when overdue. */
function whenText(parts: string[], end: LocalDate | null, late: boolean, today: string): string {
  const base = withoutMidnight(parts.join(", ") || "no date");
  return late && end ? `${base}, ${dayCount(daysBetween(end.day, today))} late` : base;
}

/** N63: a node's built-in Status (`:logseq.property/status.doing` → "doing"), the name a task's status icon is drawn from; null without one. */
const nodeStatus = (node: PlannerNode): string | null => {
  const v = Object.values(node.choices).find((c) => c.ident?.startsWith(":logseq.property/status."));
  return v?.ident ? v.ident.split(".").pop()! : null;
};

/** N62: a time of 00:00 is a date with no time (nobody schedules the stroke of midnight), so it is not shown. */
export const withoutMidnight = (text: string): string => text.replace(/ 00:00\b/g, "");

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
  /** Its tasks for the date buckets: one linked to several nodes is here under the first only. */
  tasks: AgendaEntry[];
  /** All its tasks, for its own group by node (N30). */
  allTasks: AgendaEntry[];
  item: ViewItem;
}

export function layoutAgenda(input: AgendaInput): AgendaLayout {
  const { today } = input;
  const hasDoneNotion = input.choiceProps.some((p) => p.values.some((v) => isDone(v, input.doneValues[p.ident])));
  const nodeDone = (n: PlannerNode) => isNodeDone(n, input.doneValues);
  const seenTasks = new Set<number>();

  const built: Built[] = input.items.map((item) => {
    const { node, span, tasks, progress } = item;
    const title = displayTitle(node.title, input.titles);
    const cat = categoryOf(node.uuid);
    const done = nodeDone(node);
    const { bucket, at } = file(span.start, span.end, done, hasDoneNotion, today);
    const late = bucket === "overdue";
    const when = whenText(
      span.start && span.end ? [formatSpan(span.start, span.end)] : [],
      span.end, late, today,
    );
    const nodeEntry: AgendaEntry = {
      kind: "node", uuid: node.uuid, title, node: null, cat, status: nodeStatus(node), bucket, at, done, late, when,
      label: [title, when, progress.total ? `${progress.done} of ${progress.total} done` : "", done && "done"].filter(Boolean).join(", "),
    };
    const allTasks = tasks.map((task) => ({ id: task.id, entry: taskEntry(task, title, cat) }));
    // By date a task linked to several nodes is one entry, under the first; by node it is listed under each (N30).
    const first = allTasks.filter(({ id }) => !seenTasks.has(id) && seenTasks.add(id));
    return { node: nodeEntry, derived: span.kind === "derived", tasks: first.map((t) => t.entry), allTasks: allTasks.map((t) => t.entry), item };
  });

  function taskEntry(task: PlannerTask, nodeTitle: string, cat: number): AgendaEntry {
    const { status, done } = taskState(task, input.statusValues);
    const title = displayTitle(task.title, input.titles);
    const ends = [task.scheduled, task.deadline].filter((x): x is LocalDate => x !== null).sort(compareDates);
    const start = ends[0] ?? null;
    const end = ends[ends.length - 1] ?? null;
    const due = dueDate(task);
    const late = isLate(task, done, today);
    // A late task is filed and sorted at its due date (a Deadline passed with a later Scheduled date is still late).
    const { bucket, at } = late ? { bucket: "overdue", at: due } : file(start, end, done, true, today);
    const when = whenText(
      [task.scheduled && `scheduled ${formatDate(task.scheduled)}`, task.deadline && `due ${formatDate(task.deadline)}`].filter((x): x is string => !!x),
      due, late, today,
    );
    return {
      kind: "task", uuid: task.uuid, title, node: nodeTitle, cat, status, bucket, at, done, late, when,
      label: [taskLabel(task, title), late && `${dayCount(daysBetween(due!.day, today))} late`, nodeTitle].filter(Boolean).join(", "),
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

  // Nested: each child's line and its tasks join its parent's entries (the parent is one of the items: `nestItems` ran
  // over the same ones); a child has no group of its own.
  const nest = input.nest ?? new Map<number, number>();
  const under = new Map<number, AgendaEntry[]>();
  for (const b of built) {
    const pid = nest.get(b.item.node.id);
    if (pid === undefined) continue;
    const list = under.get(pid);
    if (list) list.push(b.node, ...b.allTasks);
    else under.set(pid, [b.node, ...b.allTasks]);
  }
  /** A task linked to a parent and to its child, or to two children, is one entry in the parent's group. */
  const once = (entries: AgendaEntry[]) => {
    const seen = new Set<string>();
    return entries.filter((e) => e.kind === "node" || (!seen.has(e.uuid) && seen.add(e.uuid)));
  };
  const groups: AgendaGroup[] = built
    .filter((b) => !nest.has(b.item.node.id))
    .map((b) => ({ ...b, tasks: once([...b.allTasks, ...(under.get(b.item.node.id) ?? [])]) }))
    .map((b) => ({ b, tasks: b.tasks.filter(shown).sort(byAt) }))
    .filter(({ b, tasks }) => shown(b.node) || tasks.length > 0)
    .map(({ b, tasks }) => ({
      node: b.node, tasks, progress: b.item.progress, open: b.tasks.filter((t) => !t.done).length,
      meta: input.choiceProps.map((p) => b.item.node.choices[p.ident]?.title).filter((t): t is string => !!t),
    }));
  const lead = (g: AgendaGroup) => [...(shown(g.node) ? [g.node] : []), ...g.tasks].filter((e) => e.at).sort(byAt)[0];
  const overdue = (g: AgendaGroup) => (shown(g.node) && g.node.late) || g.tasks.some((t) => t.late);
  // N74: the newest group first: a group is as new as its node or its newest task; then overdue ones, then by date.
  const created = new Map(input.items.flatMap((i) => [[i.node.uuid, i.node.created], ...i.tasks.map((t) => [t.uuid, t.created] as const)]));
  const newestOf = (g: AgendaGroup) => [g.node, ...g.tasks].map((e) => created.get(e.uuid) ?? "").reduce((m, d) => (d > m ? d : m), "") || undefined;
  groups.sort((a, b) => byNewest(newestOf(a), newestOf(b)) || Number(overdue(b)) - Number(overdue(a)) || byAt(lead(a) ?? a.node, lead(b) ?? b.node) || 0);
  return { groupBy: "node", buckets: [], groups, empty: groups.length === 0 };
}
