// The full-screen workspace shell: top bar (view switch, saved views, Close), settings bar (tags, child tags,
// Start and End, or Dates per tag with several tags (N14), done values), the main area with a per-view toolbar slot,
// and the panel on its right (tag tree with a checkbox per tag, and filters, N13).
// Renders the whole shell from `State` on every change (small pure render functions returning HTML) and
// handles every event by delegation on the root. No SDK: graph access arrives as `WorkspaceDeps`.
// The Timeline (T08), the Calendar (T09), the Agenda (T10) and the Kanban (T11) render into the view area and the toolbar slot.
// Kanban moves are written through the injected `kanban` deps; drag events are delegated on the root like clicks.
// Timeline date edits (N06c, Edit dates on) are written through the injected `dates` deps: pointer events on a bar or
// point (pointer capture, no HTML5 drag) and Alt+Arrow keys on a focused one.
import { readRaw } from "../core/queries";
import { isDone } from "../core/nodes";
import { systemZone, type ZoneOffset } from "../core/normalize";
import type { Dq } from "../core/schema";
import { loadTagInfos, tagsTitle, TAG_KEY, type ViewTags } from "../core/schema";
import {
  defaultViewConfig, dependsOnOf, parseViewConfig, serializeViewConfig, validateViewConfig, VIEW_KINDS, withDefaults, withKnownTags, withTags,
  type ViewConfig, type ViewKind,
} from "../core/view-config";
import { clampDelta, editedBar, perDayOf, shiftAnchor, shownRows, type TimelineLayout, type TimelineRange, type TimelineRow } from "../core/timeline-layout";
import { dateChanges, writeDates, type DateChange, type EditMode } from "../core/date-edit";
import { shiftCalendarAnchor } from "../core/calendar-layout";
import { cardCell, moveDescriptor, moveTarget, writeMove, type KanbanLayout, type PropertyWrite } from "../core/kanban";
import { sanitizeViewName, type ListedView, type SavedView, type ViewStore } from "../storage";
import type { UiPrefs, UiStore } from "../ui-state";
import type { ChoiceProp, DateWriteDeps, KanbanWriteDeps, PlannerNode, PlannerTask, Surface, TagInfo } from "../types";
import { checkList, esc, flag, menu as menuHtml, options } from "./html";
import { calendarAction } from "./calendar";
import { AGENDA_GROUP_PAGE, agendaAction } from "./agenda";
import { KANBAN_CELL_PAGE, kanbanAction } from "./kanban";
import { drawLinks, timelineAction, TRACK_PX } from "./timeline";
import { empty, kanbanLayout, readViewData, renderViewArea, timelineLayoutOf, viewData, type Now, type ViewAreaInput } from "./view-area";

/** What a measurement ended with: the view was drawn, the data was unchanged, the redraw waited for the user, or it failed. */
export type TimingOutcome = "redrawn" | "same" | "deferred" | "error";

/**
 * Dev-only measurement hook (T13, `src/dev-timings.ts`); absent in production, so every call is `deps.timing?.…`.
 * `begin("load")` = open() called; `begin("refresh")` = the debounced trigger asked for a reload. `queried()` = the
 * graph reads are done; `rendered()` = the DOM shows the result (a refresh that changes nothing ends as "same").
 */
export interface Timing {
  begin(kind: "load" | "refresh"): void;
  queried(): void;
  rendered(outcome: TimingOutcome): void;
}

export interface WorkspaceDeps {
  dq: Dq;
  views: ViewStore;
  /** Close button: the app hides the main UI. */
  onClose(): void;
  /** Local zone offset for DateTime values; defaults to the machine's. */
  zone?: ZoneOffset;
  /** Opens a node (page or block) by uuid: in the main area, or in the right sidebar with Shift. */
  openNode(uuid: string, opts: { sidebar: boolean }): void;
  /** Today as a local `YYYY-MM-DD`; defaults to the machine's clock. */
  today?: () => string;
  /** The local time now as `HH:MM` (the Timeline Day zoom's now line, N10); defaults to the machine's clock. */
  time?: () => string;
  /** The host's first day of the week, 0 = Sunday … 6 = Saturday; read on every `open()`. */
  weekStart(): Promise<number>;
  /** The SDK calls behind a Kanban move (`kanbanWriteDeps()` in src/sdk.ts). */
  kanban: KanbanWriteDeps;
  /** The SDK calls behind a Timeline date edit (`dateWriteDeps()` in src/sdk.ts, N06c). */
  dates: DateWriteDeps;
  /** Dev-only load / refresh timings; omitted in production. */
  timing?: Timing;
  /**
   * The Workspace | Sidebar switch picked a surface (N06a): the app docks the frame or restores it. Given only when the
   * host document is reachable (desktop app); absent, the switch is not rendered (web app, dev server).
   */
  setSurface?(surface: Surface): void;
  /**
   * Per-graph UI state (N21, src/ui-state.ts): read on the first load of a graph, written whenever the panel, the
   * surface, Edit dates or the view on screen changes. Absent, nothing is remembered.
   */
  prefs?: UiStore;
}

export interface Workspace {
  /** (Re)loads tags, saved views and the current view's nodes; call on every open. */
  open(): Promise<void>;
  /**
   * Quiet reload for live updates (T12): re-reads the host week start, the tags and the current view's data, and redraws
   * only when something differs from what is shown, keeping scroll, expanded rows, unfolded buckets and focus. Waits (and
   * resolves) while a popover is open, a Kanban write is pending or a card is being dragged, then runs once it is over.
   * Never rejects: a failure shows in the error bar.
   */
  refresh(): Promise<void>;
  /**
   * Planner was shown again: re-lists the saved views from the graph (the store's cache is dropped first), so views
   * added or deleted on another device show (T14). Queued; an error shows in the error bar.
   */
  showViews(): Promise<void>;
  /**
   * Opens a saved view by id (N06b: "Open in Planner" on an in-page block): re-lists the saved views, then shows that
   * one as the Saved views menu does; the surface switch shows the workspace. Queued; an error shows in the error bar.
   */
  openView(id: string): Promise<void>;
  /**
   * The host switched to another graph (N04): back to the state of a first open (no tags, config, nodes, saved views,
   * error; no expanded or folded sets, no pending writes), kept: the surface, the panel's open state, Edit dates. Queued
   * behind any running action; the caller then calls `open()` when Planner is shown.
   */
  reset(): Promise<void>;
  /** Closes an open popover, else the open panel drawer (N13), and returns true; false when there is nothing to close (the app then closes Planner). */
  escape(): boolean;
  /** Resolves when every queued action has finished (tests, focus after open). */
  idle(): Promise<void>;
  /** The current view config (null until a tag exists). */
  config(): ViewConfig | null;
  /** Removes the listeners the workspace put outside its root (the window resize that redraws the Timeline connectors, the narrow-width media query); call on unload. */
  stop(): void;
}

type Popover = "tag" | "start" | "end" | "dates" | "depends" | "done" | "views" | "kb-column" | "kb-show" | "kb-lane" | "kb-move";

interface State {
  loading: boolean;
  /** Reading the week start or the tags on open failed: the error bar says why; the main area offers Retry (T14). */
  loadFailed: boolean;
  tags: TagInfo[];
  config: ViewConfig | null;
  nodes: PlannerNode[];
  tasks: PlannerTask[];
  /** Titles of every node and linked block the loaded titles reference, by lower-case uuid (loaded nodes + one lookup per load). */
  titles: ReadonlyMap<string, string>;
  /** Saved views as the store lists them, unreadable ones included (shown greyed, deletable, never opened). */
  views: ListedView[];
  /** The saved view the current config came from or was saved as. */
  viewId: string | null;
  /** The saved view whose row asks "Delete?" (N23); session state, dropped when a menu is opened or closed. */
  viewDeleting: string | null;
  popover: Popover | null;
  error: string | null;
  /** The built-in tags group of the tag tree is open (collapsed by default; opened when a built-in tag is selected). */
  builtInOpen: boolean;
  /** Timeline / Calendar anchor day (shared, so switching kinds keeps the period); null = today. Session state: never saved with a view. */
  anchor: string | null;
  /** Node ids whose task rows are expanded (Timeline). Session state. */
  expanded: Set<number>;
  /** Timeline nested (N14): parent node ids whose children (and task rows) are hidden; parents start open. Session state. */
  collapsed: Set<number>;
  /** The host's week start, read on every open; null before the first. */
  weekStart: number | null;
  /** Kanban moves being written, by node uuid: the card shows where the writes put it (optimistic). Session state. */
  pending: Map<string, PropertyWrite[]>;
  /** The card whose Move menu is (or was last) open. */
  moveCard: string | null;
  /** Agenda: folded buckets the user opened (only those render their entries). Session state. */
  agendaOpen: Set<string>;
  /** Agenda by node: how many groups are rendered. Session state. */
  agendaGroups: number;
  /** Agenda by date: how many Overdue entries are rendered. Session state. */
  agendaOverdue: number;
  /** Kanban: cards rendered per cell by `cellKey`, for cells whose "Show more" was used. Session state. */
  kbShown: Map<string, number>;
  /**
   * The panel (tag tree, filters) is shown, per width mode (N13): docked beside the view in a wide frame (open by
   * default), a drawer over it in a narrow one (closed by default). The toggle sets the current mode's value only, so
   * crossing the breakpoint without a toggle follows the defaults. Session state: in memory only, nothing is persisted.
   */
  panelOpen: { wide: boolean; narrow: boolean };
  /** The frame is narrower than 640 px (`NARROW_MEDIA`): the panel is a drawer. */
  narrow: boolean;
  /** The surface switch is shown (`setSurface` given: desktop app). */
  canDock: boolean;
  /** The surface the switch shows pressed (N06a); session state, starts as the workspace. */
  surface: Surface;
  /** Timeline: the Edit dates toggle (N06c). Session state: off on start, never saved with a view. */
  editDates: boolean;
  /** Timeline date edits being written, by node uuid: the bar shows at its new place (optimistic). Session state. */
  datePending: Map<string, DateChange[]>;
}

