// Timeline view (T08): renders a `TimelineLayout` as HTML for the workspace's view area and its per-view toolbar, and
// names the action a click means. Pure state → HTML, like workspace.ts; the workspace owns state and events.
// One CSS grid of tracks (timeline.css): the label column, then `--pl-tl-tracks` tracks of `--pl-tl-track`; every
// position is a track index from the layout (`grid-column: index + 2`). A track is a day, or 15 minutes in Day zoom (N10).
import { formatDay } from "../core/layout-common";
import { dayFocus, type OutsideCount, type TimelineLayout, type TimelineLink, type TimelineRow, type TimelineTaskRow, type Zoom } from "../core/timeline-layout";
import type { Arrange } from "../core/view-config";
import { esc, flag, segmented, viewNav } from "./html";

export type TimelineAction =
  | { type: "zoom"; zoom: Zoom }
  /** N14: rows by date, by tag (or nested), shown with two or more tags. */
  | { type: "arrange"; arrange: Arrange }
  | { type: "nav"; dir: -1 | 1 }
  | { type: "today" }
  /** A row's toggle; `nested` = a parent's (N14: its children and tasks, open by default), else a row's task rows. */
  | { type: "toggle"; nodeId: number; nested: boolean }
  /** Earlier / later summary: move the range to this day (the nearest node outside it). */
  | { type: "jump"; day: string }
  | { type: "open"; uuid: string };

const ZOOMS: [Zoom, string][] = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["quarter", "Quarter"]];
const ARRANGE_ITEMS: [Arrange, string][] = [["date", "By date"], ["tag", "By tag"], ["nested", "Nested"]];

/**
 * Day zoom track width (15 minutes), set inline so the scroll the view opens at is computed from the same number (the
 * other zooms' widths live in timeline.css). 4 tracks = 48 px per hour.
 */
export const DAY_TRACK_PX = 12;
/** Day zoom: tracks shown before the first item when the view opens (30 minutes), and where an empty day opens (08:00). */
const DAY_LEAD = 2;
const DAY_DEFAULT_TRACK = 32;

/**
 * The Day zoom's grid attributes: its day (`data-tl-start`; the workspace scrolls when it changes) and the scroll it
 * opens at (`data-tl-scroll-left`, px), from `dayFocus` with the rows expanded now.
 */
function dayAttrs(layout: TimelineLayout, expanded: ReadonlySet<number>): string {
  const track = dayFocus(layout, expanded) ?? DAY_DEFAULT_TRACK;
  return ` data-tl-start="${layout.range.start}" data-tl-scroll-left="${Math.max(0, track - DAY_LEAD) * DAY_TRACK_PX}"`;
}

/** Track → grid line (column 1 is the label column). */
const col = (index: number) => index + 2;

/** Range navigation and Zoom; with two or more tags (`arrange` not null, N14) also the Arrange control (`data-tl-arrange`). */
export function renderTimelineToolbar(layout: TimelineLayout, arrange: Arrange | null): string {
  const arranged = arrange === null ? "" : segmented("Arrange", "tl-arrange", ARRANGE_ITEMS, arrange);
  return viewNav("tl", layout.range.label) + `<span class="pl-spacer"></span>` + arranged + segmented("Zoom", "tl-zoom", ZOOMS, layout.zoom);
}

function renderSpan(r: TimelineRow): string {
  const uuid = esc(r.node.uuid);
  // N12: the dependencies in words, so the connectors are not the only way to know them.
  const deps = r.dependsOn.length ? `, depends on ${r.dependsOn.join(", ")}` : "";
  if (r.point !== null) {
    return `<button type="button" class="pl-tl-diamond" data-tl-point data-tl-open="${uuid}" style="grid-column: ${col(r.point)}" aria-label="${esc(r.label + deps)}" title="${esc(r.label + deps)}"></button>`;
  }
  if (r.bar) {
    const b = r.bar;
    const clip = (b.clipStart ? ", continues before this range" : "") + (b.clipEnd ? ", continues after this range" : "") + deps;
    const pct = r.progress.total ? Math.round((r.progress.done / r.progress.total) * 100) : null;
    return `<button type="button" class="pl-tl-bar" data-tl-bar data-tl-open="${uuid}" data-kind="${r.kind}"${flag("data-clip-start", b.clipStart)}${flag("data-clip-end", b.clipEnd)}`
      + ` style="grid-column: ${col(b.from)} / ${col(b.to)}" aria-label="${esc(r.label + clip)}" title="${esc(r.label + clip)}">`
      + (b.clipStart ? `<span class="pl-tl-clip" data-tl-clip="start" aria-hidden="true">‹</span>` : "")
      + `<span class="pl-tl-bar-text" aria-hidden="true">${pct === null ? "" : `${pct}%`}</span>`
      + (pct === null ? "" : `<span class="pl-tl-progress" style="width: ${pct}%"></span>`)
      + (b.clipEnd ? `<span class="pl-tl-clip" data-tl-clip="end" aria-hidden="true">›</span>` : "")
      + `</button>`;
  }
  throw new Error(`timeline row ${r.title} has neither a bar nor a point`);
}

