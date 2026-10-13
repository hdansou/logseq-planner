// Calendar view (T09): renders a `CalendarLayout` as HTML for the workspace's view area and its per-view toolbar, and
// names the action a click means. Pure state → HTML, like timeline.ts; the workspace owns state and events.
// Each week row is one CSS grid (calendar.css): seven equal columns; row 1 holds the day numbers, then one row per item
// row of the layout (`grid-row: row + 2`), then the "+N more" row in Month. Day cells span every row as the backdrop.
import { formatDay } from "../core/layout-common";
import type { CalendarBand, CalendarChip, CalendarDay, CalendarLayout, CalendarView, CalendarWeek, GridBlock, TimeGrid } from "../core/calendar-layout";
import { esc, flag, segmented, toggleButton, viewNav } from "./html";

export type CalendarAction =
  | { type: "layout"; layout: CalendarView }
  | { type: "nav"; dir: -1 | 1 }
  | { type: "today" }
  | { type: "more"; day: string }
  | { type: "edit" }
  | { type: "trayMore" }
  | { type: "open"; uuid: string };

const LAYOUTS: [CalendarView, string][] = [["day", "Day"], ["3days", "3 days"], ["week", "Week"], ["month", "Month"]];

/** The hour height in a time grid, px (N46); equals `--pl-cg-hour` in calendar.css (a test keeps them equal). */
export const HOUR_PX = 48;

/**
 * The scrollTop that puts `minute` of the grid just under the sticky head: the grid body starts `bodyTop` px down the
 * scrolling view content and the head, which stays on screen, is `stickyHeight` tall.
 */
export const gridScrollTop = (minute: number, bodyTop: number, stickyHeight: number): number =>
  Math.max(0, Math.round(bodyTop + (minute / 60) * HOUR_PX - stickyHeight - LABEL_ROOM_PX));

/** An hour label is centred on its line: this much room above the focus minute keeps the label under the head in view. */
export const LABEL_ROOM_PX = 8;

/** The id of the one description the editable blocks point at (N46). */
export const GRID_EDIT_HELP_ID = "pl-cg-edit-help";

export function renderCalendarToolbar(layout: CalendarLayout): string {
  const grid = layout.grid;
  const edit = grid ? toggleButton("Edit dates", "cal-edit", grid.editing)
    + (grid.editing ? `<span class="pl-hint" data-cal-edit-hint>Drag a block to move it, drag an edge to resize it</span>` : "") : "";
  return viewNav("cal", layout.range.label) + `<span class="pl-spacer"></span>` + edit + segmented("Layout", "cal-layout", LAYOUTS, layout.view);
}

function renderDay(d: CalendarDay, i: number): string {
  return `<div class="pl-cal-day" data-cal-day="${d.day}" data-cal-drop="${d.day}"${flag("data-outside", d.outside)}${flag("data-today", d.today)}${flag("data-weekend", d.weekend)}`
    + ` style="grid-column: ${i + 1}"><span class="pl-cal-num"${d.today ? ' aria-current="date"' : ""}>${esc(d.label)}</span></div>`;
}

/**
 * N69: the holder a band or chip is dragged by (Chromium starts no drag from a button), placed in the week's grid.
 * `grab` = the day it stands for (a chip's day; a band's is the day under the pointer, found by the workspace). A node
 * of a tag with no Start or End (`fixed`) does not drag.
 */
function holder(uuid: string, grab: string | null, fixed: ReadonlySet<string>, place: string): string {
  const drag = fixed.has(uuid) ? "" : ` draggable="true" data-cal-drag="${esc(uuid)}"${grab ? ` data-cal-grab="${grab}"` : ""}`;
  return `<div class="pl-cal-item"${drag} style="${place}">`;
}

