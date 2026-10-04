// Timeline date edits (N06c): a date shifted by whole tracks, what a gesture changes, and the writes (each read back; the
// earlier one put back when a later one fails, as a Kanban move does). Pure apart from the injected SDK calls; the zone
// is injected too (the inverse of the read in normalize.ts).
import type { DateProp, DateWriteDeps, LocalDate, PlannerNode } from "../types";
import { addDays, formatDate, formatDay } from "./layout-common";
import type { ZoneOffset } from "./normalize";
import { writeInOrder, writeKey } from "./write";

/** What a drag or a key does: move the whole span (or point), or change its start or its end only. */
export type EditMode = "move" | "start" | "end";

/**
 * What of a Timeline row's span can be edited now (N06c). `start` / `end`: the node's own mapped Start and End
 * properties the span's dates come from; a point has one of them (the end it is mapped as) and moves only. The gesture
 * flags are what the zoom and the range allow (layoutTimeline decides: a Date cannot move in Day zoom, a clipped end
 * cannot be resized).
 */
export interface SpanEdit {
  start: DateProp | null;
  end: DateProp | null;
  /** A one-date node: its span is that date on both ends. */
  point: boolean;
  move: boolean;
  resizeStart: boolean;
  resizeEnd: boolean;
}

/** One property's new value, with the value it had (for the roll-back and the error text). */
export interface DateChange {
  prop: DateProp;
  previous: LocalDate;
  next: LocalDate;
}

const MINUTES_PER_DAY = 1440;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `date` moved by `delta` tracks of a zoom with `perDay` tracks per day (1: a day; 96: 15 minutes, Day zoom). Calendar
 * arithmetic on the local day and wall-clock time, never on epoch ms, so a DateTime keeps its time of day across a DST
 * change. A Date cannot move by minutes: it throws in Day zoom (the layout locks it there).
 */
export function shiftDate(date: LocalDate, type: DateProp["type"], delta: number, perDay: 1 | 96): LocalDate {
  if (perDay === 1) return { day: addDays(date.day, delta), time: date.time };
  if (type === "date" || date.time === null) throw new Error(`A Date value (${date.day}) cannot move by 15 minutes`);
  const total = Number(date.time.slice(0, 2)) * 60 + Number(date.time.slice(3, 5)) + delta * 15;
  const days = Math.floor(total / MINUTES_PER_DAY);
  const m = total - days * MINUTES_PER_DAY;
  return { day: addDays(date.day, days), time: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` };
}

/**
 * The epoch ms of a local day and time in `zone` (DST-aware: the offset is asked at the instant itself, twice, so a
 * date on the other side of a change than the first guess still lands right). A DateTime value's write form; throws
 * for a Date value (no time).
 */
export function epochOf(date: LocalDate, zone: ZoneOffset): number {
  if (date.time === null) throw new Error(`${date.day} has no time: only a DateTime value is written as epoch ms`);
  const [y, m, d] = date.day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, Number(date.time.slice(0, 2)), Number(date.time.slice(3, 5)));
  const guess = wall - zone(wall) * 60_000;
  return wall - zone(guess) * 60_000;
}

/** `createJournalPage`'s argument for a day: local noon (a bare day lands on the previous day west of UTC, probe). */
export const journalArg = (day: string): string => `${day}T12:00:00`;

const allowed = (edit: SpanEdit, mode: EditMode) => (mode === "move" ? edit.move : mode === "start" ? edit.resizeStart : edit.resizeEnd);

/** The property changes `mode` by `delta` tracks makes to `span` (none for 0); throws when `edit` does not allow `mode`. */
export function dateChanges(edit: SpanEdit, span: { start: LocalDate; end: LocalDate }, mode: EditMode, delta: number, perDay: 1 | 96): DateChange[] {
  if (!allowed(edit, mode)) throw new Error(`This span cannot ${mode === "move" ? "move" : `change its ${mode}`} here`);
  if (delta === 0) return [];
  const one = (prop: DateProp, previous: LocalDate): DateChange => ({ prop, previous, next: shiftDate(previous, prop.type, delta, perDay) });
  const changes: DateChange[] = [];
  if (edit.start && mode !== "end") changes.push(one(edit.start, span.start));
  if (edit.end && mode !== "start") changes.push(one(edit.end, span.end));
  return changes;
}

/** `span` with `changes` applied (a point: its one date on both ends). */
export function editedSpan(edit: SpanEdit, span: { start: LocalDate; end: LocalDate }, changes: DateChange[]): { start: LocalDate; end: LocalDate } {
  const next = (prop: DateProp | null) => (prop ? changes.find((c) => c.prop.ident === prop.ident)?.next : undefined);
  const start = next(edit.start) ?? span.start;
  const end = next(edit.end) ?? span.end;
  if (edit.point) {
    const at = edit.start ? start : end;
    return { start: at, end: at };
  }
  return { start, end };
}

/** A copy of `node` with `changes` applied: where its bar shows while they are written. */
export const editedNode = (node: PlannerNode, changes: DateChange[]): PlannerNode =>
  ({ ...node, dates: { ...node.dates, ...Object.fromEntries(changes.map((c) => [c.prop.ident, c.next])) } });

const journalDayOf = (day: string) => Number(day.replace(/-/g, ""));

/**
 * Writes `changes` to `node` in order (N06c). DateTime: `upsertBlockProperty(uuid, key, epoch ms)`; Date: the day's
 * journal page (`createJournalPage` at local noon), then its db id. Each value is read back (a Date also by its journal
 * day); a value the graph does not hold throws. When the second write fails, the first is put back to its previous
 * value and the error says whether that worked (`writeInOrder`, as a Kanban move).
 */
export async function writeDates(deps: DateWriteDeps, node: { uuid: string; title: string }, changes: DateChange[], zone: ZoneOffset): Promise<void> {
  const one = async (c: DateChange) => {
    const { prop, next } = c;
    const notSaved = () => new Error(`${prop.title} of "${node.title}" was not saved as ${formatDate(next)} (read back differs).`);
    if (prop.type === "datetime") {
      const ms = epochOf(next, zone);
      await deps.upsertBlockProperty(node.uuid, writeKey(prop.ident), ms);
      if ((await deps.readDate(node.uuid, prop.ident, "datetime")) !== ms) throw notSaved();
      return;
    }
    const page = await deps.createJournalPage(journalArg(next.day));
    if (!page) throw new Error(`Logseq gave no journal page for ${formatDay(next.day, true)}, so ${prop.title} of "${node.title}" was not saved.`);
    await deps.upsertBlockProperty(node.uuid, writeKey(prop.ident), page.id);
    const read = await deps.readDate(node.uuid, prop.ident, "date");
    if (typeof read !== "object" || read === null || read.id !== page.id || read.journalDay !== journalDayOf(next.day)) throw notSaved();
  };
  const undo = (c: DateChange): DateChange => ({ prop: c.prop, previous: c.next, next: c.previous });
  await writeInOrder(changes, one, undo, (c) => formatDate(c.previous),
    { shows: "The timeline shows what the graph holds.", unmoved: "the bar has not moved" });
}
