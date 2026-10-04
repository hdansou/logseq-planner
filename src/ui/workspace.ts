// The full-screen workspace shell: top bar (view switch, saved views, Close), settings bar (tag, child tags,
// Start, End, done values), tag tree and choice filters, a per-view toolbar slot and the main area.
// Renders the whole shell from `State` on every change (small pure render functions returning HTML) and
// handles every event by delegation on the root. No SDK: graph access arrives as `WorkspaceDeps`.
// The Timeline (T08), the Calendar (T09), the Agenda (T10) and the Kanban (T11) render into the view area and the toolbar slot.
// Kanban moves are written through the injected `kanban` deps; drag events are delegated on the root like clicks.
import { buildData, loadTitles, readRaw, type RawData } from "../core/queries";
import { filterNodes, isDone } from "../core/nodes";
import type { ZoneOffset } from "../core/normalize";
import type { Dq } from "../core/schema";
import { loadTagInfos } from "../core/schema";
import { defaultViewConfig, dependsOnOf, toChoiceFilters, validateViewConfig, VIEW_KINDS, withDefaults, type ViewConfig, type ViewKind } from "../core/view-config";
import { refUuids, titlesByUuid } from "../core/display-title";
import { viewItems } from "../core/layout-common";
import { layoutTimeline, shiftAnchor, type TimelineLayout } from "../core/timeline-layout";
import { layoutCalendar, shiftCalendarAnchor, type CalendarLayout } from "../core/calendar-layout";
import { layoutAgenda, type AgendaLayout } from "../core/agenda";
import { cardCell, layoutKanban, moveDescriptor, movedNode, moveTarget, priorityProp, writeMove, type KanbanLayout, type PropertyWrite } from "../core/kanban";
import { sanitizeViewName, type ListedView, type SavedView, type ViewStore } from "../storage";
import type { ChoiceProp, ClosedValue, KanbanWriteDeps, PlannerNode, PlannerTask, TagInfo } from "../types";
import { checkList, esc, menu as menuHtml, options } from "./html";
import { calendarAction, renderCalendar, renderCalendarToolbar } from "./calendar";
import { AGENDA_GROUP_PAGE, agendaAction, renderAgenda, renderAgendaToolbar } from "./agenda";
import { KANBAN_CELL_PAGE, kanbanAction, renderKanban, renderKanbanToolbar } from "./kanban";
import { drawLinks, renderTimeline, renderTimelineToolbar, timelineAction } from "./timeline";

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
  /** Dev-only load / refresh timings; omitted in production. */
  timing?: Timing;
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
  /** Closes an open popover and returns true; false when there is nothing to close (the app then closes Planner). */
  escape(): boolean;
  /** Resolves when every queued action has finished (tests, focus after open). */
  idle(): Promise<void>;
  /** The current view config (null until a tag exists). */
  config(): ViewConfig | null;
  /** Removes the listeners the workspace put outside its root (the window resize that redraws the Timeline connectors); call on unload. */
  stop(): void;
}

type Popover = "tag" | "start" | "end" | "depends" | "done" | "views" | "kb-column" | "kb-show" | "kb-lane" | "kb-move";

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
  popover: Popover | null;
  error: string | null;
  /** The built-in tags group of the tag tree is open (collapsed by default; opened when a built-in tag is selected). */
  builtInOpen: boolean;
  /** Timeline / Calendar anchor day (shared, so switching kinds keeps the period); null = today. Session state: never saved with a view. */
  anchor: string | null;
  /** Node ids whose task rows are expanded (Timeline). Session state. */
  expanded: Set<number>;
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
}

/** What the clock and the host week start say right now: injected so renders stay pure; asked only when a view needs it. */
interface Now {
  today: string;
  /** `HH:MM`. */
  time: string;
  weekStart: number;
}

const KIND_LABEL: Record<ViewKind, string> = { timeline: "Timeline", calendar: "Calendar", agenda: "Agenda", kanban: "Kanban" };
/** The elements that scroll inside the workspace: the view area (both axes: the Kanban board and the Timeline scroll sideways) and the sidebar. */
const SCROLL_REGIONS = ["[data-region=view]", "[data-region=sidebar]"];
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