/**
 * "412 earlier · 1,105 later": the dated nodes wholly outside the range (T13a: they get no row). Each side is a button
 * that moves the range to the nearest of them (`data-tl-jump` + `data-tl-day`); nothing when every dated node is in range.
 */
function renderOutside(earlier: OutsideCount, later: OutsideCount): string {
  const side = (key: "earlier" | "later", o: OutsideCount) =>
    o.count && o.nearest
      ? `<button type="button" class="pl-link" data-tl-jump="${key}" data-tl-day="${o.nearest}" aria-label="${o.count.toLocaleString("en-US")} ${key} node${o.count === 1 ? "" : "s"}: go to the nearest, ${esc(formatDay(o.nearest))}">${o.count.toLocaleString("en-US")} ${key}</button>`
      : "";
  const parts = [side("earlier", earlier), side("later", later)].filter(Boolean);
  return parts.length ? `<p class="pl-tl-summary" data-tl-outside-summary>${parts.join(`<span aria-hidden="true"> · </span>`)}</p>` : "";
}

/** A task row under its node's row; `deep` = under a child row (N14), one more indent. */
function renderTask(t: TimelineTaskRow, nodeId: number, deep: boolean): string {
  const markers = t.markers.map((m) => {
    const what = `${m.kind === "deadline" ? "due" : "scheduled"} ${formatDay(m.date.day)}${m.date.time ? ` ${m.date.time}` : ""}${m.late ? ", late" : ""}`;
    return `<span class="pl-tl-marker" data-tl-marker="${m.kind}"${flag("data-late", m.late)} style="grid-column: ${col(m.at)}" title="${esc(what)}"></span>`;
  }).join("");
  const undated = !t.task.scheduled && !t.task.deadline;
  return `<li class="pl-tl-row pl-tl-task${deep ? " pl-tl-deep" : ""}" data-tl-task="${t.task.id}" data-tl-parent="${nodeId}" data-status="${esc(t.status ?? "none")}"${flag("data-done", t.done)}>`
    + `<div class="pl-tl-label"><span class="pl-tl-status" aria-hidden="true"></span>`
    + `<button type="button" class="pl-tl-name" data-tl-open="${esc(t.task.uuid)}" aria-label="${esc(t.label)}">${esc(t.title)}</button>`
    + (undated ? `<span class="pl-tl-nodate">no date</span>` : "") + `</div>${markers}</li>`;
}

/** Session state that decides what is unfolded: rows whose task rows show, nested parents whose children are hidden (N14). */
export interface TimelineShown {
  expanded: ReadonlySet<number>;
  collapsed: ReadonlySet<number>;
}

/**
 * A node's row, then (when open) its task rows and, nested (N14), its child rows with theirs. A parent (`childCount`)
 * is open unless collapsed; any other row is open when expanded. A child row carries `data-tl-child-of="<parent uuid>"`.
 */