/** `col` / `row`: the first grid column / row items sit in (the all-day row of a time grid has the hour axis as column 1). */
function renderBand(b: CalendarBand, fixed: ReadonlySet<string>, col = 1, row = 2): string {
  return holder(b.node.uuid, null, fixed, `grid-column: ${b.from + col} / ${b.to + col}; grid-row: ${b.lane + row}`)
    + `<button type="button" class="pl-cal-band" data-cal-band data-cal-open="${esc(b.node.uuid)}" data-kind="${b.kind}" data-cat="${b.cat}" data-lane="${b.lane}"`
    + `${flag("data-cont-before", b.continuesBefore)}${flag("data-cont-after", b.continuesAfter)}`
    + ` aria-label="${esc(b.label)}" title="${esc(b.label)}">`
    + (b.continuesBefore ? `<span class="pl-cal-cont" aria-hidden="true">‹</span>` : "")
    + `<span class="pl-cal-title">${esc(b.title)}</span>`
    + (b.continuesAfter ? `<span class="pl-cal-cont" aria-hidden="true">›</span>` : "")
    + `</button></div>`;
}

function renderChip(c: CalendarChip, week: boolean, fixed: ReadonlySet<string>, col = 1, row = 2): string {
  return holder(c.uuid, c.date.day, fixed, `grid-column: ${c.at + col}; grid-row: ${c.row + row}`)
    + `<button type="button" class="pl-cal-chip" data-cal-chip="${c.kind}" data-cal-open="${esc(c.uuid)}" data-cat="${c.cat}"`
    + ` data-status="${esc(c.status ?? "none")}"${flag("data-late", c.late)}${flag("data-done", c.done)}`
    + ` aria-label="${esc(c.label)}" title="${esc(c.label)}">`
    + `<span class="pl-cal-dot" aria-hidden="true"></span>`
    + (c.time ? `<span class="pl-cal-time" data-cal-time>${esc(c.time)}</span>` : "")
    + `<span class="pl-cal-title">${c.kind === "deadline" ? `<span aria-hidden="true">⚑ </span>` : ""}${esc(c.title)}</span>`
    + (week && c.node ? `<span class="pl-cal-node" data-cal-node>${esc(c.node)}</span>` : "")
    + `</button></div>`;
}

function renderWeek(w: CalendarWeek, week: boolean, fixed: ReadonlySet<string>): string {
  const more = w.days.map((d, i) => d.more
    ? `<button type="button" class="pl-cal-more" data-cal-more="${d.day}" style="grid-column: ${i + 1}; grid-row: ${w.rows + 2}"`
      + ` aria-label="${d.more} more on ${formatDay(d.day)}, show the week">+${d.more} more</button>`
    : "").join("");
  // Explicit rows so a day cell's `grid-row: 1 / -1` reaches the bottom: the day-number row, item rows, the "+N more" row,
  // filler. The number row has a fixed height: nothing else sizes it (the number sits in the day cell spanning every row),
  // so `auto` collapsed to 0 and lane-0 bands covered the numbers (T09 D1).
  const rows = w.rows + (more ? 1 : 0);
  const template = `var(--pl-cal-head-h)${rows ? ` repeat(${rows}, minmax(var(--pl-cal-item-h), auto))` : ""} 1fr`;
  return `<div class="pl-cal-week" data-cal-week="${w.start}" role="group" aria-label="Week of ${formatDay(w.start)}" style="grid-template-rows: ${template}">`
    + w.days.map(renderDay).join("") + w.bands.map((b) => renderBand(b, fixed)).join("") + w.chips.map((c) => renderChip(c, week, fixed)).join("") + more + `</div>`;
}

/** A block this short (minutes: a point or deadline, 30 minutes = 23 px) has room for one line, so its title and time share it (N56). */
export const SHORT_BLOCK_MIN = 30;