/** The loaded nodes with the pending Kanban moves applied: where their cards show while the writes run. */
const shownNodes = (s: State): PlannerNode[] =>
  s.pending.size ? s.nodes.map((n) => (s.pending.has(n.uuid) ? movedNode(n, s.pending.get(n.uuid)!) : n)) : s.nodes;

/** The nodes that pass the view's filters and the tasks linked to them: what a view is handed (T07 D4). */
export function visibleData(config: ViewConfig, tag: TagInfo, nodes: PlannerNode[], tasks: PlannerTask[]) {
  const shown = filterNodes(nodes, toChoiceFilters(config, tag));
  const ids = new Set(shown.map((n) => n.id));
  return { nodes: shown, tasks: tasks.filter((t) => t.nodeIds.some((id) => ids.has(id))) };
}

/** Keeps the shared fields (tag, dates, filters, done values, dependency property) and takes the new kind's defaults for the rest. */
export function switchKind(config: ViewConfig, tag: TagInfo, kind: ViewKind): ViewConfig {
  const { tag: t, childTags, start, end, doneValues, filters } = config;
  return { ...defaultViewConfig(tag, kind), tag: t, childTags, start, end, doneValues, filters, dependsOn: dependsOnOf(config, tag) };
}

/** The choice property the done-values control is labelled with: Status, else the first one. */
const primaryChoice = (tag: TagInfo): ChoiceProp | undefined => tag.choiceProps.find((p) => p.title === "Status") ?? tag.choiceProps[0];

/** Uuids of `prop`'s values that count as done under `config` (saved override, else the default rule). */
const doneUuids = (config: ViewConfig, prop: ChoiceProp) => prop.values.filter((v) => isDone(v, config.doneValues[prop.ident])).map((v) => v.uuid);

const toggle = <T>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

