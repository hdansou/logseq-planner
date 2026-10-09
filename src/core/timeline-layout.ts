// Timeline layout: visible range, axis columns, rows (bars, points, task markers), today line and the undated list.
// Pure: no DOM, no SDK, no clock (`today` and `now` are injected). Calendar-day arithmetic, labels and colours come from
// layout-common.ts (shared with the Calendar).
//
// Track model (N10). Every position is a track index from the range start (`to` exclusive), so the UI places everything
// on one CSS grid of tracks, whatever the zoom. A track is one calendar day in Week, Month and Quarter (a Quarter column
// spans 7 tracks) and 15 minutes in Day (96 tracks per day; an hour column spans 4). `perDay` = tracks per day.
// A date's track is its day's first track plus, when a track is shorter than a day, its time: floor for a start, ceil for
// an (exclusive) end. A missing time is 00:00 for a start and the end of the day for an end, so a Date-only span covers
// whole days in every zoom. A span takes at least one track. With one track per day times are ignored, so the day zooms
// place exactly as before N10. One-date nodes and task markers sit at their start track (Date-only: the day's first).
// Today line: today's track in the day zooms; in Day, the current time (`now`) as a fractional track, on today only.
// The Day range is the anchor's day; Prev / Next move it by one day.
// Date edits (N06c): with `edit` given, each row says what of its span can be edited (`SpanEdit`), and `clampDelta` /
// `editedBar` turn a drag of N tracks into the dates and the bar the layout would draw for them.
import type { ClosedValue, DateProp, LocalDate, PlannerNode, PlannerTask, Rollup } from "../types";
import { dateChanges, editedSpan, type DateChange, type EditMode, type SpanEdit } from "./date-edit";
import { displayTitle } from "./display-title";
import {
  addDays, categoryOf, compareDates, daysBetween, dueDate, formatDay, formatRange, isLate, nodeLabel, startOfWeek, taskLabel, taskState, weekday,
  weekdayName, type ViewItem,
} from "./layout-common";

export type Zoom = "day" | "week" | "month" | "quarter";

/**
 * Range shape per zoom: `days` long, starting `lead` days before the anchor's week (Day: the anchor's day itself);
 * prev/next `step` days; `perDay` tracks per day; columns of `unit` tracks: hours (day), days (week, month), weeks (quarter).
 */
const ZOOM: Record<Zoom, { days: number; lead: number; step: number; perDay: 1 | 96; unit: 1 | 4 | 7 }> = {
  day: { days: 1, lead: 0, step: 1, perDay: 96, unit: 4 },
  week: { days: 21, lead: 7, step: 7, perDay: 1, unit: 1 },
  month: { days: 56, lead: 14, step: 21, perDay: 1, unit: 1 },
  quarter: { days: 119, lead: 28, step: 42, perDay: 1, unit: 7 },
};
const MINUTES_PER_DAY = 1440;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// ---------------------------------------------------------------- types

export interface TimelineRange {
  start: string;
  /** Inclusive. */
  end: string;
  /** Calendar days in the range. */
  days: number;
  /** Grid tracks: `days` × tracks per day (96 in Day, else 1). */
  tracks: number;
  /** "20 Sep – 10 Oct 2026"; Day: "Sat 3 Oct 2026". */
  label: string;
}

/** One axis column: an hour (day), a day (week, month) or a week (quarter), spanning tracks `from`…`to` (exclusive). */
export interface TimelineColumn {
  /** Unique per column: the day (`YYYY-MM-DD`), or `YYYY-MM-DDTHH` for an hour column. */
  key: string;
  /** First and last day it covers (an hour column: its day). */
  start: string;
  end: string;
  from: number;
  to: number;
  /** "13" (day), "Sun 20" (week), "20 Sep" on week starts only (month), "20 Sep" (quarter). */
  label: string;
  /** A Saturday or Sunday day column (never a week or an hour column). */
  weekend: boolean;
  /** Holds today; an hour column: holds now. */
  today: boolean;
  /** Starts a week (every quarter column; never an hour column). */
  weekStart: boolean;
  /** Holds the 1st of a month (never an hour column). */
  monthStart: boolean;
}

/** Tracks on the range, `to` exclusive; clipped at an edge the node runs past. */
export interface Placement {
  from: number;
  to: number;
  clipStart: boolean;
  clipEnd: boolean;
}

