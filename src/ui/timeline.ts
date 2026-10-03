// Timeline view (T08): renders a `TimelineLayout` as HTML for the workspace's view area and its per-view toolbar, and
// names the action a click means. Pure state → HTML, like workspace.ts; the workspace owns state and events.
// One CSS grid of day tracks (timeline.css): the label column, then `--pl-tl-days` tracks of `--pl-tl-day`; every
// position is a day index from the layout (`grid-column: index + 2`).
import { formatDay } from "../core/layout-common";
import { type TimelineLayout, type TimelineRow, type TimelineTaskRow, type Zoom } from "../core/timeline-layout";
import type { LocalDate } from "../types";

export type TimelineAction =
  | { type: "zoom"; zoom: Zoom }
  | { type: "nav"; dir: -1 | 1 }
  | { type: "today" }
  | { type: "toggle"; nodeId: number }
  | { type: "open"; uuid: string };

const ZOOMS: [Zoom, string][] = [["week", "Week"], ["month", "Month"], ["quarter", "Quarter"]];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const flag = (name: string, on: boolean) => (on ? ` ${name}` : "");
/** Day index → grid line (column 1 is the label column). */
const col = (index: number) => index + 2;
const dates = (a: LocalDate, b: LocalDate) => (a.day === b.day ? formatDay(a.day) : `${formatDay(a.day)} – ${formatDay(b.day)}`);

export function renderTimelineToolbar(layout: TimelineLayout): string {
  const zoom = ZOOMS.map(([z, text]) => `<button type="button" data-tl-zoom="${z}" aria-pressed="${z === layout.zoom}">${text}</button>`).join("");
  return `<div class="pl-tl-nav">`
    + `<button type="button" class="pl-btn pl-tl-step" data-tl-nav="prev" aria-label="Previous">‹</button>`
    + `<b class="pl-tl-range" data-tl-range aria-live="polite">${esc(layout.range.label)}</b>`
    + `<button type="button" class="pl-btn pl-tl-step" data-tl-nav="next" aria-label="Next">›</button>`
    + `<button type="button" class="pl-btn" data-tl-nav="today">Today</button></div>`
    + `<span class="pl-spacer"></span><div class="pl-seg" role="group" aria-label="Zoom">${zoom}</div>`;
}

function renderSpan(r: TimelineRow): string {
  const uuid = esc(r.node.uuid);
  if (r.point !== null) {
    return `<button type="button" class="pl-tl-diamond" data-tl-point data-tl-open="${uuid}" style="grid-column: ${col(r.point)}" aria-label="${esc(r.label)}" title="${esc(r.label)}"></button>`;
  }
  if (r.bar) {
    const b = r.bar;
    const clip = (b.clipStart ? ", continues before this range" : "") + (b.clipEnd ? ", continues after this range" : "");
    const pct = r.progress.total ? Math.round((r.progress.done / r.progress.total) * 100) : null;
    return `<button type="button" class="pl-tl-bar" data-tl-bar data-tl-open="${uuid}" data-kind="${r.kind}"${flag("data-clip-start", b.clipStart)}${flag("data-clip-end", b.clipEnd)}`
      + ` style="grid-column: ${col(b.from)} / ${col(b.to)}" aria-label="${esc(r.label + clip)}" title="${esc(r.label + clip)}">`
      + (b.clipStart ? `<span class="pl-tl-clip" data-tl-clip="start" aria-hidden="true">‹</span>` : "")
      + `<span class="pl-tl-bar-text" aria-hidden="true">${pct === null ? "" : `${pct}%`}</span>`
      + (pct === null ? "" : `<span class="pl-tl-progress" style="width: ${pct}%"></span>`)
      + (b.clipEnd ? `<span class="pl-tl-clip" data-tl-clip="end" aria-hidden="true">›</span>` : "")
      + `</button>`;
  }
  // Wholly outside the range: a hint at the edge it lies beyond.
  const before = r.outside === "before";
  return `<span class="pl-tl-outside" data-tl-outside="${r.outside}">${before ? "‹ " : ""}${dates(r.start, r.end)}${before ? "" : " ›"}</span>`;
}

