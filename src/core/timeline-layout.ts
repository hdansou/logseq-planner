// Timeline layout: visible range, axis columns, rows (bars, points, task markers), today line and the undated list.
// Pure: no DOM, no SDK, no clock (`today` is injected). Days are `YYYY-MM-DD` calendar days; all arithmetic runs on
// UTC midnights, which have no DST, so a day is always one day. Positions are day indices from the range start
// (`to` exclusive), so the UI places everything on one CSS grid of day tracks, whatever the zoom.
import type { ClosedValue, LocalDate, NodeSpan, PlannerNode, PlannerTask, Rollup } from "../types";
import { displayTitle } from "./display-title";
import { isDone, resolveSpan, rollup, tasksOf } from "./nodes";

export type Zoom = "week" | "month" | "quarter";

/** Range shape per zoom (prototype): columns are days (week, month) or weeks (quarter); `lead` days before the anchor's week; prev/next `step`. */
const ZOOM: Record<Zoom, { days: number; lead: number; step: number; unit: 1 | 7 }> = {
  week: { days: 21, lead: 7, step: 7, unit: 1 },
  month: { days: 56, lead: 14, step: 21, unit: 1 },
  quarter: { days: 119, lead: 28, step: 42, unit: 7 },
};

// ---------------------------------------------------------------- calendar days

const DAY_MS = 86_400_000;
const utc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (day: string, n: number): string => new Date(utc(day) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY_MS);
/** 0 = Sunday … 6 = Saturday. */
const weekday = (day: string) => new Date(utc(day)).getUTCDay();
const startOfWeek = (day: string, weekStart: number) => addDays(day, -((weekday(day) - weekStart + 7) % 7));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "23 Sep"; with `year`, "23 Sep 2026". */
export const formatDay = (day: string, year = false): string =>
  `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}${year ? ` ${day.slice(0, 4)}` : ""}`;
const formatDate = (d: LocalDate) => formatDay(d.day) + (d.time ? ` ${d.time}` : "");

// ---------------------------------------------------------------- types

export interface TimelineRange {
  start: string;
  /** Inclusive. */
  end: string;
  days: number;
  /** "20 Sep – 10 Oct 2026". */
  label: string;
}

/** One axis column: a day (week, month) or a week (quarter), spanning day indices `from`…`to` (exclusive). */
export interface TimelineColumn {
  start: string;
  end: string;
  from: number;
  to: number;
  /** "Sun 20" (week), "20 Sep" on week starts only (month), "20 Sep" (quarter). */
  label: string;
  /** A Saturday or Sunday day column (never a week column). */
  weekend: boolean;
  /** Holds today. */
  today: boolean;
  /** Starts a week (every quarter column). */
  weekStart: boolean;
  /** Holds the 1st of a month. */
  monthStart: boolean;
}

/** Day indices on the range, `to` exclusive; clipped at an edge the node runs past. */
export interface Placement {
  from: number;
  to: number;
  clipStart: boolean;
  clipEnd: boolean;
}

export interface TimelineMarker {
  kind: "scheduled" | "deadline";
  date: LocalDate;
  /** Day index. */
  at: number;
  /** An open task's deadline before today. */
  late: boolean;
}

export interface TimelineTaskRow {
  task: PlannerTask;
  /** Display title (inline refs resolved). */
  title: string;
  /** Last segment of the Status ident (`todo`, `doing`, `done`, `canceled`, …); null without a status. */
  status: string | null;
  done: boolean;
  /** In-range markers only; empty for a task without dates. */
  markers: TimelineMarker[];
  /** "Draft brief Website relaunch, Todo, due 5 Oct 17:00". */
  label: string;
}

export interface TimelineRow {
  node: PlannerNode;
  title: string;
  kind: "mapped" | "derived" | "point";
  start: LocalDate;
  end: LocalDate;
  /** Category colour 1–6, stable per node uuid. */
  cat: number;
  /** Spans (mapped, derived) that touch the range. */
  bar: Placement | null;
  /** Day index of a point inside the range. */
  point: number | null;
  /** Set when the span or point lies wholly outside the range. */
  outside: "before" | "after" | null;
  progress: Rollup;
  tasks: TimelineTaskRow[];
  /** "Website relaunch, 23 Sep – 23 Oct, 1 of 2 done". */
  label: string;
}

export interface TimelineLayout {
  zoom: Zoom;
  range: TimelineRange;
  columns: TimelineColumn[];
  /** Sorted by start, then end, then title. */
  rows: TimelineRow[];
  /** Nodes without any date, by title. */
  undated: { node: PlannerNode; title: string }[];
  /** Day index of today; null when today is out of range. */
  todayAt: number | null;
}

/** A node with what the layout needs: its resolved span, linked tasks and rollup. */
export interface TimelineItem {
  node: PlannerNode;
  span: NodeSpan;
  tasks: PlannerTask[];
  progress: Rollup;
}

