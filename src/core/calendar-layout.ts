// Calendar layout: Month (whole weeks covering the anchor's month) and Week (the anchor's seven days), all-day only.
// Pure: no DOM, no SDK, no clock (`today` is injected). Span nodes (mapped or derived) are bands with one lane for the
// whole visible range, split per week row with continuation flags; point nodes and linked tasks' deadlines are chips on
// their day. Month shows `MONTH_SLOTS` item rows per day and counts the rest; Week shows everything, chips stacked
// below the bands. Positions are day indices 0–6 in a week row and 0-based item rows, so the UI places everything on
// one CSS grid per week.
import type { ClosedValue, LocalDate, PlannerNode } from "../types";
import { displayTitle } from "./display-title";
import {
  addDays, categoryOf, daysBetween, firstOfMonth, formatMonth, formatRange, isLate, nodeLabel, startOfWeek, taskLabel, taskState,
  weekday, weekdayName, type ViewItem,
} from "./layout-common";

export type CalendarView = "month" | "week";

/** Item rows per day in Month (REQUIREMENTS: up to 3 items per day, then "+N more"). */
export const MONTH_SLOTS = 3;

export interface CalendarRange {
  start: string;
  /** Inclusive. */
  end: string;
  /** "October 2026" (Month), "27 Sep – 3 Oct 2026" (Week). */
  label: string;
}

export interface CalendarDay {
  day: string;
  /** "3" (Month), "Sat 3" (Week). */
  label: string;
  /** Month only: a leading or trailing day of another month. */
  outside: boolean;
  today: boolean;
  /** Saturday or Sunday. */
  weekend: boolean;
  /** Month only: items on this day that did not fit (hidden bands and chips); 0 otherwise. */
  more: number;
}

/** A span node's piece in one week row: day indices `from`…`to` (exclusive) on its lane. */
export interface CalendarBand {
  node: PlannerNode;
  title: string;
  kind: "mapped" | "derived";
  /** Category colour 1–6 (same as the Timeline). */
  cat: number;
  /** 0-based item row, the same in every week row of the range. */
  lane: number;
  from: number;
  to: number;
  /** The span starts before this week row. */
  continuesBefore: boolean;
  /** The span ends after this week row. */
  continuesAfter: boolean;
  /** "Website relaunch, 23 Sep – 23 Oct, 1 of 2 done, continues next week". */
  label: string;
}

export interface CalendarChip {
  /** A one-date node, or a linked task's Deadline. */
  kind: "point" | "deadline";
  /** What a click opens: the node, or the task block. */
  uuid: string;
  title: string;
  date: LocalDate;
  /** `HH:MM` of a DateTime; null for a Date. */
  time: string | null;
  /** Day index 0–6 in its week row. */
  at: number;
  /** 0-based item row. */
  row: number;
  /** The node's category colour (a task chip takes its node's). */
  cat: number;
  /** Deadline chips: the node's title; null for points. */
  node: string | null;
  /** Deadline chips: Status key (`todo`, `done`, …) or null. */
  status: string | null;
  done: boolean;
  /** An open task past its deadline. */
  late: boolean;
  /** "Draft brief Website relaunch, Todo, due 5 Oct 17:00, Website relaunch". */
  label: string;
}

export interface CalendarWeek {
  /** First day of the row. */
  start: string;
  days: CalendarDay[];
  /** Visible bands, by lane. */
  bands: CalendarBand[];
  /** Visible chips, by day then row. */
  chips: CalendarChip[];
  /** Item rows used (bands and chips). */
  rows: number;
}

export interface CalendarLayout {
  view: CalendarView;
  range: CalendarRange;
  /** Weekday names in column order ("Sun" … "Sat" for a Sunday start). */
  weekdays: string[];
  weeks: CalendarWeek[];
  /** Nodes without any date, by title. */
  undated: { node: PlannerNode; title: string }[];
}

export interface CalendarInput {
  items: ViewItem[];
  layout: CalendarView;
  /** Any day of the month (Month) or week (Week) to show. */
  anchor: string;
  today: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: number;
  /** Task Status closed values (built-in flags decide done). */
  statusValues: ClosedValue[];
  /** Titles of the loaded nodes by uuid (`titlesByUuid`), for inline refs in titles. */
  titles: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------- range and navigation

export function calendarRange(view: CalendarView, anchor: string, weekStart: number): CalendarRange {
  if (view === "week") {
    const start = startOfWeek(anchor, weekStart);
    const end = addDays(start, 6);
    return { start, end, label: formatRange(start, end) };
  }
  const last = addDays(firstOfMonth(anchor, 1), -1);
  return { start: startOfWeek(firstOfMonth(anchor), weekStart), end: addDays(startOfWeek(last, weekStart), 6), label: formatMonth(anchor) };
}

/** The anchor one step earlier (-1) or later (1): the 1st of the adjacent month (Month) or a week away (Week). */
export const shiftCalendarAnchor = (anchor: string, view: CalendarView, dir: -1 | 1): string =>
  view === "month" ? firstOfMonth(anchor, dir) : addDays(anchor, dir * 7);

// ---------------------------------------------------------------- layout

interface Span {
  node: PlannerNode;
  title: string;
  kind: "mapped" | "derived";
  start: string;
  end: string;
  cat: number;
  label: string;
  lane: number;
}

type Chip = Omit<CalendarChip, "at" | "row">;

/** One lane per span for the whole range: by start, longer first, then title; a lane is reused once its span has ended. */
function assignLanes(spans: Omit<Span, "lane">[], range: CalendarRange): Span[] {
  const shown = spans.filter((s) => s.end >= range.start && s.start <= range.end)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.title.localeCompare(b.title));
  const laneEnds: string[] = [];
  return shown.map((s) => {
    const from = s.start < range.start ? range.start : s.start;
    let lane = laneEnds.findIndex((end) => end < from);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = s.end;
    return { ...s, lane };
  });
}