function renderRow(r: TimelineRow, shown: TimelineShown): string {
  const id = r.node.id;
  const nested = r.childCount > 0;
  const open = nested ? !shown.collapsed.has(id) : shown.expanded.has(id);
  const what = nested ? "rows under" : "tasks of";
  const toggle = r.tasks.length || nested
    ? `<button type="button" class="pl-tl-toggle" data-tl-toggle="${id}"${flag("data-tl-nested", nested)} aria-expanded="${open}" aria-label="${open ? "Hide" : "Show"} ${what} ${esc(r.title)}">▸</button>`
    : `<span class="pl-tl-toggle" aria-hidden="true"></span>`;
  const count = r.progress.total ? `<span class="pl-tl-count" aria-hidden="true">${r.progress.done}/${r.progress.total}</span>` : "";
  const child = r.parent === null ? "" : ` data-tl-child-of="${esc(r.parent)}"`;
  return `<li class="pl-tl-row${r.parent === null ? "" : " pl-tl-child"}" data-tl-row="${id}"${child} data-cat="${r.cat}"><div class="pl-tl-label">${toggle}`
    + `<button type="button" class="pl-tl-name" data-tl-open="${esc(r.node.uuid)}" aria-label="${esc(r.label)}">${esc(r.title)}</button>${count}</div>`
    + renderSpan(r) + `</li>`
    + (open ? r.tasks.map((t) => renderTask(t, id, r.parent !== null)).join("") + r.children.map((c) => renderRow(c, shown)).join("") : "");
}

/**
 * Dependency connectors (N12): one svg over the grid, under the bars (timeline.css), a path per link
 * (`data-tl-link="<from uuid>:<to uuid>"`) ending in an arrow at the dependent. The paths get their `d` after render
 * (`drawLinks`): geometry comes from the DOM. Nothing when there are no links.
 */
function renderLinks(links: TimelineLink[]): string {
  if (!links.length) return "";
  return `<svg class="pl-tl-links" data-tl-links aria-hidden="true">`
    + `<defs><marker id="pl-tl-arrow" viewBox="0 0 6 6" refX="6" refY="3" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" orient="auto">`
    + `<path d="M0 0 L6 3 L0 6 z" fill="currentColor"></path></marker></defs>`
    + links.map((l) => `<path class="pl-tl-link" data-tl-link="${esc(l.from)}:${esc(l.to)}" marker-end="url(#pl-tl-arrow)"></path>`).join("")
    + `</svg>`;
}

/** Horizontal run out of the dependency's bar and into the dependent's (px), and the elbow's distance from a bar (half the space between the bars of two rows). */
const LINK_STUB = 8;
const LINK_GAP = 6;
/** The sides of a box, as `getBoundingClientRect` gives them. */
export interface LinkRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The `d` of a connector from the dependency's box to the dependent's, in the coordinates of `origin` (the timeline's
 * top left, where the svg sits). Out of the dependency's right edge middle, a stub to the right, vertical to the
 * dependent's middle, then into its left edge middle. When the dependent starts before that stub has room (it overlaps
 * or starts earlier), an elbow: out, vertical to just above (or below) the dependent, back left past its start, vertical
 * to its middle, then in. Straight lines only; numbers to one decimal.
 */
export function linkPath(from: LinkRect, to: LinkRect, origin: { left: number; top: number }): string {
  const n = (v: number) => String(Math.round(v * 10) / 10);
  const x1 = from.right - origin.left;
  const y1 = (from.top + from.bottom) / 2 - origin.top;
  const x2 = to.left - origin.left;
  const y2 = (to.top + to.bottom) / 2 - origin.top;
  const out = `M${n(x1)} ${n(y1)} H${n(x1 + LINK_STUB)}`;
  if (x2 - x1 >= 2 * LINK_STUB) return `${out} V${n(y2)} H${n(x2)}`;
  const elbow = y2 > y1 ? to.top - origin.top - LINK_GAP : to.bottom - origin.top + LINK_GAP;
  return `${out} V${n(elbow)} H${n(x2 - LINK_STUB)} V${n(y2)} H${n(x2)}`;
}

/**
 * Post-render step (N12): measures the bars and points the connectors join and sets each path's `d`. The svg lives in
 * the scrolling content and covers the timeline (timeline.css), so scrolling needs no redraw. Returns at once when the
 * timeline has no connectors, and leaves the paths as they are while it has no size (Planner hidden).
 */
export function drawLinks(tl: HTMLElement): void {
  const paths = [...tl.querySelectorAll<SVGPathElement>("[data-tl-links] [data-tl-link]")];
  if (!paths.length) return;
  const origin = tl.getBoundingClientRect();
  if (origin.width === 0) return;
  const spans = new Map<string, Element>();
  for (const el of tl.querySelectorAll("[data-tl-bar], [data-tl-point]")) spans.set(el.getAttribute("data-tl-open")!, el);
  const box = (uuid: string) => {
    const el = spans.get(uuid);
    if (!el) throw new Error(`Timeline connector: no bar or point for ${uuid}`);
    return el.getBoundingClientRect();
  };
  // Every measurement first, then every write: one layout pass.
  const ds = paths.map((p) => {
    const [from, to] = p.getAttribute("data-tl-link")!.split(":");
    return linkPath(box(from), box(to), origin);
  });
  paths.forEach((p, i) => p.setAttribute("d", ds[i]));
}