/** The built-in Task Status values (their flags decide done); none in a graph without the Task tag, then every task is open. */
const taskStatusValues = (tags: TagInfo[]): ClosedValue[] =>
  tags.flatMap((t) => t.choiceProps).find((p) => p.ident === ":logseq.property/status")?.values ?? [];

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
          .map((v) => `<li>${"invalid" in v
              ? `<span class="pl-row pl-view-invalid" data-view-invalid="${esc(v.id)}" aria-disabled="true">${esc(v.name)}<small class="pl-hint">Cannot be opened: ${esc(v.invalid)}</small></span>`
              : `<button type="button" class="pl-row" data-view-open="${esc(v.id)}"${v.id === s.viewId ? ' aria-current="true"' : ""}>${esc(v.name)}</button>`}`
            + `<button type="button" class="pl-icon-btn" data-view-delete="${esc(v.id)}" aria-label="Delete saved view ${esc(v.name)}">×</button></li>`)
          .join("")}</ul>`
      : `<p class="pl-hint">No saved views yet.</p>`;
    const tag = s.config ? s.tags.find((t) => t.ident === s.config!.tag) : undefined;
    const suggestion = tag && s.config ? sanitizeViewName(`${tag.title} ${KIND_LABEL[s.config.kind].toLowerCase()}`) : "";
    const save = s.config
      ? `<div class="pl-save"><label for="pl-view-name">Name</label><input id="pl-view-name" class="pl-input" data-field="view-name" value="${esc(suggestion)}" autocomplete="off">`
        + `<button type="button" class="pl-btn pl-btn-primary" data-action="save-view">Save current view</button></div>`
      : "";
    return rows + save;
  };
  return `<header class="pl-top" data-region="topbar"><h1 class="pl-title">Planner</h1>`
    + `<div class="pl-seg" role="group" aria-label="View">${seg}</div><span class="pl-spacer"></span>`
    + menu("views", s, "Saved views", current ? esc(current.name) : "None", viewsPopover, "saved-views")
    + `<button type="button" class="pl-btn" data-action="close">Close</button></header>`;
}

function renderSettings(s: State, tag: TagInfo): string {
  const c = s.config!;
  const tagOptions = () => options("Tags", [...s.tags].sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || byTitle(a, b))
    .map((t) => ({ value: t.ident, text: `#${t.title}${t.builtIn ? " (built-in)" : ""}` })), c.tag);
  let html = menu("tag", s, "Tag", `#${esc(tag.title)}`, tagOptions);

  const children = tag.childIds.map((id) => s.tags.find((t) => t.id === id)).filter((t): t is TagInfo => !!t);
  if (children.length) {
    html += `<span class="pl-check"><input type="checkbox" id="pl-child-tags" data-control="child-tags"${c.childTags ? " checked" : ""}>`
      + `<label for="pl-child-tags">Include ${children.map((t) => `#${esc(t.title)}`).join(", ")}</label></span>`;
  }

  if (tag.dateProps.length) {
    const dateTitle = (ident: string | null) => tag.dateProps.find((p) => p.ident === ident)?.title ?? "None";
    const dateItems = tag.dateProps.map((p) => ({ value: p.ident, text: `${p.title} (${p.type === "date" ? "Date" : "DateTime"})` }));
    html += menu("start", s, "Start", esc(dateTitle(c.start)), () => options("Start property", dateItems, c.start ?? ""));
    html += menu("end", s, "End", esc(dateTitle(c.end)), () => options("End property", [{ value: "", text: "None" }, ...dateItems], c.end ?? ""));
  } else {
    html += `<span class="pl-hint">No date properties on this tag</span>`;
  }

  if (tag.nodeProps.length) {
    // N12: the node property whose values are the nodes a node depends on (Timeline connectors; dependents are not tasks).
    const current = dependsOnOf(c, tag);
    const title = tag.nodeProps.find((p) => p.ident === current)?.title ?? "None";
    const items = [{ value: "", text: "None" }, ...tag.nodeProps.map((p) => ({ value: p.ident, text: p.title }))];
    html += menu("depends", s, "Depends on", esc(title), () => options("Depends on property", items, current ?? ""));
  }

  const primary = primaryChoice(tag);
  if (primary) {
    const titles = primary.values.filter((v) => doneUuids(c, primary).includes(v.uuid)).map((v) => v.title);
    const popover = () => tag.choiceProps.map((p) => {
      const done = doneUuids(c, p);
      return checkList(p.title, p.values.map((v) => ({ attrs: `data-done-prop="${esc(p.ident)}" data-done-value="${esc(v.uuid)}"`, text: v.title, checked: done.includes(v.uuid) })));
    }).join("") + `<p class="pl-hint">${primary.values.some((v) => v.ident !== null) && !c.doneValues[primary.ident] ? "Built-in values use their Done and Canceled flags." : "Saved with the view."}</p>`;
    html += menu("done", s, "Done when", `${esc(primary.title)} is ${esc(titles.join(", ") || "nothing")}`, popover, "done-values");
  }
  return `<div class="pl-settings" data-region="settings" role="group" aria-label="View settings">${html}</div>`;
}

