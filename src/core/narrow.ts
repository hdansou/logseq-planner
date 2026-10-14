// N73: narrowing a view to what was added lately (Added: created today, or within the last N days) and to titles with
// some words in them (Find). Pure: today and the titles are passed in.
import { displayTitle } from "./display-title";
import { daysBetween, type ViewItem } from "./layout-common";

/** Added: created today, or within the last `n` days (today and the n − 1 days before). */
export type Added = "today" | number;

/** What a view is narrowed by (the config's `added` and `find`; absent = off). */
export interface Narrowing {
  added?: Added;
  find?: string;
}

/** The number of days Added starts with, and its bounds. */
export const ADDED_DAYS = 7;
export const ADDED_MAX = 365;

/** A stored or typed Added value, or undefined when it is not one (off). */
export function parseAdded(v: unknown): Added | undefined {
  if (v === "today") return v;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= ADDED_MAX ? v : undefined;
}

const words = (find: string | undefined) => (find ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** Added or Find is on. */
export const isNarrowed = (n: Narrowing): boolean => n.added !== undefined || words(n.find).length > 0;

/** What can be matched: a node or a task, by its title and the day it was created. */
export interface Narrowable {
  title: string;
  created?: string;
}

/**
 * The test a node or task passes under `n` on `today`, or null when nothing narrows. Added: its created day is today, or
 * at most n − 1 days before; without a created day it never matches. Find: every word is part of the title as shown
 * (inline refs as their titles, `titles`), any case.
 */
export function narrowMatch(n: Narrowing, today: string, titles: ReadonlyMap<string, string>): ((x: Narrowable) => boolean) | null {
  if (!isNarrowed(n)) return null;
  const find = words(n.find);
  const within = n.added === undefined ? null : n.added === "today" ? 0 : n.added - 1;
  return (x) => {
    if (within !== null && (x.created === undefined || daysBetween(x.created, today) > within)) return false;
    if (!find.length) return true;
    const title = displayTitle(x.title, titles).toLowerCase();
    return find.every((w) => title.includes(w));
  };
}

/**
 * The items `match` keeps: an item whose node matches, with all its tasks; else one with a matching task, listing only
 * the matching tasks (a new task on an old node). Span and progress are left as they were: they count every task.
 */
export function narrowItems(items: ViewItem[], match: (x: Narrowable) => boolean): ViewItem[] {
  const out: ViewItem[] = [];
  for (const item of items) {
    if (match(item.node)) out.push(item);
    else {
      const tasks = item.tasks.filter(match);
      if (tasks.length) out.push({ ...item, tasks });
    }
  }
  return out;
}