export interface TimelineMarker {
  kind: "scheduled" | "deadline";
  date: LocalDate;
  /** Track. */
  at: number;
  /** The marker of an open task's due date (Deadline, else Scheduled), when that is before today. */
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
  /** Track of a point inside the range. */
  point: number | null;
  progress: Rollup;
  tasks: TimelineTaskRow[];
  /** "Website relaunch, 23 Sep – 23 Oct, 1 of 2 done". */
  label: string;
  /** Display titles of the shown nodes it depends on (N12), on screen or not, in the property's order; [] for none. */
  dependsOn: string[];
  /**
   * Nested (N14): its child rows (in range, by date) while it is not collapsed; [] when collapsed, for a child row and
   * outside the nested arrangement.
   */
  children: TimelineRow[];
  /** Nested: how many of its children have a row in the range, collapsed or not (the toggle shows when > 0). */
  childCount: number;
  /** Nested: the parent row's node uuid for a child row; null for a top-level row. */
  parent: string | null;
  /**
   * Date edits (N06c), while the Timeline edits dates: what of its span can be edited; null when nothing can (a span
   * derived from tasks, a Date point in Day zoom, a write pending) and always outside edit mode.
   */
  edit: SpanEdit | null;
  /** A date edit of this node is being written (N06c): it shows at its new place, without handles. */
  pending: boolean;
}

/** A dependency connector (N12): from the dependency's row to its dependent's row, both by node uuid. */
export interface TimelineLink {
  from: string;
  to: string;
}

/** Dated nodes wholly on one side of the range: how many, and the day to move the range to for the nearest one. */
export interface OutsideCount {
  count: number;
  /** Earlier: the latest end among them; later: the earliest start. Null when there are none. */
  nearest: string | null;
}

/** A tag of the view, as the Timeline arranged by tag heads its rows (N14). */
export interface TimelineGroup {
  /** Tag ident (`PlannerNode.tag`). */
  tag: string;
  /** "#Milestone". */
  title: string;
}

export interface TimelineLayout {
  zoom: Zoom;
  range: TimelineRange;
  columns: TimelineColumn[];
  /**
   * Nodes that touch the range only (T13a: a node wholly outside gets no row), sorted by start, then end, then title;
   * arranged by tag (`groups`), by the group first; nested (`nest`), the top-level rows only, each with its children.
   */
  rows: TimelineRow[];
  /** Arranged by tag (N14): the view's tags in selection order, each heading its rows; null = rows by date only. */
  groups: TimelineGroup[] | null;
  /** Dated nodes that end before the range. */
  earlier: OutsideCount;
  /** Dated nodes that start after the range. */
  later: OutsideCount;
  /** Nodes without any date, by title. */
  undated: { node: PlannerNode; title: string }[];
  /**
   * Dependency connectors (N12) between rows on screen: both nodes have a row (bar or point) in the range, and a child
   * row of a collapsed parent has none; in row order of the dependents.
   */
  links: TimelineLink[];
  /**
   * The today line: today's track (Week, Month, Quarter), or in Day the current time as a fractional track (13:30 → 54);
   * null when today is out of range.
   */
  todayAt: number | null;
  /** The Timeline edits dates (N06c: the session's Edit dates toggle): rows carry `edit`. */
  editing: boolean;
}

/** A node's own mapped Start and End properties (its tag's mapping in the view), null for an unmapped one. */
export type EditProps = (node: PlannerNode) => { start: DateProp | null; end: DateProp | null };

export interface TimelineInput {
  items: ViewItem[];
  zoom: Zoom;
  /** Any day of the period to show; the range starts `lead` days before its week. */
  anchor: string;
  today: string;
  /** The local time now, `HH:MM` (the Day zoom's now line and current hour). */
  now: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: number;
  /** Task Status closed values (built-in flags decide done). */
  statusValues: ClosedValue[];
  /** Titles of the loaded nodes by uuid (`titlesByUuid`), for inline refs in titles. */
  titles: ReadonlyMap<string, string>;
  /** Arrange by tag (N14): the view's tags in selection order; absent = by date (one tag, or Arrange "By date"). */
  groups?: TimelineGroup[];
  /**
   * Arrange nested (N14 step 2): the parent node id by child node id (`nestItems`). A child whose parent has a row is
   * listed under it; one whose parent has none (out of range, undated) is a top-level row. Absent = no nesting.
   */
  nest?: ReadonlyMap<number, number>;
  /** Nested: parents whose children are hidden (session state); their children have no row. */
  collapsed?: ReadonlySet<number>;
  /** Edit dates on (N06c): each node's mapped Start / End properties; absent = read-only rows (`edit` null). */
  edit?: EditProps;
  /** Node uuids whose date edit is being written (N06c). */
  pending?: ReadonlySet<string>;
}

// ---------------------------------------------------------------- range and columns