export interface TimelineInput {
  items: TimelineItem[];
  zoom: Zoom;
  /** Any day of the period to show; the range starts `lead` days before its week. */
  anchor: string;
  today: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: number;
  /** Task Status closed values (built-in flags decide done). */
  statusValues: ClosedValue[];
  /** Titles of the loaded nodes by uuid (`titlesByUuid`), for inline refs in titles. */
  titles: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------- range and columns

export function timelineRange(zoom: Zoom, anchor: string, weekStart: number): TimelineRange {
  const z = ZOOM[zoom];
  const start = addDays(startOfWeek(anchor, weekStart), -z.lead);
  const end = addDays(start, z.days - 1);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return { start, end, days: z.days, label: `${formatDay(start, !sameYear)} – ${formatDay(end, true)}` };
}

/** The anchor one step earlier (-1) or later (1). */
export const shiftAnchor = (anchor: string, zoom: Zoom, dir: -1 | 1): string => addDays(anchor, dir * ZOOM[zoom].step);

function columnsOf(zoom: Zoom, range: TimelineRange, today: string, weekStart: number): TimelineColumn[] {
  const unit = ZOOM[zoom].unit;
  return Array.from({ length: range.days / unit }, (_, i) => {
    const from = i * unit;
    const start = addDays(range.start, from);
    const end = addDays(start, unit - 1);
    const wd = weekday(start);
    const isWeekStart = unit === 7 || wd === weekStart;
    const label = zoom === "week" ? `${WEEKDAYS[wd]} ${Number(start.slice(8))}` : isWeekStart ? formatDay(start) : "";
    return {
      start, end, from, to: from + unit, label,
      weekend: unit === 1 && (wd === 0 || wd === 6),
      today: start <= today && today <= end,
      weekStart: isWeekStart,
      monthStart: start.slice(8) === "01" || start.slice(0, 7) !== end.slice(0, 7),
    };
  });
}

// ---------------------------------------------------------------- rows

/** Day index of `day` on the range, or the side it falls off. */
const indexOn = (range: TimelineRange, day: string) => daysBetween(range.start, day);

function place(range: TimelineRange, start: string, end: string): { bar: Placement | null; outside: "before" | "after" | null } {
  const from = indexOn(range, start);
  const to = indexOn(range, end) + 1;
  if (to <= 0) return { bar: null, outside: "before" };
  if (from >= range.days) return { bar: null, outside: "after" };
  return { bar: { from: Math.max(from, 0), to: Math.min(to, range.days), clipStart: from < 0, clipEnd: to > range.days }, outside: null };
}

/** A small stable hash of the uuid → category 1–6 (7, red, is left out: it reads as late). */
const categoryOf = (uuid: string) => {
  let h = 0;
  for (const c of uuid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 6) + 1;
};

const compareDates = (a: LocalDate, b: LocalDate) => a.day.localeCompare(b.day) || (a.time ?? "").localeCompare(b.time ?? "");

function taskRow(task: PlannerTask, input: TimelineInput, range: TimelineRange): TimelineTaskRow {
  const value = task.status ? input.statusValues.find((v) => v.ident === task.status!.ident) : undefined;
  const done = value ? isDone(value) : false;
  const markers: TimelineMarker[] = [];
  for (const [kind, date] of [["scheduled", task.scheduled], ["deadline", task.deadline]] as const) {
    if (!date) continue;
    const at = indexOn(range, date.day);
    if (at < 0 || at >= range.days) continue;
    markers.push({ kind, date, at, late: kind === "deadline" && !done && date.day < input.today });
  }
  const title = displayTitle(task.title, input.titles);
  const when = [task.scheduled && `scheduled ${formatDate(task.scheduled)}`, task.deadline && `due ${formatDate(task.deadline)}`].filter(Boolean).join(", ") || "no date";
  return {
    task, title, done, markers,
    status: task.status ? task.status.ident.split(".").pop()! : null,
    label: [title, task.status?.title, when].filter(Boolean).join(", "),
  };
}

/** Dated tasks first by their first date, then undated ones, each by title. */
const taskDate = (t: PlannerTask) => t.scheduled ?? t.deadline;
const byTaskOrder = (a: PlannerTask, b: PlannerTask, titles: ReadonlyMap<string, string>) => {
  const da = taskDate(a);
  const db = taskDate(b);
  if (da && db) return compareDates(da, db) || a.title.localeCompare(b.title);
  if (da || db) return da ? -1 : 1;
  return displayTitle(a.title, titles).localeCompare(displayTitle(b.title, titles));
};

/** Resolves spans, linked tasks and rollups for `nodes` (the view's Start/End idents, either may be null). */
export function timelineItems(nodes: PlannerNode[], tasks: PlannerTask[], start: string | null, end: string | null, statusValues: ClosedValue[]): TimelineItem[] {
  return nodes.map((node) => {
    const own = tasksOf(node, tasks);
    return { node, span: resolveSpan(node, own, start, end), tasks: own, progress: rollup(own, statusValues) };
  });
}

export function layoutTimeline(input: TimelineInput): TimelineLayout {
  const range = timelineRange(input.zoom, input.anchor, input.weekStart);
  const rows: TimelineRow[] = [];
  const undated: TimelineLayout["undated"] = [];
  for (const { node, span, tasks, progress } of input.items) {
    const title = displayTitle(node.title, input.titles);
    if (span.kind === "undated") {
      undated.push({ node, title });
      continue;
    }
    const start = span.start!;
    const end = span.end!;
    const { bar, outside } = place(range, start.day, end.day);
    const isPoint = span.kind === "point";
    const dates = isPoint ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}${span.kind === "derived" ? " from its tasks" : ""}`;
    rows.push({
      node, title, kind: span.kind, start, end, outside, progress,
      cat: categoryOf(node.uuid),
      bar: isPoint ? null : bar,
      point: isPoint && bar ? bar.from : null,
      tasks: [...tasks].sort((a, b) => byTaskOrder(a, b, input.titles)).map((t) => taskRow(t, input, range)),
      label: [title, dates, progress.total ? `${progress.done} of ${progress.total} done` : ""].filter(Boolean).join(", "),
    });
  }
  rows.sort((a, b) => compareDates(a.start, b.start) || compareDates(a.end, b.end) || a.title.localeCompare(b.title));
  undated.sort((a, b) => a.title.localeCompare(b.title));
  const t = indexOn(range, input.today);
  return {
    zoom: input.zoom, range, rows, undated,
    columns: columnsOf(input.zoom, range, input.today, input.weekStart),
    todayAt: t >= 0 && t < range.days ? t : null,
  };
}