/** The rows; arranged by tag (N14), a heading row (`data-tl-group="<tag ident>"`) before each tag's first row. */
function renderRows(layout: TimelineLayout, shown: TimelineShown): string {
  const titles = new Map((layout.groups ?? []).map((g) => [g.tag, g.title]));
  let group: string | null = null;
  return layout.rows.map((r) => {
    const head = layout.groups && r.node.tag !== group
      ? `<li class="pl-tl-row pl-tl-group" data-tl-group="${esc(r.node.tag)}"><div class="pl-tl-label"><span class="pl-tl-group-title">${esc(titles.get(r.node.tag)!)}</span></div></li>`
      : "";
    group = r.node.tag;
    return head + renderRow(r, shown);
  }).join("");
}

/**
 * The timeline grid plus the undated footnote. `heading` names the rows (the tags, e.g. "#Project" or "#Milestone +
 * #Task"); `shown` = the rows unfolded (session state).
 */
export function renderTimeline(layout: TimelineLayout, heading: string, shown: TimelineShown): string {
  const { columns, range } = layout;
  const head = columns.map((c) =>
    `<span class="pl-tl-col" data-tl-col="${c.key}"${flag("data-today", c.today)} style="grid-column: ${col(c.from)} / ${col(c.to)}">${esc(c.label)}</span>`).join("");
  const cells = columns.map((c) =>
    `<i class="pl-tl-cell"${flag("data-weekend", c.weekend)}${flag("data-week-start", c.weekStart)}${flag("data-month-start", c.monthStart)} style="grid-column: ${col(c.from)} / ${col(c.to)}"></i>`).join("");
  const today = layout.todayAt === null ? "" : `<div class="pl-tl-today" data-tl-today aria-hidden="true" style="--pl-tl-today: ${layout.todayAt}"></div>`;
  const undated = layout.undated.length
    ? `<p class="pl-tl-undated" data-tl-undated>No dates: ${layout.undated.map((u) => `<button type="button" class="pl-link" data-tl-open="${esc(u.node.uuid)}">${esc(u.title)}</button>`).join(", ")}</p>`
    : "";
  return renderOutside(layout.earlier, layout.later)
    + (layout.zoom === "day"
      ? `<div class="pl-tl" data-timeline data-zoom="day"${dayAttrs(layout, shown.expanded)} style="--pl-tl-tracks: ${range.tracks}; --pl-tl-track: ${DAY_TRACK_PX}px">`
      : `<div class="pl-tl" data-timeline data-zoom="${layout.zoom}" style="--pl-tl-tracks: ${range.tracks}">`)
    + `<div class="pl-tl-grid" aria-hidden="true">${cells}</div>`
    + `<div class="pl-tl-head" aria-hidden="true"><span class="pl-tl-corner">${esc(heading)}</span>${head}</div>`
    + renderLinks(layout.links)
    + `<ul class="pl-tl-rows" aria-label="${esc(`${heading} timeline, ${range.label}`)}">${renderRows(layout, shown)}</ul>`
    + today + `</div>` + undated;
}

/** The action a click on `target` asks for, or null when it is not a Timeline control. */
export function timelineAction(target: Element): TimelineAction | null {
  const el = target.closest<HTMLElement>("[data-tl-zoom], [data-tl-arrange], [data-tl-nav], [data-tl-toggle], [data-tl-jump], [data-tl-open]");
  if (!el) return null;
  const d = el.dataset;
  if (d.tlZoom) return { type: "zoom", zoom: d.tlZoom as Zoom };
  if (d.tlArrange) return { type: "arrange", arrange: d.tlArrange as Arrange };
  if (d.tlNav) return d.tlNav === "today" ? { type: "today" } : { type: "nav", dir: d.tlNav === "prev" ? -1 : 1 };
  if (d.tlToggle) return { type: "toggle", nodeId: Number(d.tlToggle), nested: el.hasAttribute("data-tl-nested") };
  if (d.tlJump) return { type: "jump", day: d.tlDay! };
  return { type: "open", uuid: d.tlOpen! };
}