function renderBlock(b: GridBlock, editing: boolean): string {
  const mark = b.edit ? `${flag("data-cg-editable", true)}${flag("data-cg-move", b.edit.move)} aria-describedby="${GRID_EDIT_HELP_ID}"` : "";
  const handles = b.edit && !b.edit.point
    ? `<span class="pl-cg-handle" data-cg-handle="start" aria-hidden="true"></span><span class="pl-cg-handle" data-cg-handle="end" aria-hidden="true"></span>` : "";
  const locked = editing && !b.edit && !b.pending ? flag("data-cg-locked", true) : "";
  const short = flag("data-cg-short", b.endMin - b.startMin <= SHORT_BLOCK_MIN);
  return `<button type="button" class="pl-cg-block" data-cg-block="${b.kind}"${short} data-cal-open="${esc(b.uuid)}" data-cat="${b.cat}"`
    + ` data-status="${esc(b.status ?? "none")}"${flag("data-late", b.late)}${flag("data-done", b.done)}${mark}${locked}${flag("data-cg-pending", b.pending)}${b.pending ? ' aria-busy="true"' : ""}`
    + ` style="--pl-start: ${b.startMin}; --pl-len: ${b.endMin - b.startMin}; --pl-col: ${b.col}; --pl-cols: ${b.cols}"`
    + ` aria-label="${esc(b.label)}" title="${esc(b.label)}">`
    + `<span class="pl-cg-title">${b.kind === "deadline" ? `<span aria-hidden="true">⚑ </span>` : ""}${esc(b.title)}</span>`
    + `<span class="pl-cg-time" data-cg-time>${esc(b.timeLabel)}</span>`
    + (b.node ? `<span class="pl-cal-node" data-cal-node>${esc(b.node)}</span>` : "")
    + handles + `</button>`;
}

/** The time grids (N46): sticky day heads and all-day row over a 24-hour body, one column per day after the hour axis. */
function renderGrid(g: TimeGrid, fixed: ReadonlySet<string>): string {
  const n = g.days.length;
  const head = g.days.map((d, i) => `<div class="pl-cg-dayhead" data-cg-day="${d.day}" data-cal-drop="${d.day}"${flag("data-today", d.today)}${flag("data-weekend", d.weekend)}`
    + ` style="grid-column: ${i + 2}"><span class="pl-cal-num"${d.today ? ' aria-current="date"' : ""}>${esc(d.label)}</span></div>`).join("");
  const rows = `repeat(${Math.max(1, g.allDay.rows)}, minmax(var(--pl-cal-item-h), auto))`;
  const allDay = `<div class="pl-cg-allday" data-cg-allday style="--pl-cg-days: ${n}; grid-template-rows: ${rows}">`
    + `<span class="pl-cg-axis-label">all-day</span>`
    + g.days.map((d, i) => `<div class="pl-cg-allday-cell" data-cal-drop="${d.day}" style="grid-column: ${i + 2}"></div>`).join("")
    + g.allDay.bands.map((b) => renderBand(b, fixed, 2, 1)).join("") + g.allDay.chips.map((c) => renderChip(c, true, fixed, 2, 1)).join("") + `</div>`;
  const hours = Array.from({ length: 24 }, (_, h) => `<span class="pl-cg-hour" data-cg-hour style="--pl-start: ${h * 60}">${String(h).padStart(2, "0")}:00</span>`).join("");
  const cols = g.days.map((d) => `<div class="pl-cg-col" data-cg-col="${d.day}"${flag("data-today", d.today)}${flag("data-weekend", d.weekend)}>`
    + g.blocks.filter((b) => b.day === d.day).map((b) => renderBlock(b, g.editing)).join("")
    + (g.now?.day === d.day ? `<div class="pl-cg-now" data-cg-now style="--pl-start: ${g.now.minute}" aria-hidden="true"></div>` : "") + `</div>`).join("");
  const mark = g.now ? `<span class="pl-cg-now-mark" data-cg-now-mark style="--pl-start: ${g.now.minute}" aria-hidden="true">▸</span>` : "";
  const help = g.editing
    ? `<p id="${GRID_EDIT_HELP_ID}" data-cg-edit-help hidden>Dates can be edited: drag a block to move it, or drag its top or bottom edge to change its start or end. `
      + `Alt+Left and Alt+Right move it a day; Alt+Up and Alt+Down move it 15 minutes; Alt+Shift+Up and Alt+Shift+Down change its end by 15 minutes.</p>`
    : "";
  return help + `<div class="pl-cg-sticky" data-cg-sticky><div class="pl-cg-head" style="--pl-cg-days: ${n}"><span></span>${head}</div>${allDay}</div>`
    + `<div class="pl-cg-body" data-cg-body data-cg-focus="${g.focusMinute}" style="--pl-cg-days: ${n}"><div class="pl-cg-axis">${hours}${mark}</div>${cols}</div>`;
}