/** A pointer that moves less than this (px) from where it went down is a click (N06c). */
export const CLICK_PX = 4;

/** A Timeline bar or point being dragged (N06c): only its inline grid placement changes until the drop. */
interface TlDrag {
  el: HTMLElement;
  pointerId: number;
  /** clientX where the pointer went down. */
  x: number;
  mode: EditMode;
  row: TimelineRow;
  range: TimelineRange;
  /** Track width (px) of the zoom. */
  px: number;
  /** The element's style before the drag (restored when it ends without a write). */
  style: string;
  /** Tracks moved so far, clamped (`clampDelta`). */
  delta: number;
  /** Past `CLICK_PX`: a drag, not a click. */
  moved: boolean;
}

/** Below this width the panel is a drawer over the view (N13); workspace.css has the same media query. */
export const NARROW_MEDIA = "(max-width: 639px)";
const panelShown = (s: State) => s.panelOpen[s.narrow ? "narrow" : "wide"];
/** The panel is open over the view as a drawer: Escape and a click outside close it. */
const drawerOpen = (s: State) => s.narrow && s.panelOpen.narrow;

const KIND_LABEL: Record<ViewKind, string> = { timeline: "Timeline", calendar: "Calendar", agenda: "Agenda", kanban: "Kanban" };
/** The elements that scroll inside the workspace: the view area (both axes: the Kanban board and the Timeline scroll sideways) and the panel. */
const SCROLL_REGIONS = ["[data-region=view]", "[data-region=panel]"];
const byTitle = (a: TagInfo, b: TagInfo) => a.title.localeCompare(b.title);

// ---------------------------------------------------------------- pure helpers

/** Tags with no parent in `tags`, own first, by title: the top level of the tag tree. */
const rootsOf = (tags: TagInfo[]) => {
  const ids = new Set(tags.map((t) => t.id));
  return tags.filter((t) => !t.parentIds.some((id) => ids.has(id))).sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || byTitle(a, b));
};

/**
 * The tag a fresh workspace shows: the first own root tag with a date property in tree order, else the first own
 * tag with one, else the first tag (T07 D3: a child tag sorting first alphabetically must not win).
 */
export function initialTag(tags: TagInfo[]): TagInfo | null {
  const hasDates = (t: TagInfo) => !t.builtIn && t.dateProps.length > 0;
  const ordered = [...tags].sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || byTitle(a, b));
  return rootsOf(tags).find(hasDates) ?? ordered.find(hasDates) ?? ordered[0] ?? null;
}

/** Keeps the shared fields (tags, dates, filters, done values, dependency property) and takes the new kind's defaults for the rest. */
export function switchKind(config: ViewConfig, view: ViewTags, kind: ViewKind): ViewConfig {
  const { tags, childTags, dates, doneValues, filters } = config;
  return { ...defaultViewConfig(view.tags, kind), tags, childTags, dates, doneValues, filters, ..."dependsOn" in config ? { dependsOn: config.dependsOn } : {} };
}

/** The choice property the done-values control is labelled with: Status, else the first one. */
const primaryChoice = (view: ViewTags): ChoiceProp | undefined => view.choiceProps.find((p) => p.title === "Status") ?? view.choiceProps[0];

/** Uuids of `prop`'s values that count as done under `config` (saved override, else the default rule). */
const doneUuids = (config: ViewConfig, prop: ChoiceProp) => prop.values.filter((v) => isDone(v, config.doneValues[prop.ident])).map((v) => v.uuid);

const toggle = <T>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

const pad2 = (n: number) => String(n).padStart(2, "0");
/** The machine's local day as `YYYY-MM-DD` (the default `today`). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** The machine's local time as `HH:MM` (the default `time`). */
export function localTime(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The Timeline in Day zoom: the only view that shows the time of day (its now line). */
const showsTime = (config: ViewConfig | null) => config?.kind === "timeline" && config.zoom === "day";

// ---------------------------------------------------------------- render (pure: state → HTML)

/** A menu trigger plus, when open, its popover (html.ts `menu`), open when it is the state's popover. */
const menu = (kind: Popover, s: State, label: string, buttonText: string, popover: () => string, control: string = kind) =>
  menuHtml(kind, s.popover === kind, label, buttonText, popover, control);

function renderTopBar(s: State): string {
  const kind = s.config?.kind;
  const seg = VIEW_KINDS.map((k) => `<button type="button" data-view-kind="${k}" aria-pressed="${k === kind}"${s.config ? "" : " disabled"}>${KIND_LABEL[k]}</button>`).join("");
  const current = s.views.find((v) => v.id === s.viewId);
  const viewsPopover = () => {
    const rows = s.views.length
      ? `<ul class="pl-view-list" aria-label="Saved views">${s.views
          .map((v) => v.id === s.viewDeleting
            ? `<li class="pl-view-confirm" data-view-deleting="${esc(v.id)}"><span class="pl-row">Delete "${esc(v.name)}"?</span>`
              + `<button type="button" class="pl-btn" data-view-delete-cancel="${esc(v.id)}">Cancel</button>`
              + `<button type="button" class="pl-btn pl-btn-danger" data-view-delete-confirm="${esc(v.id)}">Delete</button></li>`
            : `<li>${"invalid" in v
              ? `<span class="pl-row pl-view-invalid" data-view-invalid="${esc(v.id)}" aria-disabled="true">${esc(v.name)}<small class="pl-hint">Cannot be opened: ${esc(v.invalid)}</small></span>`
              : `<button type="button" class="pl-row" data-view-open="${esc(v.id)}"${v.id === s.viewId ? ' aria-current="true"' : ""}>${esc(v.name)}</button>`}`
            + `<button type="button" class="pl-icon-btn" data-view-delete="${esc(v.id)}" aria-label="Delete saved view ${esc(v.name)}">×</button></li>`)
          .join("")}</ul>`
      : `<p class="pl-hint">No saved views yet.</p>`;
    // The first tag, "+N" for the others (N14): "Milestone +1 timeline".
    const first = s.config ? s.tags.find((t) => t.ident === s.config!.tags[0]) : undefined;
    const more = s.config && s.config.tags.length > 1 ? ` +${s.config.tags.length - 1}` : "";
    const suggestion = first && s.config ? sanitizeViewName(`${first.title}${more} ${KIND_LABEL[s.config.kind].toLowerCase()}`) : "";
    const save = s.config
      ? `<div class="pl-save"><label for="pl-view-name">Name</label><input id="pl-view-name" class="pl-input" data-field="view-name" value="${esc(suggestion)}" autocomplete="off">`
        + `<button type="button" class="pl-btn pl-btn-primary" data-action="save-view">Save current view</button></div>`
      : "";
    const update = current && "config" in current && s.config
      ? `<div class="pl-update"><button type="button" class="pl-btn" data-action="update-view">Update "${esc(current.name)}"</button></div>`
      : "";
    return rows + update + save;
  };
  return `<header class="pl-top" data-region="topbar"><h1 class="pl-title">Planner</h1>`
    + `<div class="pl-seg" role="group" aria-label="View">${seg}</div><span class="pl-spacer"></span>`
    + renderSurfaceSwitch(s)
    + menu("views", s, "Saved views", current ? esc(current.name) : "None", viewsPopover, "saved-views")
    + `<button type="button" class="pl-btn" data-action="close">Close</button></header>`;
}

const SURFACES: [Surface, string][] = [["workspace", "Workspace"], ["sidebar", "Sidebar"]];

/** Workspace | Sidebar (N06a): where Planner shows; only when the app can dock it (desktop app). */
function renderSurfaceSwitch(s: State): string {
  if (!s.canDock) return "";
  return `<div class="pl-seg" role="group" aria-label="Surface">${SURFACES.map(([k, label]) =>
    `<button type="button" data-surface="${k}" aria-pressed="${k === s.surface}">${label}</button>`).join("")}</div>`;
}

function renderSettings(s: State, view: ViewTags): string {
  const c = s.config!;
  const single = view.tags.length === 1 ? view.tags[0] : null;
  // The Tag menu picks one tag (switches to it); ticking more is done in the tag tree (N14).
  const tagOptions = () => options("Tags", [...s.tags].sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || byTitle(a, b))
    .map((t) => ({ value: t.ident, text: `#${t.title}${t.builtIn ? " (built-in)" : ""}` })), single?.ident ?? "");
  let html = menu("tag", s, "Tag", esc(tagsTitle(view.tags)), tagOptions);

  const selected = new Set(view.tags.map((t) => t.id));
  const children = [...new Set(view.tags.flatMap((t) => t.childIds))].filter((id) => !selected.has(id))
    .map((id) => s.tags.find((t) => t.id === id)).filter((t): t is TagInfo => !!t);
  if (children.length) {
    html += `<span class="pl-check"><input type="checkbox" id="pl-child-tags" data-control="child-tags"${c.childTags ? " checked" : ""}>`
      + `<label for="pl-child-tags">Include ${children.map((t) => `#${esc(t.title)}`).join(", ")}</label></span>`;
  }

  const dateItems = (tag: TagInfo) => tag.dateProps.map((p) => ({ value: p.ident, text: `${p.title} (${p.type === "date" ? "Date" : "DateTime"})` }));
  if (single) {
    const mapped = c.dates[single.ident];
    if (single.dateProps.length) {
      const dateTitle = (ident: string | null) => single.dateProps.find((p) => p.ident === ident)?.title ?? "None";
      html += menu("start", s, "Start", esc(dateTitle(mapped.start)), () => options("Start property", dateItems(single), mapped.start ?? ""));
      html += menu("end", s, "End", esc(dateTitle(mapped.end)), () => options("End property", [{ value: "", text: "None" }, ...dateItems(single)], mapped.end ?? ""));
    } else {
      html += `<span class="pl-hint">No date properties on this tag</span>`;
    }
  } else {
    // N14: Start and End per tag, one row each (`data-dates-tag` + `data-dates-field` on each listbox's wrapper).
    const field = (tag: TagInfo, which: "start" | "end") => {
      const label = which === "start" ? "Start" : "End";
      const items = which === "start" ? dateItems(tag) : [{ value: "", text: "None" }, ...dateItems(tag)];
      return `<div class="pl-dates-field" data-dates-tag="${esc(tag.ident)}" data-dates-field="${which}"><span class="pl-field-label">${label}</span>`
        + options(`${label} property of #${tag.title}`, items, c.dates[tag.ident][which] ?? "") + `</div>`;
    };
    const popover = () => view.tags.map((t) => `<fieldset class="pl-dates-row" data-dates-row="${esc(t.ident)}"><legend>#${esc(t.title)}</legend>`
      + (t.dateProps.length ? field(t, "start") + field(t, "end") : `<p class="pl-hint">No date properties</p>`) + `</fieldset>`).join("");
    html += menu("dates", s, "Dates", `Dates: ${view.tags.length} tags`, popover);
  }

  if (view.nodeProps.length) {
    // N12: the node property whose values are the nodes a node depends on (Timeline connectors; dependents are not tasks).
    const current = dependsOnOf(c, view);
    const title = view.nodeProps.find((p) => p.ident === current)?.title ?? "None";
    const items = [{ value: "", text: "None" }, ...view.nodeProps.map((p) => ({ value: p.ident, text: p.title }))];
    html += menu("depends", s, "Depends on", esc(title), () => options("Depends on property", items, current ?? ""));
  }

  const primary = primaryChoice(view);
  if (primary) {
    const titles = primary.values.filter((v) => doneUuids(c, primary).includes(v.uuid)).map((v) => v.title);
    const popover = () => view.choiceProps.map((p) => {
      const done = doneUuids(c, p);
      return checkList(p.title, p.values.map((v) => ({ attrs: `data-done-prop="${esc(p.ident)}" data-done-value="${esc(v.uuid)}"`, text: v.title, checked: done.includes(v.uuid) })));
    }).join("") + `<p class="pl-hint">${primary.values.some((v) => v.ident !== null) && !c.doneValues[primary.ident] ? "Built-in values use their Done and Canceled flags." : "Saved with the view."}</p>`;
    html += menu("done", s, "Done when", `${esc(primary.title)} is ${esc(titles.join(", ") || "nothing")}`, popover, "done-values");
  }
  return html;
}

