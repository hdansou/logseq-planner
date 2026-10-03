// Pure node logic: spans, rollups, done values, choice filters. No DOM, no SDK, no queries.
import type { ChoiceFilters, ClosedValue, LocalDate, NodeSpan, PlannerNode, PlannerTask, Rollup } from "../types";

/** Day first, then wall-clock time (a Date value has none and sorts first on its day). Re-exported by layout-common. */
export const compareDates = (a: LocalDate, b: LocalDate): number => a.day.localeCompare(b.day) || (a.time ?? "").localeCompare(b.time ?? "");

/** Tasks that reference `node`. */
export const tasksOf = (node: PlannerNode, tasks: PlannerTask[]): PlannerTask[] => tasks.filter((t) => t.nodeIds.includes(node.id));

const span = (kind: "mapped" | "derived", start: LocalDate, end: LocalDate): NodeSpan => ({ kind, start, end });

/**
 * Where `node` sits on the time axis. Mapped Start/End win: both = span, one = point. With none,
 * the span runs from the earliest to the latest Scheduled/Deadline of `tasks` that reference it
 * (any status); no dates at all = undated. Either ident may be null (the view maps no Start or no End).
 */
export function resolveSpan(node: PlannerNode, tasks: PlannerTask[], startIdent: string | null, endIdent: string | null): NodeSpan {
  const start = startIdent === null ? undefined : node.dates[startIdent];
  const end = endIdent === null ? undefined : node.dates[endIdent];
  if (start && end) return span("mapped", start, end);
  const only = start ?? end;
  if (only) return { kind: "point", start: only, end: only };
  const dates = tasksOf(node, tasks).flatMap((t) => [t.scheduled, t.deadline].filter((x): x is LocalDate => x !== null));
  if (dates.length === 0) return { kind: "undated", start: null, end: null };
  dates.sort(compareDates);
  return span("derived", dates[0], dates[dates.length - 1]);
}

/** Names that count as done by default for a user choice property (REQUIREMENTS: done values). */
const GUESS_DONE = new Set(["done", "completed", "canceled", "cancelled", "closed"]);
const GUESS_CANCELED = new Set(["canceled", "cancelled"]);
const lower = (v: ClosedValue) => v.title.trim().toLowerCase();
/** Built-in values (they have an ident) are judged by their flags, user values by name. */
const isBuiltIn = (v: ClosedValue) => v.ident !== null;

/**
 * Does `value` close its node or task? An explicit `doneUuids` list (the view's saved choice, closed-value
 * uuids so a rename does not break it) wins; otherwise built-in values use their checkbox flag or Canceled
 * flag, and user values are guessed by name.
 */
export function isDone(value: ClosedValue, doneUuids?: string[]): boolean {
  if (doneUuids) return doneUuids.includes(value.uuid);
  if (isBuiltIn(value)) return value.checkbox === true || value.canceled;
  return GUESS_DONE.has(lower(value));
}

/** A node is done when any of its choice values is done under the view's done values (Agenda, Kanban). */
export const isNodeDone = (node: PlannerNode, doneValues: Record<string, string[]>): boolean =>
  Object.entries(node.choices).some(([ident, v]) => isDone(v, doneValues[ident]));

/** Canceled values leave the rollup's total. Built-in: the flag; user values: Canceled / Cancelled. */
export const isCanceled = (value: ClosedValue): boolean => (isBuiltIn(value) ? value.canceled : GUESS_CANCELED.has(lower(value)));

/**
 * done / (all − canceled) over `tasks`. `statusValues` are the Task Status closed values, matched
 * by ident; a task without a (known) status is open. Canceled never counts as done.
 */
export function rollup(tasks: PlannerTask[], statusValues: ClosedValue[]): Rollup {
  const byIdent = new Map(statusValues.map((v) => [v.ident, v]));
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    const v = t.status ? byIdent.get(t.status.ident) : undefined;
    if (v && isCanceled(v)) continue;
    total++;
    if (v && isDone(v)) done++;
  }
  return { done, total };
}

/** Keeps nodes matching every filtered property (AND); within a property any selected value matches (OR). */
export function filterNodes(nodes: PlannerNode[], filters: ChoiceFilters): PlannerNode[] {
  const active = Object.entries(filters).filter(([, selected]) => selected.length > 0);
  return nodes.filter((n) => active.every(([ident, selected]) => selected.includes(n.choices[ident]?.id ?? null)));
}