function renderTagTree(s: State, selected: string | undefined): string {
  const byId = new Map(s.tags.map((t) => [t.id, t]));
  const seen = new Set<number>();
  const item = (t: TagInfo): string => {
    if (seen.has(t.id)) return "";
    seen.add(t.id);
    const kids = t.childIds.map((id) => byId.get(id)).filter((k): k is TagInfo => !!k && k.parentIds[0] === t.id).sort(byTitle);
    return `<li><button type="button" class="pl-row" data-tag-id="${t.id}" aria-pressed="${t.ident === selected}"><span class="pl-hash">#</span>${esc(t.title)}</button>`
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

function renderFilters(s: State, tag: TagInfo): string {
  const c = s.config!;
  return tag.choiceProps.map((p) => {
    const selected = c.filters[p.ident] ?? [];
    const count = (id: number | null) => s.nodes.filter((n) => (n.choices[p.ident]?.id ?? null) === id).length;
    const row = (uuid: string | null, title: string, id: number | null) =>
      `<label class="pl-row"><input type="checkbox" data-filter-prop="${esc(p.ident)}" data-filter-value="${esc(uuid ?? "")}"${selected.includes(uuid) ? " checked" : ""}>`
      + `<span class="pl-filter-title">${esc(title)}</span><span class="pl-count">${count(id)}</span></label>`;
    return `<fieldset class="pl-filter" data-filter-group="${esc(p.ident)}"><legend class="pl-group-header">${esc(p.title)}</legend>`
      + p.values.map((v) => row(v.uuid, v.title, v.id)).join("") + row(null, "No value", null) + `</fieldset>`;
  }).join("");
}

const empty = (key: string, title: string, body: string, action = "") =>
  `<div class="pl-empty" data-empty="${key}"><b>${title}</b><span>${body}</span>${action}</div>`;

/** The Timeline layout for the visible nodes. */
function timelineLayout(s: State, now: Now, shown: { nodes: PlannerNode[]; tasks: PlannerTask[] }): TimelineLayout {
  const c = s.config!;
  if (c.kind !== "timeline") throw new Error(`timelineLayout called for a ${c.kind} view`);
  const statusValues = taskStatusValues(s.tags);
  return layoutTimeline({
    items: viewItems(shown.nodes, shown.tasks, c.start, c.end, statusValues),
    zoom: c.zoom, anchor: s.anchor ?? now.today, today: now.today, now: now.time, weekStart: now.weekStart, statusValues,
    titles: s.titles,
  });
}

/** The Calendar layout for the visible nodes. */
function calendarLayout(s: State, now: Now, shown: { nodes: PlannerNode[]; tasks: PlannerTask[] }): CalendarLayout {
  const c = s.config!;
  if (c.kind !== "calendar") throw new Error(`calendarLayout called for a ${c.kind} view`);
  const statusValues = taskStatusValues(s.tags);
  return layoutCalendar({
    items: viewItems(shown.nodes, shown.tasks, c.start, c.end, statusValues),
    layout: c.layout, anchor: s.anchor ?? now.today, today: now.today, weekStart: now.weekStart, statusValues,
    titles: s.titles,
  });
}

/** The Agenda layout for the visible nodes. */
function agendaLayout(s: State, now: Now, tag: TagInfo, shown: { nodes: PlannerNode[]; tasks: PlannerTask[] }): AgendaLayout {
  const c = s.config!;
  if (c.kind !== "agenda") throw new Error(`agendaLayout called for a ${c.kind} view`);
  const statusValues = taskStatusValues(s.tags);
  return layoutAgenda({
    items: viewItems(shown.nodes, shown.tasks, c.start, c.end, statusValues),
    groupBy: c.groupBy, showDone: c.showDone, today: now.today, statusValues, choiceProps: tag.choiceProps, doneValues: c.doneValues,
    titles: s.titles,
  });
}

/** The Kanban layout for the visible nodes (the view has a column property). */
function kanbanLayout(s: State, now: Now, tag: TagInfo, shown: { nodes: PlannerNode[]; tasks: PlannerTask[] }): KanbanLayout {
  const c = s.config!;
  if (c.kind !== "kanban" || c.columnProp === null) throw new Error(`kanbanLayout called for a ${c.kind} view without a column property`);
  const prop = (ident: string) => tag.choiceProps.find((p) => p.ident === ident)!;
  const statusValues = taskStatusValues(s.tags);
  return layoutKanban({
    items: viewItems(shown.nodes, shown.tasks, c.start, c.end, statusValues),
    columnProp: prop(c.columnProp), laneProp: c.laneProp === null ? null : prop(c.laneProp), sort: c.sort, today: now.today,
    choiceProps: tag.choiceProps, doneValues: c.doneValues, titles: s.titles, pending: new Set(s.pending.keys()),
    hidden: c.hiddenColumns[c.columnProp] ?? [],
  });
}

/** The main area (loading, an empty state, or the Timeline, Calendar, Agenda or Kanban) and its toolbar. */
function renderView(s: State, tag: TagInfo | undefined, now: () => Now): { view: string; toolbar: string } {
  const view = (html: string) => ({ view: html, toolbar: "" });
  if (s.loading) return view(`<div class="pl-empty" data-region="loading"><span>Loading…</span></div>`);
  if (s.loadFailed) return view(`<div class="pl-empty" data-region="load-failed"><button type="button" class="pl-btn" data-action="retry">Retry</button></div>`);
  if (!s.tags.length) return view(empty("no-tags", "No tags in this graph", "Create a tag in Logseq (type #Project on a block, for example) and it shows up here."));
  if (!tag || !s.config) return view("");
  const name = `#${esc(tag.title)}`;
  if (s.config.kind === "kanban" && s.config.columnProp === null) {
    return view(empty("no-choice", `${name} has no choice properties`, "Kanban columns come from a choice property, like Status. Add one to the tag in Logseq, or choose another tag."));
  }
  if (s.config.kind !== "kanban" && !tag.dateProps.length) {
    return view(empty("no-dates", `${name} has no date properties`, "Add a Date or DateTime property to the tag in Logseq and pick it as Start or End, or choose another tag."));
  }
  if (!s.nodes.length) return view(empty("no-nodes", `No ${name} nodes yet`, `Tag a page or block with ${name} and it shows up here.`));
  const shown = visibleData(s.config, tag, shownNodes(s), s.tasks);
  if (!shown.nodes.length) {
    return view(empty("no-matches", `No ${name} nodes match the filters`, "Change the filters in the left column.",
      `<button type="button" class="pl-btn" data-action="clear-filters">Clear filters</button>`));
  }
  if (s.config.kind === "timeline") {
    const layout = timelineLayout(s, now(), shown);
    return { view: renderTimeline(layout, `#${tag.title}`, s.expanded), toolbar: renderTimelineToolbar(layout) };
  }
  if (s.config.kind === "calendar") {
    const layout = calendarLayout(s, now(), shown);
    return { view: renderCalendar(layout, `#${tag.title}`), toolbar: renderCalendarToolbar(layout) };
  }
  if (s.config.kind === "agenda") {
    const layout = agendaLayout(s, now(), tag, shown);
    return { view: renderAgenda(layout, `#${tag.title}`, s.config.showDone, { open: s.agendaOpen, groups: s.agendaGroups, overdue: s.agendaOverdue }), toolbar: renderAgendaToolbar(s.config.groupBy, s.config.showDone) };
  }
  const c = s.config;
  const layout = kanbanLayout(s, now(), tag, shown);
  const prop = (ident: string | null) => tag.choiceProps.find((p) => p.ident === ident) ?? null;
  return {
    view: renderKanban(layout, `#${tag.title}`, s.popover === "kb-move" ? s.moveCard : null, s.kbShown),
    toolbar: renderKanbanToolbar({ choiceProps: tag.choiceProps, columnProp: prop(c.columnProp)!, laneProp: prop(c.laneProp), columns: layout.allColumns,
      shown: layout.columns, sort: c.sort, hasPriority: priorityProp(tag) !== null, popover: s.popover }),
  };
}

const errorBar = (error: string) =>
  `<div class="pl-error" role="alert" data-region="error"><span>${esc(error)}</span><button type="button" class="pl-btn" data-action="dismiss-error">Dismiss</button></div>`;

function renderWorkspace(s: State, now: () => Now): string {
  const tag = s.config ? s.tags.find((t) => t.ident === s.config!.tag) : undefined;
  const error = s.error ? errorBar(s.error) : "";
  const kind = s.config?.kind ?? "";
  const main = renderView(s, tag, now);
  return `<div class="pl-ws">${renderTopBar(s)}${error}`
    + (tag ? renderSettings(s, tag) : `<div class="pl-settings" data-region="settings" role="group" aria-label="View settings"></div>`)
    + `<div class="pl-body"><aside class="pl-sidebar" data-region="sidebar">${renderTagTree(s, tag?.ident)}${tag ? renderFilters(s, tag) : ""}</aside>`
    + `<main class="pl-main" data-region="main"><div class="pl-view-toolbar" data-region="view-toolbar" data-toolbar-kind="${kind}">${main.toolbar}</div>`
    + `<div class="pl-view" data-region="view">${main.view}</div></main></div></div>`;
}

// ---------------------------------------------------------------- controller

/** A selector that finds the same control after a re-render: its tag plus every `data-*` and `id` attribute. */
function selectorOf(el: Element): string {
  const attrs = [...el.attributes].filter((a) => a.name === "id" || a.name.startsWith("data-"));
  return el.tagName.toLowerCase() + attrs.map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join("");
}

export function createWorkspace(root: HTMLElement, deps: WorkspaceDeps): Workspace {
  const s: State = { loading: false, loadFailed: false, tags: [], config: null, nodes: [], tasks: [], titles: new Map(), views: [], viewId: null, popover: null, error: null, builtInOpen: false,
    anchor: null, expanded: new Set(), weekStart: null, pending: new Map(), moveCard: null,
    agendaOpen: new Set(), agendaGroups: AGENDA_GROUP_PAGE, agendaOverdue: AGENDA_GROUP_PAGE, kbShown: new Map() };
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
  /** A render was asked for during a drag: it runs when the drag ends. */
  let drawOwed = false;
  /** The clock the workspace was last drawn on (`clockOf`: the Timeline's today line, the Agenda's buckets depend on it). */
  let drawnClock = "";
  /** The day the Timeline's Day zoom last opened its scroll for (N10); null while the Day zoom is not shown. */
  let dayScrolled: string | null = null;
  /** Something the user is in the middle of that a redraw must not disturb. */
  const busy = () => s.popover !== null || s.pending.size > 0 || dragging !== null;

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  /**
   * Draws the workspace and never throws (T14): a render that fails puts its error in the error bar and draws again;
   * when that fails too, a bare shell with the error, Dismiss and Close is drawn, so the user can always leave.
   */
  const render = (focus?: string, keep = false) => {
    if (dragging !== null) {
      drawOwed = true; // never replace the DOM under an active drag (T14): drawn when it ends
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
  async function readData(config: ViewConfig, tags: TagInfo[]) {
    const tag = validateViewConfig(config, tags);
    return fromRaw(config, tags, await readRaw(deps.dq, tags, tag, dependsOnOf(config, tag)));
  }

  /** Nodes, tasks and titles from rows already read (`tags` maps them; the titles lookup runs here). */
  async function fromRaw(config: ViewConfig, tags: TagInfo[], raw: RawData) {
    const { nodes, tasks } = buildData(raw, tags, validateViewConfig(config, tags), { childTags: config.childTags, zone: deps.zone });
    // Inline refs to blocks that are not loaded (a #Task linking a #Project page): one lookup, only for the missing ones.
    const known = titlesByUuid(nodes);
    const missing = refUuids([...nodes, ...tasks].map((x) => x.title)).filter((u) => !known.has(u));
    return { nodes, tasks, titles: new Map([...known, ...(await loadTitles(deps.dq, missing))]) as ReadonlyMap<string, string> };
  }

  /** Re-reads the current view's nodes and tasks from the graph, without the loading state (a Kanban move reloads this way). */
  async function fetchData() {
    Object.assign(s, await readData(s.config!, s.tags));
  }

  async function loadData() {
    if (tagOf(s.config!).builtIn) s.builtInOpen = true; // every tag change passes here
    s.loading = true;
    render();
    try {
      await fetchData();
    } finally {
      s.loading = false;
    }
    deps.timing?.queried();
  }

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
    try {
      await listViews();
    } catch (e) {
      s.error = (e as Error).message;
    }
    if (s.config) {
      try {
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
    const shownTag = tagOf(s.config);
    const [weekStart, tags, shownRaw] = await Promise.all([deps.weekStart(), loadTagInfos(deps.dq), readRaw(deps.dq, s.tags, shownTag, dependsOnOf(s.config, shownTag))]);
    let config: ViewConfig | null = s.config;
    let error: string | null = null;
    /** The view was replaced by the default one (its tag or a property it uses is gone). */
    let replaced = false;
    try {
      // A field left unmapped (no date or choice property when it was set up) takes the default once the tag has one (T14).
      config = withDefaults(config, validateViewConfig(config, tags));
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
      : !replaced ? await fromRaw(config, tags, await readRaw(deps.dq, tags, tagOf(config, tags), dependsOnOf(config, tagOf(config, tags)), shownRaw))
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
  const refreshWhenFree = () => void (wantRefresh && !busy() && refresh());

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    // A click outside the open popover's anchor closes it (and still does what it was meant to do).
    if (s.popover && !t.closest(".pl-anchor")) {
      s.popover = null;
      if (!t.closest("button, input, label")) return void run(() => {});
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
      const p = ({ tag: "tag", start: "start", end: "end", depends: "depends", "done-values": "done", "saved-views": "views", "kb-column": "kb-column", "kb-show": "kb-show", "kb-lane": "kb-lane" } as const)[ctl.dataset.control as string];
      if (p) {
        s.popover = s.popover === p ? null : p;
        return void run(() => {}, () => (s.popover ? firstInPopover(s.popover) : trigger(p)));
      }
    }
    const opt = t.closest<HTMLElement>("[data-popover] [data-option]");
    if (opt && s.popover) {
      const p = s.popover;
      const value = opt.dataset.option!;
      s.popover = null;
      if (p === "tag") return void run(() => selectTag(s.tags.find((x) => x.ident === value)!), () => trigger("tag"));
      if (p === "start") return void run(() => setConfig({ ...s.config!, start: value }), () => trigger("start"));
      if (p === "end") return void run(() => setConfig({ ...s.config!, end: value || null }), () => trigger("end"));
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
    const el = t.closest<HTMLElement>("[data-tag-id], [data-view-kind], [data-view-open], [data-view-delete], [data-action]");
    if (!el) return;
    const d = el.dataset;
    if (d.tagId) return void run(() => selectTag(s.tags.find((x) => x.id === Number(d.tagId))!));
    if (d.viewKind) return void run(() => setConfig(switchKind(s.config!, tagOf(s.config!), d.viewKind as ViewKind)));
    if (d.viewOpen) {
      return void run(async () => {
        const v = s.views.find((x): x is SavedView => x.id === d.viewOpen && "config" in x)!;
        tagOf(v.config); // throws before anything changes
        s.popover = null;
        s.config = v.config;
        s.viewId = v.id;
        await loadData();
      }, () => trigger("views"));
    }
    if (d.viewDelete) {
      return void run(() => viewsWrite(() => deps.views.remove(d.viewDelete!)), () => "[data-field=view-name]");
    }
    switch (d.action) {
      case "close":
        s.popover = null;
        render();
        return deps.onClose();
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
      case "nav":
        return void run(() => void (s.anchor = shiftAnchor(s.anchor ?? now().today, c.zoom, a.dir)));
      case "today":
        return void run(() => void (s.anchor = null));
      case "toggle":
        return void run(() => void (s.expanded.has(a.nodeId) ? s.expanded.delete(a.nodeId) : s.expanded.add(a.nodeId)));
      case "jump":
        return void run(() => void (s.anchor = a.day));
    }
  }

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
    const tag = tagOf(s.config!);
    return kanbanLayout(s, now(), tag, visibleData(s.config!, tag, shownNodes(s), s.tasks));
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
    }
  });

  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    const d = t.dataset;
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
      if (!s.popover) return false;
      const p = s.popover;
      s.popover = null;
      render(trigger(p));
      return true;
    },
    refresh,
    showViews: () => run(listViews),
    idle: () => queue,
    config: () => s.config,
    stop: () => win?.removeEventListener("resize", drawTimelineLinks),
  };
}