/** How many filter values are ticked in the view. */
const tickedFilters = (c: ViewConfig) => Object.values(c.filters).reduce((n, values) => n + values.length, 0);

/** The settings bar's last control (N13): hides and shows the panel; while it is hidden, it counts the ticked filter values. */
function renderPanelToggle(s: State): string {
  const ticked = panelShown(s) || !s.config ? 0 : tickedFilters(s.config);
  const text = ticked ? `Panel · ${ticked}` : "Panel";
  const label = ticked ? ` aria-label="${text} filter${ticked === 1 ? "" : "s"} active"` : "";
  return `<button type="button" class="pl-menu-btn" data-action="toggle-panel" aria-expanded="${panelShown(s)}" aria-controls="pl-panel"${label}>${text}</button>`;
}

/**
 * The tag tree: each tag's button switches the view to that tag alone; the checkbox before it (`data-tag-check`, N14)
 * adds it to the view or removes it, except the last selected tag (disabled). Every selected tag is pressed.
 */
function renderTagTree(s: State, selected: readonly string[]): string {
  const byId = new Map(s.tags.map((t) => [t.id, t]));
  const seen = new Set<number>();
  const item = (t: TagInfo): string => {
    if (seen.has(t.id)) return "";
    seen.add(t.id);
    const kids = t.childIds.map((id) => byId.get(id)).filter((k): k is TagInfo => !!k && k.parentIds[0] === t.id).sort(byTitle);
    const on = selected.includes(t.ident);
    return `<li><span class="pl-tag-line"><input type="checkbox" class="pl-tag-check" data-tag-check="${t.id}" aria-label="Include #${esc(t.title)}"${flag("checked", on)}${flag("disabled", on && selected.length === 1)}>`
      + `<button type="button" class="pl-row" data-tag-id="${t.id}" aria-pressed="${on}"><span class="pl-hash">#</span>${esc(t.title)}</button></span>`
      + (kids.length ? `<ul>${kids.map(item).join("")}</ul>` : "") + `</li>`;
  };
  // A root has no parent in the list; a tag with several parents is listed under its first one.
  const roots = rootsOf(s.tags);
  const list = (key: string, items: TagInfo[], hidden = false) =>
    `<ul class="pl-tree" id="pl-tags-${key}" data-tag-group="${key}"${hidden ? " hidden" : ""}>${items.map(item).join("")}</ul>`;
  const own = roots.filter((t) => !t.builtIn);
  const builtIn = roots.filter((t) => t.builtIn);
  // Built-in tags start collapsed so "Your tags" and the filters fit without scrolling (T07 D6).
  return `<nav aria-label="Tags">`
    + (own.length ? `<h2 class="pl-group-header">Your tags</h2>${list("own", own)}` : "")
    + (builtIn.length ? `<h2 class="pl-group-header"><button type="button" class="pl-disclosure" data-action="toggle-built-in" aria-expanded="${s.builtInOpen}" aria-controls="pl-tags-built-in">Built-in tags</button></h2>${list("built-in", builtIn, !s.builtInOpen)}` : "")
    + `</nav>`;
}

function renderFilters(s: State, view: ViewTags): string {
  const c = s.config!;
  const group = (key: string, legend: string, rows: string) =>
    `<fieldset class="pl-filter" data-filter-group="${esc(key)}"><legend class="pl-group-header">${esc(legend)}</legend>${rows}</fieldset>`;
  const row = (key: string, value: string | null, title: string, count: number) =>
    `<label class="pl-row"><input type="checkbox" data-filter-prop="${esc(key)}" data-filter-value="${esc(value ?? "")}"${(c.filters[key] ?? []).includes(value) ? " checked" : ""}>`
    + `<span class="pl-filter-title">${esc(title)}</span><span class="pl-count">${count}</span></label>`;
  // N14: with two or more tags, a Tag group first (values: the view's tags, stored under `TAG_KEY`).
  const tagGroup = view.tags.length > 1
    ? group(TAG_KEY, "Tag", view.tags.map((t) => row(TAG_KEY, t.ident, `#${t.title}`, s.nodes.filter((n) => n.tag === t.ident).length)).join(""))
    : "";
  return tagGroup + view.choiceProps.map((p) => {
    const count = (id: number | null) => s.nodes.filter((n) => (n.choices[p.ident]?.id ?? null) === id).length;
    return group(p.ident, p.title, p.values.map((v) => row(p.ident, v.uuid, v.title, count(v.id))).join("") + row(p.ident, null, "No value", count(null)));
  }).join("");
}

/** The view area's input from the workspace state: the session state it reads (N06b: shared with the in-page block). */
const areaOf = (s: State, view: ViewTags): ViewAreaInput => ({
  tags: s.tags, config: s.config!, view, nodes: s.nodes, tasks: s.tasks, titles: s.titles,
  session: { anchor: s.anchor, expanded: s.expanded, collapsed: s.collapsed, agendaOpen: s.agendaOpen, agendaGroups: s.agendaGroups,
    agendaOverdue: s.agendaOverdue, kbShown: s.kbShown, pending: s.pending, moveOpen: s.popover === "kb-move" ? s.moveCard : null, popover: s.popover,
    editDates: s.editDates, datePending: s.datePending },
});

/** The main area (loading, an empty state, or the Timeline, Calendar, Agenda or Kanban) and its toolbar. */
function renderView(s: State, view: ViewTags | undefined, now: () => Now): { view: string; toolbar: string } {
  const only = (html: string) => ({ view: html, toolbar: "" });
  if (s.loading) return only(`<div class="pl-empty" data-region="loading"><span>Loading…</span></div>`);
  if (s.loadFailed) return only(`<div class="pl-empty" data-region="load-failed"><button type="button" class="pl-btn" data-action="retry">Retry</button></div>`);
  if (!s.tags.length) return only(empty("no-tags", "No tags in this graph", "Create a tag in Logseq (type #Project on a block, for example) and it shows up here."));
  if (!view || !s.config) return only("");
  return renderViewArea(areaOf(s, view), now);
}

