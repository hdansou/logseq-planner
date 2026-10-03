// Calendar view (T09): renders a `CalendarLayout` as HTML for the workspace's view area and its per-view toolbar, and
// names the action a click means. Pure state → HTML, like timeline.ts; the workspace owns state and events.
// Each week row is one CSS grid (calendar.css): seven equal columns; row 1 holds the day numbers, then one row per item
// row of the layout (`grid-row: row + 2`), then the "+N more" row in Month. Day cells span every row as the backdrop.
import { formatDay } from "../core/layout-common";
import type { CalendarBand, CalendarChip, CalendarDay, CalendarLayout, CalendarView, CalendarWeek } from "../core/calendar-layout";
import { esc, flag, segmented, viewNav } from "./html";

export type CalendarAction =
  | { type: "layout"; layout: CalendarView }
  | { type: "nav"; dir: -1 | 1 }
  | { type: "today" }
  | { type: "more"; day: string }
  | { type: "open"; uuid: string };

const LAYOUTS: [CalendarView, string][] = [["month", "Month"], ["week", "Week"]];

export function renderCalendarToolbar(layout: CalendarLayout): string {
  return viewNav("cal", layout.range.label) + `<span class="pl-spacer"></span>` + segmented("Layout", "cal-layout", LAYOUTS, layout.view);
}

function renderDay(d: CalendarDay, i: number): string {
  return `<div class="pl-cal-day" data-cal-day="${d.day}"${flag("data-outside", d.outside)}${flag("data-today", d.today)}${flag("data-weekend", d.weekend)}`
    + ` style="grid-column: ${i + 1}"><span class="pl-cal-num"${d.today ? ' aria-current="date"' : ""}>${esc(d.label)}</span></div>`;
}

function renderBand(b: CalendarBand): string {
  return `<button type="button" class="pl-cal-band" data-cal-band data-cal-open="${esc(b.node.uuid)}" data-kind="${b.kind}" data-cat="${b.cat}" data-lane="${b.lane}"`
    + `${flag("data-cont-before", b.continuesBefore)}${flag("data-cont-after", b.continuesAfter)}`
    + ` style="grid-column: ${b.from + 1} / ${b.to + 1}; grid-row: ${b.lane + 2}" aria-label="${esc(b.label)}" title="${esc(b.label)}">`
    + (b.continuesBefore ? `<span class="pl-cal-cont" aria-hidden="true">‹</span>` : "")
    + `<span class="pl-cal-title">${esc(b.title)}</span>`
    + (b.continuesAfter ? `<span class="pl-cal-cont" aria-hidden="true">›</span>` : "")
    + `</button>`;
}

function renderChip(c: CalendarChip, week: boolean): string {
  return `<button type="button" class="pl-cal-chip" data-cal-chip="${c.kind}" data-cal-open="${esc(c.uuid)}" data-cat="${c.cat}"`
    + ` data-status="${esc(c.status ?? "none")}"${flag("data-late", c.late)}${flag("data-done", c.done)}`
    + ` style="grid-column: ${c.at + 1}; grid-row: ${c.row + 2}" aria-label="${esc(c.label)}" title="${esc(c.label)}">`
    + `<span class="pl-cal-dot" aria-hidden="true"></span>`
    + (c.time ? `<span class="pl-cal-time" data-cal-time>${esc(c.time)}</span>` : "")
    + `<span class="pl-cal-title">${c.kind === "deadline" ? `<span aria-hidden="true">⚑ </span>` : ""}${esc(c.title)}</span>`
    + (week && c.node ? `<span class="pl-cal-node" data-cal-node>${esc(c.node)}</span>` : "")
    + `</button>`;
}

function renderWeek(w: CalendarWeek, week: boolean): string {
  const more = w.days.map((d, i) => d.more
    ? `<button type="button" class="pl-cal-more" data-cal-more="${d.day}" style="grid-column: ${i + 1}; grid-row: ${w.rows + 2}"`
      + ` aria-label="${d.more} more on ${formatDay(d.day)}, show the week">+${d.more} more</button>`
    : "").join("");
  // Explicit rows so a day cell's `grid-row: 1 / -1` reaches the bottom: numbers, item rows, the "+N more" row, filler.
  const rows = w.rows + (more ? 1 : 0);
  const template = `auto${rows ? ` repeat(${rows}, minmax(var(--pl-cal-item-h), auto))` : ""} 1fr`;
  return `<div class="pl-cal-week" data-cal-week="${w.start}" role="group" aria-label="Week of ${formatDay(w.start)}" style="grid-template-rows: ${template}">`
    + w.days.map(renderDay).join("") + w.bands.map(renderBand).join("") + w.chips.map((c) => renderChip(c, week)).join("") + more + `</div>`;
}

/** The calendar grid plus the undated list. `heading` names the nodes (the tag, e.g. "#Project"). */
export function renderCalendar(layout: CalendarLayout, heading: string): string {
  const week = layout.view === "week";
  const weekdays = week ? "" : `<div class="pl-cal-weekdays" data-cal-weekdays aria-hidden="true">${layout.weekdays.map((d) => `<span>${d}</span>`).join("")}</div>`;
  const undated = layout.undated.length
    ? `<p class="pl-cal-undated" data-cal-undated>No dates: ${layout.undated.map((u) => `<button type="button" class="pl-link" data-cal-open="${esc(u.node.uuid)}">${esc(u.title)}</button>`).join(", ")}</p>`
    : "";
  return `<section class="pl-cal" data-calendar data-layout="${layout.view}" aria-label="${esc(`${heading} calendar, ${layout.range.label}`)}">`
    + weekdays + layout.weeks.map((w) => renderWeek(w, week)).join("") + `</section>` + undated;
}

/** The action a click on `target` asks for, or null when it is not a Calendar control. */
export function calendarAction(target: Element): CalendarAction | null {
  const el = target.closest<HTMLElement>("[data-cal-layout], [data-cal-nav], [data-cal-more], [data-cal-open]");
  if (!el) return null;
  const d = el.dataset;
  if (d.calLayout) return { type: "layout", layout: d.calLayout as CalendarView };
  if (d.calNav) return d.calNav === "today" ? { type: "today" } : { type: "nav", dir: d.calNav === "prev" ? -1 : 1 };
  if (d.calMore) return { type: "more", day: d.calMore };
  return { type: "open", uuid: d.calOpen! };
}