export function timelineRange(zoom: Zoom, anchor: string, weekStart: number): TimelineRange {
  const z = ZOOM[zoom];
  const start = zoom === "day" ? anchor : addDays(startOfWeek(anchor, weekStart), -z.lead);
  const end = addDays(start, z.days - 1);
  const label = zoom === "day" ? `${weekdayName(start)} ${formatDay(start, true)}` : formatRange(start, end);
  return { start, end, days: z.days, tracks: z.days * z.perDay, label };
}

/** The anchor one step earlier (-1) or later (1). */
export const shiftAnchor = (anchor: string, zoom: Zoom, dir: -1 | 1): string => addDays(anchor, dir * ZOOM[zoom].step);

/** Day: one column per hour, labelled "00" … "23"; the current hour's column is today's. */
function hourColumns(range: TimelineRange, today: string, now: string): TimelineColumn[] {
  const day = range.start;
  const nowHour = day === today ? Math.floor(minutes(now) / 60) : -1;
  return Array.from({ length: 24 }, (_, h) => {
    const hh = String(h).padStart(2, "0");
    return { key: `${day}T${hh}`, start: day, end: day, from: h * 4, to: h * 4 + 4, label: hh, weekend: false, today: h === nowHour, weekStart: false, monthStart: false };
  });
}

function columnsOf(zoom: Zoom, range: TimelineRange, today: string, now: string, weekStart: number): TimelineColumn[] {
  if (zoom === "day") return hourColumns(range, today, now);
  const unit = ZOOM[zoom].unit;
  return Array.from({ length: range.tracks / unit }, (_, i) => {
    const from = i * unit;
    const start = addDays(range.start, from);
    const end = addDays(start, unit - 1);
    const wd = weekday(start);
    const isWeekStart = unit === 7 || wd === weekStart;
    const label = zoom === "week" ? `${weekdayName(start)} ${Number(start.slice(8))}` : isWeekStart ? formatDay(start) : "";
    return {
      key: start, start, end, from, to: from + unit, label,
      weekend: unit === 1 && (wd === 0 || wd === 6),
      today: start <= today && today <= end,
      weekStart: isWeekStart,
      monthStart: start.slice(8) === "01" || start.slice(0, 7) !== end.slice(0, 7),
    };
  });
}

// ---------------------------------------------------------------- rows

/**
 * Track of `date` on the range (negative or past the end when it falls off): its day's first track, plus its time when a
 * track is shorter than a day (floor for a start, ceil for an exclusive end; no time = the day's start / end).
 */
function trackOf(range: TimelineRange, date: LocalDate, edge: "start" | "end"): number {
  const perDay = range.tracks / range.days;
  const first = daysBetween(range.start, date.day) * perDay;
  if (perDay === 1 || date.time === null) return first + (edge === "end" ? perDay : 0);
  const t = (minutes(date.time) * perDay) / MINUTES_PER_DAY;
  return first + (edge === "end" ? Math.ceil(t) : Math.floor(t));
}

/** The day holding `track` (relative to the range start; any sign). */
const dayOfTrack = (range: TimelineRange, track: number) => addDays(range.start, Math.floor(track / (range.tracks / range.days)));

/** A span's tracks (at least one), clipped to the range, or the side it falls off with the day of its nearest track. */
function place(range: TimelineRange, start: LocalDate, end: LocalDate): { bar: Placement } | { outside: "before" | "after"; nearest: string } {
  const from = trackOf(range, start, "start");
  const to = Math.max(trackOf(range, end, "end"), from + 1);
  if (to <= 0) return { outside: "before", nearest: dayOfTrack(range, to - 1) };
  if (from >= range.tracks) return { outside: "after", nearest: dayOfTrack(range, from) };
  return { bar: { from: Math.max(from, 0), to: Math.min(to, range.tracks), clipStart: from < 0, clipEnd: to > range.tracks } };
}