function renderTask(t: TimelineTaskRow, nodeId: number): string {
  const markers = t.markers.map((m) => {
    const what = `${m.kind === "deadline" ? "due" : "scheduled"} ${formatDay(m.date.day)}${m.date.time ? ` ${m.date.time}` : ""}${m.late ? ", late" : ""}`;
    return `<span class="pl-tl-marker" data-tl-marker="${m.kind}"${flag("data-late", m.late)} style="grid-column: ${col(m.at)}" title="${esc(what)}"></span>`;
  }).join("");
  const undated = !t.task.scheduled && !t.task.deadline;
  return `<li class="pl-tl-row pl-tl-task" data-tl-task="${t.task.id}" data-tl-parent="${nodeId}" data-status="${esc(t.status ?? "none")}"${flag("data-done", t.done)}>`
    + `<div class="pl-tl-label"><span class="pl-tl-status" aria-hidden="true"></span>`
    + `<button type="button" class="pl-tl-name" data-tl-open="${esc(t.task.uuid)}" aria-label="${esc(t.label)}">${esc(t.title)}</button>`
    + (undated ? `<span class="pl-tl-nodate">no date</span>` : "") + `</div>${markers}</li>`;
}

function renderRow(r: TimelineRow, expanded: boolean): string {
  const id = r.node.id;
  const toggle = r.tasks.length
    ? `<button type="button" class="pl-tl-toggle" data-tl-toggle="${id}" aria-expanded="${expanded}" aria-label="${expanded ? "Hide" : "Show"} tasks of ${esc(r.title)}">▸</button>`
    : `<span class="pl-tl-toggle" aria-hidden="true"></span>`;
  const count = r.progress.total ? `<span class="pl-tl-count" aria-hidden="true">${r.progress.done}/${r.progress.total}</span>` : "";
  return `<li class="pl-tl-row" data-tl-row="${id}" data-cat="${r.cat}"><div class="pl-tl-label">${toggle}`
    + `<button type="button" class="pl-tl-name" data-tl-open="${esc(r.node.uuid)}" aria-label="${esc(r.label)}">${esc(r.title)}</button>${count}</div>`
    + renderSpan(r) + `</li>`
    + (expanded ? r.tasks.map((t) => renderTask(t, id)).join("") : "");
}

/** The timeline grid plus the undated footnote. `heading` names the rows (the tag, e.g. "#Project"). */
export function renderTimeline(layout: TimelineLayout, heading: string, expanded: ReadonlySet<number>): string {
  const { columns, rows, range } = layout;
  const head = columns.map((c) =>
    `<span class="pl-tl-col" data-tl-col="${c.start}"${flag("data-today", c.today)} style="grid-column: ${col(c.from)} / ${col(c.to)}">${esc(c.label)}</span>`).join("");
  const cells = columns.map((c) =>
    `<i class="pl-tl-cell"${flag("data-weekend", c.weekend)}${flag("data-week-start", c.weekStart)}${flag("data-month-start", c.monthStart)} style="grid-column: ${col(c.from)} / ${col(c.to)}"></i>`).join("");
  const today = layout.todayAt === null ? "" : `<div class="pl-tl-today" data-tl-today aria-hidden="true" style="--pl-tl-today: ${layout.todayAt}"></div>`;
  const undated = layout.undated.length
    ? `<p class="pl-tl-undated" data-tl-undated>No dates: ${layout.undated.map((u) => `<button type="button" class="pl-tl-link" data-tl-open="${esc(u.node.uuid)}">${esc(u.title)}</button>`).join(", ")}</p>`
    : "";
  return `<div class="pl-tl" data-timeline data-zoom="${layout.zoom}" style="--pl-tl-days: ${range.days}">`
    + `<div class="pl-tl-grid" aria-hidden="true">${cells}</div>`
    + `<div class="pl-tl-head" aria-hidden="true"><span class="pl-tl-corner">${esc(heading)}</span>${head}</div>`
    + `<ul class="pl-tl-rows" aria-label="${esc(`${heading} timeline, ${range.label}`)}">${rows.map((r) => renderRow(r, expanded.has(r.node.id))).join("")}</ul>`
    + today + `</div>` + undated;
}

/** The action a click on `target` asks for, or null when it is not a Timeline control. */
export function timelineAction(target: Element): TimelineAction | null {
  const el = target.closest<HTMLElement>("[data-tl-zoom], [data-tl-nav], [data-tl-toggle], [data-tl-open]");
  if (!el) return null;
  const d = el.dataset;
  if (d.tlZoom) return { type: "zoom", zoom: d.tlZoom as Zoom };
  if (d.tlNav) return d.tlNav === "today" ? { type: "today" } : { type: "nav", dir: d.tlNav === "prev" ? -1 : 1 };
  if (d.tlToggle) return { type: "toggle", nodeId: Number(d.tlToggle) };
  return { type: "open", uuid: d.tlOpen! };
}