const errorBar = (error: string) =>
  `<div class="pl-error" role="alert" data-region="error"><span>${esc(error)}</span><button type="button" class="pl-btn" data-action="dismiss-error">Dismiss</button></div>`;

function renderWorkspace(s: State, now: () => Now): string {
  const view = s.config ? validateViewConfig(s.config, s.tags) : undefined;
  const error = s.error ? errorBar(s.error) : "";
  const kind = s.config?.kind ?? "";
  const main = renderView(s, view, now);
  return `<div class="pl-ws"${s.canDock ? ` data-surface-mode="${s.surface}"` : ""}>${renderTopBar(s)}${error}`
    + `<div class="pl-settings" data-region="settings" role="group" aria-label="View settings">${view ? renderSettings(s, view) : ""}<span class="pl-spacer"></span>${renderPanelToggle(s)}</div>`
    + `<div class="pl-body${panelShown(s) ? "" : " is-panel-closed"}" data-panel-mode="${s.narrow ? "drawer" : "docked"}"><main class="pl-main" data-region="main"><div class="pl-view-toolbar" data-region="view-toolbar" data-toolbar-kind="${kind}">${main.toolbar}</div>`
    + `<div class="pl-view" data-region="view">${main.view}</div></main>`
    + `<aside class="pl-panel" id="pl-panel" data-region="panel" aria-label="Tags and filters"${panelShown(s) ? "" : " hidden"}>${renderTagTree(s, s.config?.tags ?? [])}${view ? renderFilters(s, view) : ""}</aside></div></div>`;
}

// ---------------------------------------------------------------- controller

/** A selector that finds the same control after a re-render: its tag plus every `data-*` and `id` attribute. */
function selectorOf(el: Element): string {
  const attrs = [...el.attributes].filter((a) => a.name === "id" || a.name.startsWith("data-"));
  return el.tagName.toLowerCase() + attrs.map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join("");
}