function taskRow(task: PlannerTask, input: TimelineInput, range: TimelineRange): TimelineTaskRow {
  const { status, done } = taskState(task, input.statusValues);
  const markers: TimelineMarker[] = [];
  for (const [kind, date] of [["scheduled", task.scheduled], ["deadline", task.deadline]] as const) {
    if (!date) continue;
    const at = trackOf(range, date, "start");
    if (at < 0 || at >= range.tracks) continue;
    markers.push({ kind, date, at, late: date === dueDate(task) && isLate(task, done, input.today) });
  }
  const title = displayTitle(task.title, input.titles);
  return { task, title, done, markers, status, label: taskLabel(task, title) };
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

export function layoutTimeline(input: TimelineInput): TimelineLayout {
  const range = timelineRange(input.zoom, input.anchor, input.weekStart);
  const rows: TimelineRow[] = [];
  const undated: TimelineLayout["undated"] = [];
  const earlier: OutsideCount = { count: 0, nearest: null };
  const later: OutsideCount = { count: 0, nearest: null };
  for (const { node, span, tasks, progress } of input.items) {
    if (span.kind === "undated") {
      undated.push({ node, title: displayTitle(node.title, input.titles) });
      continue;
    }
    const start = span.start!;
    const end = span.end!;
    const placed = place(range, start, end);
    if ("outside" in placed) {
      const side = placed.outside === "before" ? earlier : later;
      side.count++;
      if (side.nearest === null || (placed.outside === "before" ? placed.nearest > side.nearest : placed.nearest < side.nearest)) side.nearest = placed.nearest;
      continue;
    }
    const { bar } = placed;
    const title = displayTitle(node.title, input.titles);
    const isPoint = span.kind === "point";
    const pending = input.pending?.has(node.uuid) ?? false;
    rows.push({
      node, title, kind: span.kind, start, end, progress,
      cat: categoryOf(node.uuid),
      bar: isPoint ? null : bar,
      point: isPoint ? bar.from : null,
      tasks: [...tasks].sort((a, b) => byTaskOrder(a, b, input.titles)).map((t) => taskRow(t, input, range)),
      label: nodeLabel(title, span, progress),
      dependsOn: [], children: [], childCount: 0, parent: null,
      edit: input.edit && !pending ? spanEdit(span.kind, node, input.edit(node), bar, input.zoom) : null, pending,
    });
  }
  rows.sort((a, b) => compareDates(a.start, b.start) || compareDates(a.end, b.end) || a.title.localeCompare(b.title));
  const groups = input.groups ?? null;
  if (groups) {
    const order = new Map(groups.map((g, i) => [g.tag, i]));
    rows.sort((a, b) => order.get(a.node.tag)! - order.get(b.node.tag)!); // stable: by date inside a group
  }
  undated.sort((a, b) => a.title.localeCompare(b.title));
  const top = input.nest ? nestRows(rows, input.nest, input.collapsed ?? new Set()) : rows;
  return {
    zoom: input.zoom, range, rows: top, groups, undated, earlier, later, links: linkRows(shownRows(top), input),
    columns: columnsOf(input.zoom, range, input.today, input.now, input.weekStart),
    todayAt: todayAt(input.zoom, range, input.today, input.now),
    editing: input.edit !== undefined,
  };
}

// ---------------------------------------------------------------- date edits (N06c)

/**
 * What of a span can be edited: only the node's own mapped dates (a span derived from tasks: nothing). A Date value
 * cannot move by 15 minutes, so in Day zoom it is locked; an end clipped at the range's edge cannot be resized (its
 * handle is off screen), the visible end still can, and the bar can still move. A point moves only. Null when nothing
 * can be edited.
 */
function spanEdit(kind: TimelineRow["kind"], node: PlannerNode, props: ReturnType<EditProps>, bar: Placement, zoom: Zoom): SpanEdit | null {
  if (kind === "derived") return null;
  const ok = (p: DateProp | null) => p !== null && !(zoom === "day" && p.type === "date");
  if (kind === "point") {
    const viaStart = props.start !== null && node.dates[props.start.ident] !== undefined;
    const prop = viaStart ? props.start : props.end;
    if (!ok(prop)) return null;
    return { start: viaStart ? prop : null, end: viaStart ? null : prop, point: true, move: true, resizeStart: false, resizeEnd: false };
  }
  const edit = { start: props.start, end: props.end, point: false, move: ok(props.start) && ok(props.end),
    resizeStart: ok(props.start) && !bar.clipStart, resizeEnd: ok(props.end) && !bar.clipEnd };
  return edit.move || edit.resizeStart || edit.resizeEnd ? edit : null;
}

/** Tracks per day of the range: 1, or 96 in Day zoom. */
export const perDayOf = (range: TimelineRange): 1 | 96 => (range.tracks / range.days === 1 ? 1 : 96);

/**
 * The delta nearest to `delta` (towards 0) that `mode` can take on `row` (an editable row): the result keeps at least
 * one track on the range (nothing is dragged off screen), and a resized span keeps at least one track and its start
 * on or before its end. 0 when no step fits.
 */
export function clampDelta(range: TimelineRange, row: TimelineRow, mode: EditMode, delta: number): number {
  const edit = row.edit!;
  const perDay = perDayOf(range);
  const fits = (d: number) => {
    const { start, end } = editedSpan(edit, row, dateChanges(edit, row, mode, d, perDay));
    if ("outside" in place(range, start, end)) return false;
    if (mode === "move") return true;
    return trackOf(range, end, "end") - trackOf(range, start, "start") >= 1 && compareDates(start, end) <= 0;
  };
  for (let d = Math.trunc(delta); d !== 0; d -= Math.sign(d)) if (fits(d)) return d;
  return 0;
}

/** The tracks the layout draws `row` on with `changes` applied (a point: its one track); throws when it falls off the range. */
export function editedBar(range: TimelineRange, row: TimelineRow, changes: DateChange[]): { from: number; to: number } {
  const { start, end } = editedSpan(row.edit!, row, changes);
  const placed = place(range, start, end);
  if ("outside" in placed) throw new Error(`"${row.title}" would leave the range`);
  return row.edit!.point ? { from: placed.bar.from, to: placed.bar.from + 1 } : { from: placed.bar.from, to: placed.bar.to };
}

/** Nested: each row whose parent has a row goes under it (in date order); the rest are the top-level rows. */
function nestRows(rows: TimelineRow[], nest: ReadonlyMap<number, number>, collapsed: ReadonlySet<number>): TimelineRow[] {
  const byId = new Map(rows.map((r) => [r.node.id, r]));
  const top: TimelineRow[] = [];
  for (const r of rows) {
    const pid = nest.get(r.node.id);
    const parent = pid === undefined ? undefined : byId.get(pid);
    if (!parent) {
      top.push(r);
      continue;
    }
    r.parent = parent.node.uuid;
    parent.childCount++;
    if (!collapsed.has(parent.node.id)) parent.children.push(r);
  }
  return top;
}

/** The rows on screen in order: each top-level row, then its shown children. */
export const shownRows = (rows: TimelineRow[]): TimelineRow[] => rows.flatMap((r) => [r, ...r.children]);

/**
 * Fills each row's `dependsOn` titles (the shown nodes it depends on) and returns the links whose both ends have a row
 * (N12). Nodes that are filtered out or not loaded are not in `input.items`, so they neither link nor are named.
 */
function linkRows(rows: TimelineRow[], input: TimelineInput): TimelineLink[] {
  if (!rows.some((r) => r.node.dependsOn.length)) return [];
  const shown = new Map(input.items.map(({ node }) => [node.id, node]));
  const onScreen = new Set(rows.map((r) => r.node.id));
  const links: TimelineLink[] = [];
  for (const r of rows) {
    for (const id of r.node.dependsOn) {
      const dep = shown.get(id);
      if (!dep) continue;
      r.dependsOn.push(displayTitle(dep.title, input.titles));
      if (onScreen.has(id)) links.push({ from: dep.uuid, to: r.node.uuid });
    }
  }
  return links;
}

function todayAt(zoom: Zoom, range: TimelineRange, today: string, now: string): number | null {
  if (zoom === "day") return today === range.start ? (minutes(now) * range.tracks) / MINUTES_PER_DAY : null;
  const t = trackOf(range, { day: today, time: null }, "start");
  return t >= 0 && t < range.tracks ? t : null;
}

/**
 * Day zoom: the track the view opens at (N10). The earliest bar or point that starts on the day at a time, or task
 * marker with a time on an `expanded` row; else 0 when a Date-only point or marker (drawn at the day's first track) is
 * there; else null (nothing pinned to a time: the UI picks its default hour). Bars running in from the day before and
 * Date-only spans cover the day, so they never pull the view to 00:00. Null in the other zooms.
 */
export function dayFocus(layout: TimelineLayout, expanded: ReadonlySet<number>): number | null {
  if (layout.zoom !== "day") return null;
  const timed: number[] = [];
  let untimed = false;
  for (const r of shownRows(layout.rows)) {
    if (r.point !== null) {
      if (r.start.time === null) untimed = true;
      else timed.push(r.point);
    } else if (r.bar && !r.bar.clipStart && r.start.time !== null) timed.push(r.bar.from);
    if (!expanded.has(r.node.id)) continue;
    for (const m of r.tasks.flatMap((t) => t.markers)) {
      if (m.date.time === null) untimed = true;
      else timed.push(m.at);
    }
  }
  return timed.length ? Math.min(...timed) : untimed ? 0 : null;
}

/** N36: the Timeline's title column, px: default (kept equal to timeline.css by a test), and the range a drag may set. */
export const LABEL_W = { default: 240, min: 160, max: 640 } as const;
export const clampLabelWidth = (px: number): number => Math.min(LABEL_W.max, Math.max(LABEL_W.min, Math.round(px)));