/** Untimed first, then by time, then by title. */
const byTime = (a: Chip, b: Chip) => (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title);

function layoutWeek(start: string, spans: Span[], chips: Chip[], input: CalendarInput, month: string | null): CalendarWeek {
  const end = addDays(start, 6);
  const limit = month ? MONTH_SLOTS : Infinity;
  const days: CalendarDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i);
    const n = Number(day.slice(8));
    const wd = weekday(day);
    return {
      day, label: month ? String(n) : `${weekdayName(day)} ${n}`, outside: !!month && day.slice(0, 7) !== month,
      today: day === input.today, weekend: wd === 0 || wd === 6, more: 0,
    };
  });
  const all: CalendarBand[] = spans.filter((s) => s.end >= start && s.start <= end).map((s) => {
    const before = s.start < start;
    const after = s.end > end;
    const cont = [before && "continues from the previous week", after && "continues next week"].filter(Boolean).join(", ");
    return {
      node: s.node, title: s.title, kind: s.kind, cat: s.cat, lane: s.lane, continuesBefore: before, continuesAfter: after,
      from: Math.max(0, daysBetween(start, s.start)), to: Math.min(7, daysBetween(start, s.end) + 1),
      label: cont ? `${s.label}, ${cont}` : s.label,
    };
  });
  const bands = all.filter((b) => b.lane < limit);
  const covers = (b: CalendarBand, i: number) => b.from <= i && i < b.to;
  const bandRows = bands.reduce((n, b) => Math.max(n, b.lane + 1), 0);
  const placed: CalendarChip[] = [];
  days.forEach((d, i) => {
    const mine = chips.filter((c) => c.date.day === d.day).sort(byTime);
    if (!month) {
      mine.forEach((c, k) => placed.push({ ...c, at: i, row: bandRows + k }));
      return;
    }
    const taken = new Set(bands.filter((b) => covers(b, i)).map((b) => b.lane));
    const free = Array.from({ length: MONTH_SLOTS }, (_, r) => r).filter((r) => !taken.has(r));
    mine.slice(0, free.length).forEach((c, k) => placed.push({ ...c, at: i, row: free[k] }));
    d.more = all.filter((b) => b.lane >= limit && covers(b, i)).length + Math.max(0, mine.length - free.length);
  });
  const rows = Math.max(bandRows, ...placed.map((c) => c.row + 1));
  return { start, days, bands: bands.sort((a, b) => a.lane - b.lane), chips: placed, rows };
}

export function layoutCalendar(input: CalendarInput): CalendarLayout {
  const range = calendarRange(input.layout, input.anchor, input.weekStart);
  const undated: CalendarLayout["undated"] = [];
  const spans: Omit<Span, "lane">[] = [];
  const chips: Chip[] = [];
  const seenTasks = new Set<number>();
  const inRange = (day: string) => range.start <= day && day <= range.end;
  for (const { node, span, tasks, progress } of input.items) {
    const title = displayTitle(node.title, input.titles);
    const cat = categoryOf(node.uuid);
    if (span.kind === "undated") {
      undated.push({ node, title });
      continue;
    }
    const label = nodeLabel(title, span, progress);
    if (span.kind === "point") {
      if (inRange(span.start!.day)) {
        chips.push({ kind: "point", uuid: node.uuid, title, date: span.start!, time: span.start!.time, cat, node: null, status: null, done: false, late: false, label });
      }
    } else {
      spans.push({ node, title, kind: span.kind, start: span.start!.day, end: span.end!.day, cat, label });
    }
    // Deadlines only (REQUIREMENTS: Scheduled dates are not shown); a task linked to several nodes once, first node wins.
    for (const task of tasks) {
      if (!task.deadline || seenTasks.has(task.id) || !inRange(task.deadline.day)) continue;
      seenTasks.add(task.id);
      const { status, done } = taskState(task, input.statusValues);
      const late = isLate(task, done, input.today);
      const taskTitle = displayTitle(task.title, input.titles);
      chips.push({
        kind: "deadline", uuid: task.uuid, title: taskTitle, date: task.deadline, time: task.deadline.time, cat, node: title, status, done, late,
        label: [taskLabel(task, taskTitle), late && "late", title].filter(Boolean).join(", "),
      });
    }
  }
  const laned = assignLanes(spans, range);
  const month = input.layout === "month" ? input.anchor.slice(0, 7) : null;
  const weeks: CalendarWeek[] = [];
  for (let w = range.start; w <= range.end; w = addDays(w, 7)) weeks.push(layoutWeek(w, laned, chips, input, month));
  undated.sort((a, b) => a.title.localeCompare(b.title));
  return {
    view: input.layout, range, weeks, undated,
    weekdays: weeks[0].days.map((d) => weekdayName(d.day)),
  };
}