/** The No date tray's page: this many items, then a "more" button (N69). */
export const CALENDAR_TRAY_PAGE = 100;

/** What the workspace's Calendar drags need (N69): nodes that cannot move, and how many tray items render. */
export interface CalendarDrag {
  fixed: ReadonlySet<string>;
  tray: number;
}

/**
 * N69: the No date tray under the calendar: the undated items (each dragged onto a day to give it that day), and a drop
 * target that removes a dated item's dates. Shown empty only to take a drop.
 */
function renderTray(layout: CalendarLayout, drag: CalendarDrag): string {
  const items = layout.undated.slice(0, drag.tray);
  const rest = layout.undated.length - items.length;
  const list = items.map((u) => `<li class="pl-cal-item"${drag.fixed.has(u.node.uuid) ? "" : ` draggable="true" data-cal-drag="${esc(u.node.uuid)}"`}>`
    + `<button type="button" class="pl-cal-chip" data-cal-open="${esc(u.node.uuid)}">${esc(u.title)}</button></li>`).join("");
  return `<section class="pl-cal-tray" data-cal-tray data-cal-drop="none"${flag("data-empty", !layout.undated.length)} aria-label="No date">`
    + `<h3 class="pl-cal-tray-head">No date <span class="pl-cal-tray-count">${layout.undated.length}</span>`
    + `<span class="pl-hint" data-cal-drag-hint>Drag onto a day to give it that date; drop a dated item here to remove its dates.</span></h3>`
    + (list ? `<ul class="pl-cal-tray-list" data-cal-undated>${list}</ul>` : "")
    + (rest > 0 ? `<button type="button" class="pl-btn pl-cal-tray-more" data-cal-tray-more data-rest="${rest}">Show ${Math.min(rest, CALENDAR_TRAY_PAGE).toLocaleString("en-US")} more${rest > CALENDAR_TRAY_PAGE ? ` of ${rest.toLocaleString("en-US")}` : ""}</button>` : "")
    + `</section>`;
}

/** The calendar grid plus the No date tray. `heading` names the nodes (the tag, e.g. "#Project"). */
export function renderCalendar(layout: CalendarLayout, heading: string, drag: CalendarDrag = { fixed: new Set(), tray: CALENDAR_TRAY_PAGE }): string {
  const tray = renderTray(layout, drag);
  const label = esc(`${heading} calendar, ${layout.range.label}`);
  if (layout.grid) {
    return `<section class="pl-cal pl-cg" data-calendar data-layout="${layout.view}" data-cg-key="${layout.view}|${layout.range.start}" aria-label="${label}">`
      + renderGrid(layout.grid, drag.fixed) + `</section>` + tray;
  }
  const weekdays = `<div class="pl-cal-weekdays" data-cal-weekdays aria-hidden="true">${layout.weekdays.map((d) => `<span>${d}</span>`).join("")}</div>`;
  return `<section class="pl-cal" data-calendar data-layout="${layout.view}" aria-label="${label}">`
    + weekdays + layout.weeks.map((w) => renderWeek(w, false, drag.fixed)).join("") + `</section>` + tray;
}

/** The action a click on `target` asks for, or null when it is not a Calendar control. */
export function calendarAction(target: Element): CalendarAction | null {
  const el = target.closest<HTMLElement>("[data-cal-layout], [data-cal-nav], [data-cal-more], [data-cal-edit], [data-cal-tray-more], [data-cal-open]");
  if (!el) return null;
  const d = el.dataset;
  if (d.calLayout) return { type: "layout", layout: d.calLayout as CalendarView };
  if (d.calNav) return d.calNav === "today" ? { type: "today" } : { type: "nav", dir: d.calNav === "prev" ? -1 : 1 };
  if (d.calMore) return { type: "more", day: d.calMore };
  if (el.hasAttribute("data-cal-edit")) return { type: "edit" };
  if (el.hasAttribute("data-cal-tray-more")) return { type: "trayMore" };
  return { type: "open", uuid: d.calOpen! };
}