export function createWorkspace(root: HTMLElement, deps: WorkspaceDeps): Workspace {
  const s: State = { loading: false, loadFailed: false, tags: [], config: null, nodes: [], tasks: [], titles: new Map(), views: [], viewId: null, viewDeleting: null, popover: null, error: null, builtInOpen: false,
    anchor: null, expanded: new Set(), collapsed: new Set(), weekStart: null, pending: new Map(), moveCard: null,
    agendaOpen: new Set(), agendaGroups: AGENDA_GROUP_PAGE, agendaOverdue: AGENDA_GROUP_PAGE, kbShown: new Map(), panelOpen: { wide: true, narrow: false }, narrow: false,
    canDock: deps.setSurface !== undefined, surface: "workspace", editDates: false, datePending: new Map() };
  /** Today as the injected clock says (the machine's by default); the renders and the refresh signature both use it. */
  const todayNow = () => (deps.today ?? localToday)();
  const timeNow = () => (deps.time ?? localTime)();
  const now = (): Now => {
    if (s.weekStart === null) throw new Error("Week start not read yet: the workspace renders a view only after open()");
    return { today: todayNow(), time: timeNow(), weekStart: s.weekStart };
  };
  /** What of the clock a redraw depends on for `config`: the day, plus the minute in the Day zoom (its now line). */
  const clockOf = (config: ViewConfig | null, today: string) => (showsTime(config) ? `${today} ${timeNow()}` : today);
  let queue: Promise<void> = Promise.resolve();
  /** A live refresh is waiting for a popover to close, a Kanban write to finish or a drag to end. */
  let wantRefresh = false;
  /** The Kanban card being dragged (HTML5 drag events are delegated on the root below). */
  let dragging: string | null = null;
  /** The lane the dragged card started in: lanes by tag (N14) take no drop from another lane. */
  let dragLane: string | null = null;
  /** The Timeline bar or point being dragged to edit its dates (N06c). */
  let tlDrag: TlDrag | null = null;
  /** The click that follows a Timeline drag (or one Escape aborted) is not an open (N06c). */
  let swallowClick = false;
  /** A render was asked for during a drag: it runs when the drag ends. */
  let drawOwed = false;
  /** The clock the workspace was last drawn on (`clockOf`: the Timeline's today line, the Agenda's buckets depend on it). */
  let drawnClock = "";
  /** The day the Timeline's Day zoom last opened its scroll for (N10); null while the Day zoom is not shown. */
  let dayScrolled: string | null = null;
  /** Something the user is in the middle of that a redraw must not disturb. */
  const busy = () => s.popover !== null || s.pending.size > 0 || dragging !== null || s.datePending.size > 0 || tlDrag !== null;

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  /**
   * Draws the workspace and never throws (T14): a render that fails puts its error in the error bar and draws again;
   * when that fails too, a bare shell with the error, Dismiss and Close is drawn, so the user can always leave.
   */
  const render = (focus?: string, keep = false) => {
    if (dragging !== null || tlDrag !== null) {
      drawOwed = true; // never replace the DOM under an active drag (T14, N06c): drawn when it ends
      return;
    }
    try {
      draw(focus, keep);
    } catch (e) {
      s.error = message(e);
      try {
        draw();
      } catch {
        root.innerHTML = `<div class="pl-ws"><header class="pl-top" data-region="topbar"><h1 class="pl-title">Planner</h1><span class="pl-spacer"></span>`
          + `<button type="button" class="pl-btn" data-action="close">Close</button></header>${errorBar(s.error)}</div>`;
      }
    }
  };

  /** `keep`: also carry the scroll of the scrolling regions and the open state of `details` over the redraw (live refresh). */
  const draw = (focus?: string, keep = false) => {
    const doc = root.ownerDocument;
    const active = doc.activeElement && root.contains(doc.activeElement) ? selectorOf(doc.activeElement) : null;
    const scrolls = keep ? SCROLL_REGIONS.map((sel) => root.querySelector<HTMLElement>(sel)).map((el) => el && { top: el.scrollTop, left: el.scrollLeft }) : [];
    const folds = keep ? [...root.querySelectorAll<HTMLDetailsElement>("details")].map((d) => [selectorOf(d), d.open] as const) : [];
    const viewLeft = root.querySelector<HTMLElement>("[data-region=view]")?.scrollLeft ?? 0;
    drawnClock = clockOf(s.config, todayNow());
    root.innerHTML = renderWorkspace(s, now);
    savePrefs();
    for (const [sel, open] of folds) {
      const d = root.querySelector<HTMLDetailsElement>(sel);
      if (d) d.open = open;
    }
    SCROLL_REGIONS.forEach((sel, i) => {
      const el = scrolls[i] && root.querySelector<HTMLElement>(sel);
      if (el) Object.assign(el, { scrollTop: scrolls[i]!.top, scrollLeft: scrolls[i]!.left });
    });
    scrollDay(viewLeft, keep);
    drawTimelineLinks();
    const target = focus ?? active;
    if (target) root.querySelector<HTMLElement>(target)?.focus();
    refreshWhenFree(); // a redraw that was waiting for a popover, a write or a drag
  };

  /**
   * Timeline Day zoom (N10): 96 tracks overflow sideways, so a Day drawn for a new day (zoom switch, Prev / Next / Today,
   * a jump, a new tag after its loading state) opens scrolled to the scroll the view carries (`data-tl-scroll-left`). A
   * redraw of the same day keeps the user's scroll: a live refresh restores it (`keep`), an action's redraw gets `left`.
   */
  const scrollDay = (left: number, keep: boolean) => {
    const tl = root.querySelector<HTMLElement>("[data-timeline][data-tl-start]");
    const view = root.querySelector<HTMLElement>("[data-region=view]");
    if (!tl || !view) return void (dayScrolled = null);
    const day = tl.dataset.tlStart!;
    if (day !== dayScrolled) view.scrollLeft = Number(tl.dataset.tlScrollLeft);
    else if (!keep) view.scrollLeft = left;
    dayScrolled = day;
  };

  /**
   * Timeline connectors (N12): their geometry comes from the drawn bars, so they are measured after every render and on
   * a window resize (`drawLinks` returns at once when the Timeline has none). Scrolling moves the svg with the bars.
   */
  const drawTimelineLinks = () => {
    const tl = root.querySelector<HTMLElement>("[data-timeline]");
    if (tl) drawLinks(tl);
  };
  const win = root.ownerDocument.defaultView;
  win?.addEventListener("resize", drawTimelineLinks);
  /** The frame is its own viewport: its width decides between the docked panel and the drawer (N13). */
  const narrowQuery = win?.matchMedia(NARROW_MEDIA) ?? null;
  s.narrow = narrowQuery?.matches ?? false;
  const onWidth = () => void run(() => void (s.narrow = narrowQuery!.matches));
  narrowQuery?.addEventListener("change", onWidth);

  const tagOf = (config: ViewConfig, tags: TagInfo[] = s.tags) => validateViewConfig(config, tags);

  /**
   * Queues `fn`; an error lands in the visible message, never swallowed. The queue never stays rejected (T14): an error
   * anywhere in the step (the action, the focus target, the render) is shown, and the next queued action still runs.
   */
  const run = (fn: () => Promise<void> | void, focus?: () => string | undefined) => {
    queue = queue.then(fn).catch((e: unknown) => {
      s.error = message(e);
    }).then(() => render(focus?.())).catch((e: unknown) => {
      s.error = message(e);
      render();
    });
    return queue;
  };

  /** The current view's nodes, tasks and titles as the graph has them now (`tags` = the tags to read them with). */
  const readData = (config: ViewConfig, tags: TagInfo[]) => readViewData(deps.dq, config, tags, deps.zone);

  /** Nodes, tasks and titles from rows already read (`tags` maps them; the titles lookup runs here). */
  const fromRaw = (config: ViewConfig, tags: TagInfo[], raw: Awaited<ReturnType<typeof readRaw>>) => viewData(deps.dq, config, tags, raw, deps.zone);

  /** Re-reads the current view's nodes and tasks from the graph, without the loading state (a Kanban move reloads this way). */
  async function fetchData() {
    Object.assign(s, await readData(s.config!, s.tags));
  }

  async function loadData() {
    if (tagOf(s.config!).tags.some((t) => t.builtIn)) s.builtInOpen = true; // every tag change passes here
    s.loading = true;
    render();
    try {
      await fetchData();
    } finally {
      s.loading = false;
    }
    deps.timing?.queried();
  }

  /** Shows the saved view `id` from the listed views (the Saved views menu, and `openView`). */
  const openSaved = async (id: string) => {
    const v = s.views.find((x): x is SavedView => x.id === id && "config" in x);
    if (!v) throw new Error("That saved view is gone or cannot be opened. Pick one under Saved views.");
    const config = withKnownTags(v.config, s.tags); // a gone tag is dropped (N14)
    tagOf(config); // throws before anything changes
    s.popover = null;
    s.config = config;
    s.viewId = v.id;
    await loadData();
  };

  /** Applies a config change that keeps the loaded nodes valid (dates, done values, filters, kind). */
  const setConfig = (next: ViewConfig) => {
    tagOf(next);
    s.config = next;
  };

  const selectTag = async (tag: TagInfo) => {
    s.config = defaultViewConfig(tag, s.config?.kind);
    s.viewId = null;
    s.nodes = [];
    s.tasks = [];
    s.titles = new Map();
    await loadData();
  };

  /** A tag's checkbox in the tag tree (N14): adds the tag to the view or removes it (never the last one), then reloads. */
  const tickTag = async (tag: TagInfo, on: boolean) => {
    const c = s.config!;
    const idents = on ? [...c.tags.filter((i) => i !== tag.ident), tag.ident] : c.tags.filter((i) => i !== tag.ident);
    if (idents.length === 0) return; // the last tag's box is disabled; this guards a change event that arrives anyway
    s.config = withTags(c, idents.map((i) => s.tags.find((t) => t.ident === i)!));
    await loadData();
  };

  /**
   * Per-graph UI state (N21). `prefsLoaded`: this graph's state was read, so changes may be written (never before: the
   * defaults would overwrite it). `storedSurface`: what the store holds, kept where the switch does not exist (web app).
   */
  let prefsLoaded = false;
  let storedSurface: Surface | null = null;
  let savedPrefs = "";
  const currentPrefs = (): UiPrefs => ({
    panel: { ...s.panelOpen },
    surface: s.canDock ? s.surface : storedSurface,
    editDates: s.editDates,
    view: s.config ? { id: s.viewId, config: serializeViewConfig(s.config) } : null,
  });
  /** After every render: writes the state when it differs from what was last written. */
  const savePrefs = () => {
    if (!deps.prefs || !prefsLoaded || s.loading) return;
    const next = currentPrefs();
    const json = JSON.stringify(next);
    if (json === savedPrefs) return;
    savedPrefs = json;
    deps.prefs.save(next);
  };
  /** The graph's stored state onto `s` (tags are loaded): unreadable view settings or a gone tag mean the default view. */
  const restorePrefs = async () => {
    const p = await deps.prefs!.load();
    s.panelOpen = { ...p.panel };
    s.editDates = p.editDates;
    storedSurface = p.surface;
    if (p.surface && s.canDock && p.surface !== s.surface) {
      s.surface = p.surface;
      deps.setSurface!(p.surface);
    }
    if (p.view && !s.config) {
      try {
        const config = withKnownTags(parseViewConfig(p.view.config), s.tags);
        tagOf(config);
        s.config = config;
        s.viewId = p.view.id; // dropped by `listViews` when that saved view is gone
      } catch {
        // the default view
      }
    }
    savedPrefs = JSON.stringify(p);
    prefsLoaded = true;
  };

  const trigger = (p: Popover) =>
    p === "kb-move" ? `[data-kb-move="${s.moveCard}"]` : `[data-control="${p === "views" ? "saved-views" : p === "done" ? "done-values" : p}"]`;
  const firstInPopover = (p: Popover) => `[data-popover="${p}"] ${p === "views" ? "[data-field=view-name]" : p === "done" || p === "kb-show" ? "input" : "[aria-selected=true]"}`;

  async function openBody() {
    s.loading = true;
    s.popover = null;
    render();
    try {
      s.weekStart = await deps.weekStart();
      s.tags = await loadTagInfos(deps.dq);
      s.loadFailed = false;
    } catch (e) {
      s.loadFailed = true; // not "no tags": the error bar says what failed, the main area offers Retry
      throw e;
    } finally {
      s.loading = false;
    }
    if (deps.prefs && !prefsLoaded) await restorePrefs();
    try {
      await listViews();
    } catch (e) {
      s.error = (e as Error).message;
    }
    if (s.config) {
      try {
        s.config = withKnownTags(s.config, s.tags); // a gone tag is dropped from the view (N14)
        tagOf(s.config);
      } catch (e) {
        s.error = `${(e as Error).message}. Showing the default view instead.`;
        s.config = null;
        s.viewId = null;
      }
    }
    if (!s.config) {
      const t = initialTag(s.tags);
      if (!t) return;
      s.config = defaultViewConfig(t);
    }
    await loadData();
  }
  const open = () => {
    deps.timing?.begin("load");
    return run(openBody).then(() => deps.timing?.rendered("redrawn"));
  };

  type Shown = { tags: TagInfo[]; nodes: PlannerNode[]; tasks: PlannerTask[]; titles: ReadonlyMap<string, string> };
  /** What is on screen, as one comparable string: a reload that produces the same signature needs no redraw. */
  const signature = (data: Shown, weekStart: number | null, clock: string) =>
    JSON.stringify([data.tags, data.nodes, data.tasks, [...data.titles], weekStart, clock]);
  /**
   * The signature of what `s` holds, kept while the same objects are shown (T13a: at 2,000 nodes and tasks one signature
   * is about a megabyte of JSON; a refresh then serialises only the new data, not the shown data again).
   */
  let shownSig: { key: unknown[]; sig: string } | null = null;
  const sigKey = (data: Shown, weekStart: number | null, clock: string) => [data.tags, data.nodes, data.tasks, data.titles, weekStart, clock];
  /** The signature of what is on screen: the data in `s` with the clock it was drawn on (`drawnClock`), not the clock now. */
  const shownSignature = () => {
    const key = sigKey(s, s.weekStart, drawnClock);
    if (!shownSig || key.some((k, i) => k !== shownSig!.key[i])) shownSig = { key, sig: signature(s, s.weekStart, drawnClock) };
    return shownSig.sig;
  };

  /** One live refresh, on the queue. Applies nothing when the user got busy while it loaded: it is asked again later. */
  async function reload() {
    if (busy()) {
      wantRefresh = true;
      return void deps.timing?.rendered("deferred");
    }
    if (!s.config) {
      await openBody(); // nothing shown yet (no tags before): the first load
      render();
      return void deps.timing?.rendered("redrawn");
    }
    // One batch (T13a): the view's rows are read with the tags on screen while the week start and the tags are re-read,
    // instead of after them (the host's worker runs queries one at a time, so waiting added the tag queries' time).
    const shownView = tagOf(s.config);
    const [weekStart, tags, shownRaw] = await Promise.all([deps.weekStart(), loadTagInfos(deps.dq), readRaw(deps.dq, s.tags, shownView.tags, dependsOnOf(s.config, shownView))]);
    let config: ViewConfig | null = s.config;
    let error: string | null = null;
    /** The view was replaced by the default one (its tag or a property it uses is gone). */
    let replaced = false;
    try {
      // A gone tag is dropped from the view (N14); a field left unmapped (no date or choice property when it was set up)
      // takes the default once the tag has one (T14).
      const known = withKnownTags(config, tags);
      config = withDefaults(known, validateViewConfig(known, tags));
    } catch (e) {
      // The tag or a property the view uses is gone from the graph: show the default view, like open() does.
      error = `${(e as Error).message}. Showing the default view instead.`;
      const t = initialTag(tags);
      config = t ? defaultViewConfig(t) : null;
      replaced = true;
    }
    // Same view: the rows are mapped with the new tags (new closed values and tags apply at once); a query is asked again
    // only when its rows are stale (`readRaw`: the pulled idents or the tag id changed). Another view: read afresh.
    const data = !config ? { nodes: [], tasks: [], titles: new Map<string, string>() }
      : !replaced ? await fromRaw(config, tags, await readRaw(deps.dq, tags, tagOf(config, tags).tags, dependsOnOf(config, tagOf(config, tags)), shownRaw))
      : await readData(config, tags);
    deps.timing?.queried();
    if (busy()) {
      wantRefresh = true; // a popover, a write or a drag started while loading: drop the result
      return void deps.timing?.rendered("deferred");
    }
    const clock = clockOf(config, todayNow());
    const next = { tags, ...data };
    const sig = signature(next, weekStart, clock);
    const same = config === s.config && sig === shownSignature();
    if (same) return void deps.timing?.rendered("same");
    if (replaced) {
      s.viewId = null;
      s.error = error;
    }
    s.config = config;
    Object.assign(s, { weekStart, ...next });
    shownSig = { key: sigKey(s, weekStart, clock), sig };
    render(undefined, true);
    deps.timing?.rendered("redrawn");
  }

  function refresh(): Promise<void> {
    wantRefresh = false;
    deps.timing?.begin("refresh");
    queue = queue.then(reload).catch((e: unknown) => {
      s.error = message(e);
      render(undefined, true);
      deps.timing?.rendered("error");
    });
    return queue;
  }
  const reset = () => run(() => {
    Object.assign(s, { loading: false, loadFailed: false, tags: [], config: null, nodes: [], tasks: [], titles: new Map(), views: [], viewId: null, viewDeleting: null,
      popover: null, error: null, builtInOpen: false, anchor: null, expanded: new Set(), collapsed: new Set(), weekStart: null, pending: new Map(),
      moveCard: null, agendaOpen: new Set(), agendaGroups: AGENDA_GROUP_PAGE, agendaOverdue: AGENDA_GROUP_PAGE, kbShown: new Map(), datePending: new Map() });
    wantRefresh = false;
    shownSig = null;
    dayScrolled = null;
    prefsLoaded = false; // the next open reads the new graph's state (N21)
    deps.views.invalidate();
  });
  const refreshWhenFree = () => void (wantRefresh && !busy() && refresh());

  root.addEventListener("click", (e) => {
    if (swallowClick) {
      swallowClick = false; // the end of a Timeline drag, not an open (N06c)
      return;
    }
    const t = e.target as HTMLElement;
    // A click outside the open popover's anchor closes it, and a click on the view beside or under the open drawer closes
    // the drawer (N13; the bars above stay usable with it open); either click still does what it was meant to do.
    const outsidePopover = s.popover !== null && !t.closest(".pl-anchor");
    const outsideDrawer = drawerOpen(s) && !!t.closest("[data-region=main]");
    if (outsidePopover) s.popover = null;
    if (outsideDrawer) s.panelOpen.narrow = false;
    if (outsidePopover || outsideDrawer) {
      void run(() => {}); // drawn closed even when the click's own action draws nothing (opening a node)
      if (!t.closest("button, input, label")) return;
    }
    const tl = timelineAction(t);
    if (tl) return void timeline(tl, (e as MouseEvent).shiftKey);
    const cal = calendarAction(t);
    if (cal) return void calendar(cal, (e as MouseEvent).shiftKey);
    const ag = agendaAction(t);
    if (ag) return void agenda(ag, (e as MouseEvent).shiftKey);
    const kb = kanbanAction(t);
    if (kb) return void kanban(kb, (e as MouseEvent).shiftKey);
    const ctl = t.closest<HTMLElement>("[data-control]");
    if (ctl && ctl.tagName === "BUTTON") {
      const p = ({ tag: "tag", start: "start", end: "end", dates: "dates", depends: "depends", "done-values": "done", "saved-views": "views", "kb-column": "kb-column", "kb-show": "kb-show", "kb-lane": "kb-lane" } as const)[ctl.dataset.control as string];
      if (p) {
        s.popover = s.popover === p ? null : p;
        s.viewDeleting = null;
        return void run(() => {}, () => (s.popover ? firstInPopover(s.popover) : trigger(p)));
      }
    }
    const opt = t.closest<HTMLElement>("[data-popover] [data-option]");
    if (opt && s.popover === "dates") {
      // N14: one tag's Start or End; the popover stays open for the other rows, focus on the option picked.
      const box = opt.closest<HTMLElement>("[data-dates-field]")!;
      const ident = box.dataset.datesTag!;
      const which = box.dataset.datesField as "start" | "end";
      const c = s.config!;
      const at = `[data-dates-tag="${CSS.escape(ident)}"][data-dates-field="${which}"] [data-option="${CSS.escape(opt.dataset.option!)}"]`;
      return void run(() => setConfig({ ...c, dates: { ...c.dates, [ident]: { ...c.dates[ident], [which]: opt.dataset.option || null } } }), () => at);
    }
    if (opt && s.popover) {
      const p = s.popover;
      const value = opt.dataset.option!;
      s.popover = null;
      if (p === "tag") return void run(() => selectTag(s.tags.find((x) => x.ident === value)!), () => trigger("tag"));
      if (p === "start" || p === "end") {
        // One tag: its only Start / End mapping.
        const c = s.config!;
        const ident = c.tags[0];
        return void run(() => setConfig({ ...c, dates: { ...c.dates, [ident]: { ...c.dates[ident], [p]: value || null } } }), () => trigger(p));
      }
      // The dependency property is pulled with the nodes and tasks (N12), so a new one reads them again.
      if (p === "depends") {
        return void run(async () => {
          setConfig({ ...s.config!, dependsOn: value || null });
          await loadData();
        }, () => trigger("depends"));
      }
      const c = s.config!;
      if (c.kind === "kanban" && p === "kb-column") return void run(() => setConfig({ ...c, columnProp: value, laneProp: c.laneProp === value ? null : c.laneProp }), () => trigger(p));
      if (c.kind === "kanban" && p === "kb-lane") return void run(() => setConfig({ ...c, laneProp: value || null }), () => trigger(p));
    }
    const el = t.closest<HTMLElement>("[data-tag-id], [data-view-kind], [data-view-open], [data-view-delete], [data-view-delete-cancel], [data-view-delete-confirm], [data-surface], [data-action]");
    if (!el) return;
    const d = el.dataset;
    if (d.tagId) return void run(() => selectTag(s.tags.find((x) => x.id === Number(d.tagId))!));
    if (d.viewKind) return void run(() => setConfig(switchKind(s.config!, tagOf(s.config!), d.viewKind as ViewKind)));
    if (d.viewOpen) return void run(() => openSaved(d.viewOpen!), () => trigger("views"));
    if (d.surface) {
      const next = d.surface as Surface;
      if (next === s.surface) return;
      s.surface = next;
      render(`[data-surface="${next}"]`);
      return deps.setSurface!(next);
    }
    // Deleting asks first (N23): × turns the row into the question, Cancel has the focus.
    if (d.viewDelete) return void run(() => void (s.viewDeleting = d.viewDelete!), () => "[data-view-delete-cancel]");
    if (d.viewDeleteCancel) return void run(() => void (s.viewDeleting = null), () => `[data-view-delete="${d.viewDeleteCancel}"]`);
    if (d.viewDeleteConfirm) {
      s.viewDeleting = null;
      return void run(() => viewsWrite(() => deps.views.remove(d.viewDeleteConfirm!)), () => "[data-field=view-name]");
    }
    switch (d.action) {
      case "close":
        s.popover = null;
        render();
        return deps.onClose();
      case "toggle-panel":
        return void run(() => void (s.panelOpen[s.narrow ? "narrow" : "wide"] = !panelShown(s)), () => "[data-action=toggle-panel]");
      case "toggle-built-in":
        return void run(() => void (s.builtInOpen = !s.builtInOpen));
      case "retry":
        return void run(async () => {
          s.error = null;
          await openBody();
        });
      case "dismiss-error":
        return void run(() => void (s.error = null));
      case "clear-filters":
        return void run(() => setConfig({ ...s.config!, filters: {} }));
      case "save-view":
        return void save();
      case "update-view":
        return void run(() => viewsWrite(async () => {
          await deps.views.update(s.viewId!, s.config!);
          s.popover = null;
        }), () => trigger("views"));
    }
  });

  /** Timeline controls: zoom is view config (saved with a view); the anchor and expanded rows are session state. */
  function timeline(a: NonNullable<ReturnType<typeof timelineAction>>, shift: boolean) {
    const c = s.config!;
    if (c.kind !== "timeline") throw new Error(`Timeline control in a ${c.kind} view`);
    switch (a.type) {
      case "open":
        return deps.openNode(a.uuid, { sidebar: shift });
      case "zoom":
        return void run(() => setConfig({ ...c, zoom: a.zoom }));
      case "arrange":
        return void run(() => setConfig({ ...c, arrange: a.arrange }));
      case "nav":
        return void run(() => void (s.anchor = shiftAnchor(s.anchor ?? now().today, c.zoom, a.dir)));
      case "today":
        return void run(() => void (s.anchor = null));
      case "toggle": {
        const set = a.nested ? s.collapsed : s.expanded; // a nested parent starts open: its set holds the collapsed ones
        return void run(() => void (set.has(a.nodeId) ? set.delete(a.nodeId) : set.add(a.nodeId)));
      }
      case "jump":
        return void run(() => void (s.anchor = a.day));
      case "edit":
        return void run(() => void (s.editDates = !s.editDates), () => "[data-tl-edit]");
    }
  }

  // ---------------------------------------------------------------- Timeline date edits (N06c)

  /** The Timeline layout on screen now (the view is a Timeline). */
  const timelineNow = (): TimelineLayout => timelineLayoutOf(areaOf(s, tagOf(s.config!)), now());
  /** The row of the bar or point `el` in `layout`, when it is editable now. */
  const editableRow = (layout: TimelineLayout, el: HTMLElement): TimelineRow | null =>
    shownRows(layout.rows).find((r) => r.node.uuid === el.dataset.tlOpen && r.edit !== null) ?? null;
  /** The selector of a row's bar or point after a redraw. */
  const spanSelector = (row: TimelineRow) => `${row.point === null ? "[data-tl-bar]" : "[data-tl-point]"}[data-tl-open="${CSS.escape(row.node.uuid)}"]`;

  /**
   * Edits `row`'s dates by `delta` tracks (`mode`: move, start, end). Optimistic like a Kanban move: the bar shows at
   * its new place at once, flagged pending (no handles); then the writes run (`writeDates`, each read back). Success or
   * not, the view is reloaded from the graph, so a failed write puts the bar back where the graph has it and the error
   * shows in the error bar.
   */
  function editDates(row: TimelineRow, mode: EditMode, delta: number, perDay: 1 | 96, focus?: string) {
    const changes = dateChanges(row.edit!, row, mode, delta, perDay);
    if (!changes.length) return void render(focus);
    const uuid = row.node.uuid;
    s.datePending.set(uuid, changes);
    render(focus);
    return run(async () => {
      let failure: unknown = null;
      try {
        await writeDates(deps.dates, { uuid, title: row.title }, changes, deps.zone ?? systemZone);
      } catch (e) {
        failure = e;
      }
      s.datePending.delete(uuid);
      await fetchData();
      if (failure) throw failure;
    }, () => focus);
  }

  /** A drag is over without a write: the bar goes back to where it was drawn; a render it held up runs. */
  const endTlDrag = (g: TlDrag) => {
    tlDrag = null;
    g.el.setAttribute("style", g.style);
    g.el.removeAttribute("data-tl-dragging");
    if (drawOwed) {
      drawOwed = false;
      render();
    }
    refreshWhenFree();
  };

  root.addEventListener("pointerdown", (e) => {
    swallowClick = false; // a click that did not follow its drag is not swallowed later
    if (!s.editDates || tlDrag || e.button !== 0) return;
    const t = e.target as Element;
    const el = t.closest?.<HTMLElement>("[data-tl-editable]");
    if (!el) return;
    const side = t.closest<HTMLElement>("[data-tl-handle]")?.dataset.tlHandle as "start" | "end" | undefined;
    const mode: EditMode = side ?? "move";
    if (mode === "move" && !el.hasAttribute("data-tl-move")) return; // resize only: the body is a plain click
    const layout = timelineNow();
    const row = editableRow(layout, el);
    if (!row) return;
    tlDrag = { el, pointerId: e.pointerId, x: e.clientX, mode, row, range: layout.range, px: TRACK_PX[layout.zoom], style: el.getAttribute("style") ?? "", delta: 0, moved: false };
    el.setPointerCapture(e.pointerId); // moves and the release keep coming to the bar when the pointer leaves it
  });
  root.addEventListener("pointermove", (e) => {
    const g = tlDrag;
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.x;
    if (!g.moved && Math.abs(dx) < CLICK_PX) return;
    if (!g.moved) g.el.setAttribute("data-tl-dragging", "");
    g.moved = true;
    const delta = clampDelta(g.range, g.row, g.mode, Math.round(dx / g.px));
    if (delta === g.delta) return;
    g.delta = delta;
    const bar = editedBar(g.range, g.row, dateChanges(g.row.edit!, g.row, g.mode, delta, perDayOf(g.range)));
    g.el.setAttribute("style", `grid-column: ${g.row.point === null ? `${bar.from + 2} / ${bar.to + 2}` : bar.from + 2}`);
  });
  root.addEventListener("pointerup", (e) => {
    const g = tlDrag;
    if (!g || e.pointerId !== g.pointerId) return;
    if (!g.moved) return void endTlDrag(g); // a click: it opens the node
    swallowClick = true;
    if (g.delta === 0) return void endTlDrag(g);
    tlDrag = null;
    g.el.removeAttribute("data-tl-dragging");
    drawOwed = false; // the edit draws now
    void editDates(g.row, g.mode, g.delta, perDayOf(g.range));
  });
  root.addEventListener("pointercancel", (e) => {
    if (tlDrag && e.pointerId === tlDrag.pointerId) endTlDrag(tlDrag);
  });

  /** Calendar controls: the layout is view config (saved with a view); the anchor is session state. */
  function calendar(a: NonNullable<ReturnType<typeof calendarAction>>, shift: boolean) {
    const c = s.config!;
    if (c.kind !== "calendar") throw new Error(`Calendar control in a ${c.kind} view`);
    switch (a.type) {
      case "open":
        return deps.openNode(a.uuid, { sidebar: shift });
      case "layout":
        return void run(() => setConfig({ ...c, layout: a.layout }));
      case "nav":
        return void run(() => void (s.anchor = shiftCalendarAnchor(s.anchor ?? now().today, c.layout, a.dir)));
      case "today":
        return void run(() => void (s.anchor = null));
      case "more":
        // "+N more" opens the Week layout on that day's week; the button is gone after the render, so focus the Week switch.
        return void run(() => {
          setConfig({ ...c, layout: "week" });
          s.anchor = a.day;
        }, () => "[data-cal-layout=week]");
    }
  }

  /** Agenda controls: Group by and Show done are view config (saved with a view). */
  function agenda(a: NonNullable<ReturnType<typeof agendaAction>>, shift: boolean) {
    const c = s.config!;
    if (c.kind !== "agenda") throw new Error(`Agenda control in a ${c.kind} view`);
    switch (a.type) {
      case "open":
        return deps.openNode(a.uuid, { sidebar: shift });
      case "group":
        return void run(() => setConfig({ ...c, groupBy: a.groupBy }));
      case "showDone":
        return void run(() => setConfig({ ...c, showDone: !c.showDone }));
      case "more":
        return void run(() => void (a.overdue ? (s.agendaOverdue += AGENDA_GROUP_PAGE) : (s.agendaGroups += AGENDA_GROUP_PAGE)));
    }
  }

  /** Kanban controls: column, shown columns, lane and sort are view config (saved with a view); moves are written to the graph. */
  function kanban(a: NonNullable<ReturnType<typeof kanbanAction>>, shift: boolean) {
    const c = s.config!;
    if (c.kind !== "kanban") throw new Error(`Kanban control in a ${c.kind} view`);
    switch (a.type) {
      case "open":
        return deps.openNode(a.uuid, { sidebar: shift });
      case "sort":
        return void run(() => setConfig({ ...c, sort: a.sort }));
      case "more":
        return void run(() => void s.kbShown.set(a.cell, (s.kbShown.get(a.cell) ?? KANBAN_CELL_PAGE) + KANBAN_CELL_PAGE));
      case "moveMenu": {
        const open = s.popover === "kb-move" && s.moveCard === a.uuid;
        s.popover = open ? null : "kb-move";
        s.moveCard = a.uuid;
        return void run(() => {}, () => (open ? trigger("kb-move") : `[data-popover="kb-move"] [aria-selected=true]`));
      }
      case "moveTo": {
        const { cell } = cardCell(board(), a.uuid);
        s.popover = null;
        return void move(a.uuid, a.column ?? cell.column.key, a.column === null ? a.lane : cell.lane?.key ?? null, `[data-kb-move="${a.uuid}"]`);
      }
    }
  }

  /** The Kanban layout on screen now. */
  const board = (): KanbanLayout => {
    return kanbanLayout(areaOf(s, tagOf(s.config!)), now());
  };

  /**
   * Moves a card to the cell at `column` / `lane` (drag and drop and the Move menu both end here). Optimistic: the card
   * shows in the target at once, flagged pending (not draggable); then the writes run, each read back. Success or not,
   * the board is reloaded from the graph, so a failed write puts the card back where the graph has it and the error
   * shows in the error bar.
   */
  function move(uuid: string, column: string, lane: string | null, focus?: string) {
    const layout = board();
    const { card, cell } = cardCell(layout, uuid);
    if (card.pending) return;
    const writes = moveDescriptor(card, cell, moveTarget(layout, column, lane));
    if (!writes.length) return void render(focus);
    s.pending.set(uuid, writes);
    render(focus);
    return run(async () => {
      let failure: unknown = null;
      try {
        await writeMove(deps.kanban, writes);
      } catch (e) {
        failure = e;
      }
      s.pending.delete(uuid);
      await fetchData();
      if (failure) throw failure;
    }, () => focus);
  }

  /** Drag and drop between Kanban cells (HTML5). The dragged card is remembered in `dragging`; the DOM is not re-rendered until the drop. */
  const clearMarks = (attr: string) => root.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  root.addEventListener("dragstart", (e) => {
    const cardEl = (e.target as Element).closest?.<HTMLElement>("[data-kb-card]");
    if (!cardEl) return;
    if (cardEl.hasAttribute("data-kb-pending")) return void e.preventDefault();
    dragging = cardEl.dataset.kbCard!;
    dragLane = cardEl.closest<HTMLElement>("[data-kb-cell]")?.dataset.kbLane ?? null;
    cardEl.setAttribute("data-kb-dragging", "");
    const dt = (e as DragEvent).dataTransfer;
    if (dt) {
      dt.setData("text/plain", dragging); // Firefox starts a drag only with data set
      dt.effectAllowed = "move";
    }
  });
  root.addEventListener("dragover", (e) => {
    const cellEl = (e.target as Element).closest?.<HTMLElement>("[data-kb-cell]");
    if (!cellEl || !dragging) return;
    if (cellEl.closest("[data-kb-lanes-readonly]") && (cellEl.dataset.kbLane ?? null) !== dragLane) return; // Tag lanes: no drop across
    e.preventDefault(); // accept the drop
    const dt = (e as DragEvent).dataTransfer;
    if (dt) dt.dropEffect = "move";
    if (!cellEl.hasAttribute("data-kb-over")) {
      clearMarks("data-kb-over");
      cellEl.setAttribute("data-kb-over", "");
    }
  });
  root.addEventListener("dragleave", (e) => {
    const cellEl = (e.target as Element).closest?.<HTMLElement>("[data-kb-cell]");
    if (cellEl && !cellEl.contains((e as DragEvent).relatedTarget as Node | null)) cellEl.removeAttribute("data-kb-over");
  });
  root.addEventListener("drop", (e) => {
    const cellEl = (e.target as Element).closest?.<HTMLElement>("[data-kb-cell]");
    if (!cellEl || !dragging) return;
    if (cellEl.closest("[data-kb-lanes-readonly]") && (cellEl.dataset.kbLane ?? null) !== dragLane) return; // refused, as in dragover
    e.preventDefault();
    const uuid = dragging;
    dragging = null;
    void move(uuid, cellEl.dataset.kbCol!, cellEl.dataset.kbLane ?? null);
  });
  /**
   * A drag ends wherever it ends (T14): `dragend` or a `drop` anywhere in the document clears it, so it cannot stay
   * stuck (a stuck drag defers every redraw). Bubble phase, so a drop on a cell (above) has started its move first.
   */
  const endDrag = () => {
    if (dragging === null && !drawOwed) return;
    dragging = null;
    clearMarks("data-kb-dragging");
    clearMarks("data-kb-over");
    if (drawOwed) {
      drawOwed = false;
      render();
    }
    refreshWhenFree();
  };
  root.ownerDocument.addEventListener("dragend", endDrag);
  root.ownerDocument.addEventListener("drop", endDrag);

  const save = () => {
    const name = root.querySelector<HTMLInputElement>("[data-field=view-name]")!.value;
    return run(() => viewsWrite(async () => {
      s.viewId = (await deps.views.create(name, s.config!)).id;
      s.popover = null;
    }), () => trigger("views"));
  };

  /**
   * A saved-views write, then the list re-read from the store whether it worked or not: a failed write can drop
   * views from the store (their page went to Recycle, T07 D5), and the list must not keep showing them.
   * The write's error is the one shown.
   */
  /** The saved views as the graph has them now (the store's cache dropped first); a view that is gone is no longer current. */
  async function listViews() {
    deps.views.invalidate();
    s.views = await deps.views.list();
    if (!s.views.some((v) => v.id === s.viewId)) s.viewId = null;
  }

  async function viewsWrite(write: () => Promise<void>) {
    try {
      await write();
    } finally {
      s.views = await deps.views.list().catch(() => s.views);
      if (!s.views.some((v) => v.id === s.viewId)) s.viewId = null;
    }
  }

  /**
   * An Agenda bucket folded or unfolded, by its summary or any other way (`toggle` does not bubble, hence capture):
   * an opened bucket is redrawn with its entries; a folded one drops them on the next render.
   */
  root.addEventListener("toggle", (e) => {
    const d = e.target as HTMLDetailsElement;
    const key = d.dataset?.agBucket;
    if (key === undefined || d.open === s.agendaOpen.has(key)) return;
    if (!d.open) return void s.agendaOpen.delete(key);
    s.agendaOpen.add(key);
    void run(() => {});
  }, true);

  root.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    // N06c: Alt+Left / Right moves a focused bar or point one track; with Shift its End changes (its Start when only
    // that end can change). Handled (prevented) on any bar or point while Edit dates is on, so the host never gets them.
    const span = s.editDates && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") ? t.closest<HTMLElement>("[data-tl-bar], [data-tl-point]") : null;
    if (span) {
      e.preventDefault();
      if (tlDrag) return;
      const layout = timelineNow();
      const row = editableRow(layout, span);
      if (!row) return;
      const edit = row.edit!;
      const mode: EditMode | null = !e.shiftKey ? (edit.move ? "move" : null) : edit.resizeEnd ? "end" : edit.resizeStart ? "start" : null;
      if (mode === null) return;
      const delta = clampDelta(layout.range, row, mode, e.key === "ArrowLeft" ? -1 : 1);
      if (delta !== 0) void editDates(row, mode, delta, perDayOf(layout.range), spanSelector(row));
      return;
    }
    if (e.key === "Enter" && t.dataset.field === "view-name") {
      e.preventDefault();
      void save();
    }
    // Arrow keys move between the options of an open listbox.
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && t.closest("[role=listbox]")) {
      e.preventDefault();
      const items = [...t.closest("[role=listbox]")!.querySelectorAll<HTMLElement>("[role=option]")];
      const i = items.indexOf(t);
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      return;
    }
    // The other popovers (saved views, Done when, Kanban Show; N29): Up / Down walk their buttons and fields in order and
    // wrap. A saved view's × is skipped (Tab reaches it); from a ×, Down goes on to the next row and Up to its own row.
    const pop = e.key === "ArrowDown" || e.key === "ArrowUp" ? t.closest("[data-popover]") : null;
    if (pop) {
      const all = [...pop.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
      const items = all.filter((el) => !el.hasAttribute("data-view-delete"));
      if (!items.length) return;
      e.preventDefault();
      const down = e.key === "ArrowDown";
      const at = all.indexOf(t);
      const i = items.indexOf(t);
      const next = i >= 0
        ? items[(i + (down ? 1 : items.length - 1)) % items.length]
        : down ? items.find((el) => all.indexOf(el) > at) ?? items[0] : [...items].reverse().find((el) => all.indexOf(el) < at) ?? items[items.length - 1];
      next.focus();
    }
  });

  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    const d = t.dataset;
    if (d.tagCheck) return void run(() => tickTag(s.tags.find((x) => x.id === Number(d.tagCheck))!, t.checked));
    if (d.control === "child-tags") {
      return void run(async () => {
        s.config = { ...s.config!, childTags: t.checked };
        await loadData();
      });
    }
    if (d.filterProp) {
      const value = d.filterValue || null;
      return void run(() => {
        const filters = { ...s.config!.filters };
        const next = toggle(filters[d.filterProp!] ?? [], value);
        if (next.length) filters[d.filterProp!] = next;
        else delete filters[d.filterProp!];
        setConfig({ ...s.config!, filters });
      });
    }
    if (d.doneProp) {
      return void run(() => {
        const prop = tagOf(s.config!).choiceProps.find((p) => p.ident === d.doneProp)!;
        setConfig({ ...s.config!, doneValues: { ...s.config!.doneValues, [prop.ident]: toggle(doneUuids(s.config!, prop), d.doneValue!) } });
      });
    }
    if (d.kbShowValue !== undefined) {
      return void run(() => {
        const c = s.config!;
        if (c.kind !== "kanban" || c.columnProp === null) throw new Error(`Kanban Show control in a ${c.kind} view`);
        const layout = board();
        const shown = layout.columns.map((x) => x.key);
        // At least one column stays shown (its box is disabled; this guards a change event that arrives anyway).
        if (shown.length === 1 && shown[0] === d.kbShowValue) return;
        const next = toggle(shown, d.kbShowValue!);
        // The columns not shown now, in the property's order; keys of values that are gone stay as they were.
        const keys = layout.allColumns.map((x) => x.key);
        const stale = (c.hiddenColumns[c.columnProp] ?? []).filter((k) => !keys.includes(k));
        setConfig({ ...c, hiddenColumns: { ...c.hiddenColumns, [c.columnProp]: [...stale, ...keys.filter((k) => !next.includes(k))] } });
      });
    }
  });

  render();
  return {
    open,
    escape() {
      if (tlDrag) {
        swallowClick = true; // the release that follows opens nothing
        endTlDrag(tlDrag);
        return true;
      }
      if (s.popover) {
        const p = s.popover;
        s.popover = null;
        render(trigger(p));
        return true;
      }
      if (!drawerOpen(s)) return false;
      s.panelOpen.narrow = false;
      render("[data-action=toggle-panel]");
      return true;
    },
    refresh,
    reset,
    showViews: () => run(listViews),
    openView: (id) => run(async () => {
      if (s.surface === "sidebar") deps.setSurface?.("workspace"); // a restored sidebar mode (N21): the app follows
      s.surface = "workspace";
      await listViews();
      await openSaved(id);
    }),
    idle: () => queue,
    config: () => s.config,
    stop() {
      win?.removeEventListener("resize", drawTimelineLinks);
      narrowQuery?.removeEventListener("change", onWidth);
      root.ownerDocument.removeEventListener("dragend", endDrag);
      root.ownerDocument.removeEventListener("drop", endDrag);
    },
  };
}
