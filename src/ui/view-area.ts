// The view area shared by the workspace and the in-page block (N06b): a view's config + its loaded data + the clock →
// the view's HTML and its toolbar's HTML. Pure (no DOM, no SDK, no state of its own): the workspace passes its session
// state, the block passes `blockSession`. Also the one data loader both use (`readViewData`, `viewData`), so the two
// surfaces cannot drift apart.
import { buildData, loadTitles, readRaw, type RawData } from "../core/queries";
import { filterNodes } from "../core/nodes";
import type { ZoneOffset } from "../core/normalize";
import { tagsTitle, TAG_KEY, type Dq, type ViewTags } from "../core/schema";
import { dependsOnOf, toChoiceFilters, validateViewConfig, type ViewConfig } from "../core/view-config";
import { refUuids, titlesByUuid } from "../core/display-title";
import { nestItems, viewItems, type ViewItem } from "../core/layout-common";
import { layoutTimeline, type EditProps, type TimelineLayout } from "../core/timeline-layout";
import { editedNode, type DateChange } from "../core/date-edit";
import { layoutCalendar, type CalendarLayout } from "../core/calendar-layout";
import { layoutAgenda, type AgendaLayout } from "../core/agenda";
import { layoutKanban, movedNode, priorityProp, tagLaneProp, type KanbanLayout, type PropertyWrite } from "../core/kanban";
import type { ChoiceProp, ClosedValue, PlannerNode, PlannerTask, TagInfo } from "../types";
import { esc } from "./html";
import { renderCalendar, renderCalendarToolbar } from "./calendar";
import { AGENDA_GROUP_PAGE, renderAgenda, renderAgendaToolbar } from "./agenda";
import { renderKanban, renderKanbanToolbar } from "./kanban";
import { renderTimeline, renderTimelineToolbar } from "./timeline";

/** What the clock and the host week start say right now: injected so renders stay pure; asked only when a view needs it. */
export interface Now {
  today: string;
  /** `HH:MM`. */
  time: string;
  weekStart: number;
}

/** The session state the view area reads: what is unfolded, paged, pending or open. Never saved with a view. */
export interface ViewSession {
  /** Timeline / Calendar anchor day; null = today. */
  anchor: string | null;
  /** Timeline: node ids whose task rows are expanded. */
  expanded: ReadonlySet<number>;
  /** Timeline nested (N14): parent node ids whose children are hidden. */
  collapsed: ReadonlySet<number>;
  /** Agenda: folded buckets whose entries render. */
  agendaOpen: ReadonlySet<string>;
  /** Agenda by node: how many groups render. */
  agendaGroups: number;
  /** Agenda by date: how many Overdue entries render. */
  agendaOverdue: number;
  /** Kanban: cards rendered per cell by `cellKey` (absent = the first page). */
  kbShown: ReadonlyMap<string, number>;
  /** Kanban moves being written, by node uuid: the card shows where the writes put it. */
  pending: ReadonlyMap<string, PropertyWrite[]>;
  /** The Kanban card whose Move menu is open; null when none. */
  moveOpen: string | null;
  /** The open workspace popover (the Kanban toolbar's menus); null when none. */
  popover: string | null;
  /** Timeline: the Edit dates toggle is on (N06c; never in the in-page block). */
  editDates: boolean;
  /** Timeline date edits being written, by node uuid: the bar shows where the writes put it (N06c). */
  datePending: ReadonlyMap<string, DateChange[]>;
}

/**
 * The in-page block's session (N06b): anchored on today, nested parents open and task rows folded (the Timeline's
 * defaults), the first pages; every folded Agenda bucket renders its entries (`open`), so the block can fold them with
 * the browser's own `details` toggle and needs no script.
 */
export const blockSession = (): ViewSession => ({
  anchor: null, expanded: new Set(), collapsed: new Set(), agendaOpen: new Set(["later", "none", "earlier"]),
  agendaGroups: AGENDA_GROUP_PAGE, agendaOverdue: AGENDA_GROUP_PAGE, kbShown: new Map(), pending: new Map(), moveOpen: null, popover: null,
  editDates: false, datePending: new Map(),
});

/** Everything the view area is drawn from. */
export interface ViewAreaInput {
  /** Every tag of the graph (the Task Status values come from them). */
  tags: TagInfo[];
  config: ViewConfig;
  /** `validateViewConfig(config, tags)`. */
  view: ViewTags;
  /** The loaded nodes (pending Kanban moves are applied here). */
  nodes: PlannerNode[];
  tasks: PlannerTask[];
  /** Titles by lower-case uuid (loaded nodes + `loadTitles`). */
  titles: ReadonlyMap<string, string>;
  session: ViewSession;
}

/** A view's nodes, tasks and titles. */
export interface ViewData {
  nodes: PlannerNode[];
  tasks: PlannerTask[];
  titles: ReadonlyMap<string, string>;
}

/** Nodes, tasks and titles from rows already read (`tags` maps them; the titles lookup runs here). */
export async function viewData(dq: Dq, config: ViewConfig, tags: TagInfo[], raw: RawData, zone?: ZoneOffset): Promise<ViewData> {
  const { nodes, tasks } = buildData(raw, tags, validateViewConfig(config, tags).tags, { childTags: config.childTags, zone });
  // Inline refs to blocks that are not loaded (a #Task linking a #Project page): one lookup, only for the missing ones.
  const known = titlesByUuid(nodes);
  const missing = refUuids([...nodes, ...tasks].map((x) => x.title)).filter((u) => !known.has(u));
  return { nodes, tasks, titles: new Map([...known, ...(await loadTitles(dq, missing))]) };
}

/** A view's nodes, tasks and titles as the graph has them now. */
export async function readViewData(dq: Dq, config: ViewConfig, tags: TagInfo[], zone?: ZoneOffset): Promise<ViewData> {
  const view = validateViewConfig(config, tags);
  return viewData(dq, config, tags, await readRaw(dq, tags, view.tags, dependsOnOf(config, view)), zone);
}

/** The loaded nodes with the pending Kanban moves and Timeline date edits applied: where they show while the writes run. */
export function shownNodes(nodes: PlannerNode[], session: Pick<ViewSession, "pending" | "datePending">): PlannerNode[] {
  const { pending, datePending } = session;
  if (!pending.size && !datePending.size) return nodes;
  return nodes.map((n) => {
    const moved = pending.has(n.uuid) ? movedNode(n, pending.get(n.uuid)!) : n;
    return datePending.has(n.uuid) ? editedNode(moved, datePending.get(n.uuid)!) : moved;
  });
}

/** The nodes that pass the view's filters (the Tag filter by node tag, N14) and the tasks linked to them: what a view is handed (T07 D4). */
export function visibleData(config: ViewConfig, view: ViewTags, nodes: PlannerNode[], tasks: PlannerTask[]) {
  const byTag = config.filters[TAG_KEY] ?? [];
  const byChoice = filterNodes(nodes, toChoiceFilters(config, view));
  const shown = byTag.length ? byChoice.filter((n) => byTag.includes(n.tag)) : byChoice;
  const ids = new Set(shown.map((n) => n.id));
  return { nodes: shown, tasks: tasks.filter((t) => t.nodeIds.some((id) => ids.has(id))) };
}

type Shown = { nodes: PlannerNode[]; tasks: PlannerTask[] };

/** The built-in Task Status values (their flags decide done); none in a graph without the Task tag, then every task is open. */
const taskStatusValues = (tags: TagInfo[]): ClosedValue[] =>
  tags.flatMap((t) => t.choiceProps).find((p) => p.ident === ":logseq.property/status")?.values ?? [];

/** An empty state: a title, a line, and optionally a button. */
export const empty = (key: string, title: string, body: string, action = "") =>
  `<div class="pl-empty" data-empty="${key}"><b>${title}</b><span>${body}</span>${action}</div>`;

/** Each node's Start / End: its tag's mapping in the view (N14). */
const datesOf = (c: ViewConfig) => (n: PlannerNode) => c.dates[n.tag];

/**
 * The items nested (N14 step 2: children under their parent, progress over children and tasks) for a view over two or
 * more tags, the items as they are for one tag (whose nodes carry no links).
 */
const nested = (a: ViewAreaInput, items: ViewItem[]) =>
  a.view.tags.length > 1 ? nestItems(items, taskStatusValues(a.tags), a.config.doneValues) : { items, parentOf: new Map<number, number>() };

/** Each node's own mapped Start / End properties (its tag's mapping, with their types): what a date edit writes (N06c). */
const editProps = (a: ViewAreaInput): EditProps => (n) => {
  const { start, end } = a.config.dates[n.tag];
  const tag = a.view.tags.find((t) => t.ident === n.tag)!;
  const prop = (ident: string | null) => (ident === null ? null : tag.dateProps.find((p) => p.ident === ident)!);
  return { start: prop(start), end: prop(end) };
};

/** The Timeline layout for the visible nodes; with two or more tags arranged as the view says (N14); with Edit dates on, editable (N06c). */
function timelineLayout(a: ViewAreaInput, now: Now, shown: Shown): TimelineLayout {
  const c = a.config;
  if (c.kind !== "timeline") throw new Error(`timelineLayout called for a ${c.kind} view`);
  const statusValues = taskStatusValues(a.tags);
  const multi = a.view.tags.length > 1;
  const items = viewItems(shown.nodes, shown.tasks, datesOf(c), statusValues);
  const edit = a.session.editDates ? { edit: editProps(a) } : {};
  const pending = a.session.datePending.size ? { pending: new Set(a.session.datePending.keys()) } : {};
  const base = { zoom: c.zoom, anchor: a.session.anchor ?? now.today, today: now.today, now: now.time, weekStart: now.weekStart, statusValues, titles: a.titles, ...edit, ...pending };
  if (multi && c.arrange === "nested") {
    const nest = nested(a, items);
    return layoutTimeline({ ...base, items: nest.items, nest: nest.parentOf, collapsed: a.session.collapsed });
  }
  return layoutTimeline({ ...base, items, ...(multi && c.arrange === "tag" ? { groups: a.view.tags.map((t) => ({ tag: t.ident, title: `#${t.title}` })) } : {}) });
}

/** The Calendar layout for the visible nodes. */
function calendarLayout(a: ViewAreaInput, now: Now, shown: Shown): CalendarLayout {
  const c = a.config;
  if (c.kind !== "calendar") throw new Error(`calendarLayout called for a ${c.kind} view`);
  const statusValues = taskStatusValues(a.tags);
  return layoutCalendar({
    items: viewItems(shown.nodes, shown.tasks, datesOf(c), statusValues),
    layout: c.layout, anchor: a.session.anchor ?? now.today, today: now.today, weekStart: now.weekStart, statusValues,
    titles: a.titles,
  });
}

/** The Agenda layout for the visible nodes. */
function agendaLayout(a: ViewAreaInput, now: Now, shown: Shown): AgendaLayout {
  const c = a.config;
  if (c.kind !== "agenda") throw new Error(`agendaLayout called for a ${c.kind} view`);
  const statusValues = taskStatusValues(a.tags);
  const items = viewItems(shown.nodes, shown.tasks, datesOf(c), statusValues);
  // By node, a parent's group lists its children (N14 step 2); by date every node is its own entry.
  const nest = c.groupBy === "node" ? nested(a, items) : null;
  return layoutAgenda({
    items: nest?.items ?? items, ...(nest ? { nest: nest.parentOf } : {}),
    groupBy: c.groupBy, showDone: c.showDone, today: now.today, statusValues, choiceProps: a.view.choiceProps, doneValues: c.doneValues,
    titles: a.titles,
  });
}

/** The Timeline layout on screen (the view is a Timeline): what a date edit starts from (N06c). */
export const timelineLayoutOf = (a: ViewAreaInput, now: Now): TimelineLayout =>
  timelineLayout(a, now, visibleData(a.config, a.view, shownNodes(a.nodes, a.session), a.tasks));

/** A Kanban view's column or lane property: one of the view's shared choice properties, or the Tag lanes (N14); null for none. */
export const kanbanProp = (view: ViewTags, ident: string | null): ChoiceProp | null =>
  ident === null ? null : ident === TAG_KEY ? tagLaneProp(view.tags) : view.choiceProps.find((p) => p.ident === ident)!;

/** The Kanban layout of the visible nodes (the view has a column property). */
export function kanbanLayout(a: ViewAreaInput, now: Now): KanbanLayout {
  const c = a.config;
  if (c.kind !== "kanban" || c.columnProp === null) throw new Error(`kanbanLayout called for a ${c.kind} view without a column property`);
  const shown = visibleData(c, a.view, shownNodes(a.nodes, a.session), a.tasks);
  const statusValues = taskStatusValues(a.tags);
  return layoutKanban({
    items: viewItems(shown.nodes, shown.tasks, datesOf(c), statusValues),
    columnProp: kanbanProp(a.view, c.columnProp)!, laneProp: kanbanProp(a.view, c.laneProp), sort: c.sort, today: now.today,
    choiceProps: a.view.choiceProps, doneValues: c.doneValues, titles: a.titles, pending: new Set(a.session.pending.keys()),
    hidden: c.hiddenColumns[c.columnProp] ?? [],
  });
}

/**
 * The view (an empty state, or the Timeline, Calendar, Agenda or Kanban) and its toolbar, for a config with its loaded
 * data. `now` is asked only when a view is drawn.
 */
export function renderViewArea(a: ViewAreaInput, now: () => Now): { view: string; toolbar: string } {
  const only = (html: string) => ({ view: html, toolbar: "" });
  const { config: c, view, session } = a;
  const heading = tagsTitle(view.tags);
  const name = esc(heading);
  const multi = view.tags.length > 1;
  if (c.kind === "kanban" && c.columnProp === null) {
    return only(multi
      ? empty("no-choice", `${name} share no choice property`, "Kanban columns come from a choice property every selected tag has, like Status. Add one to the tags in Logseq, or choose other tags.")
      : empty("no-choice", `${name} has no choice properties`, "Kanban columns come from a choice property, like Status. Add one to the tag in Logseq, or choose another tag."));
  }
  if (c.kind !== "kanban" && !view.tags.some((t) => t.dateProps.length)) {
    return only(multi
      ? empty("no-dates", `${name} have no date properties`, "Add a Date or DateTime property to one of the tags in Logseq and pick it under Dates, or choose other tags.")
      : empty("no-dates", `${name} has no date properties`, "Add a Date or DateTime property to the tag in Logseq and pick it as Start or End, or choose another tag."));
  }
  if (!a.nodes.length) return only(empty("no-nodes", `No ${name} nodes yet`, `Tag a page or block with ${multi ? "one of these tags" : name} and it shows up here.`));
  const shown = visibleData(c, view, shownNodes(a.nodes, session), a.tasks);
  if (!shown.nodes.length) {
    return only(empty("no-matches", `No ${name} nodes match the filters`, "Change the filters in the panel.",
      `<button type="button" class="pl-btn" data-action="clear-filters">Clear filters</button>`));
  }
  if (c.kind === "timeline") {
    const layout = timelineLayout(a, now(), shown);
    return { view: renderTimeline(layout, heading, { expanded: session.expanded, collapsed: session.collapsed }), toolbar: renderTimelineToolbar(layout, multi ? c.arrange : null) };
  }
  if (c.kind === "calendar") {
    const layout = calendarLayout(a, now(), shown);
    return { view: renderCalendar(layout, heading), toolbar: renderCalendarToolbar(layout) };
  }
  if (c.kind === "agenda") {
    const layout = agendaLayout(a, now(), shown);
    return { view: renderAgenda(layout, heading, c.showDone, { open: session.agendaOpen, groups: session.agendaGroups, overdue: session.agendaOverdue }), toolbar: renderAgendaToolbar(c.groupBy, c.showDone) };
  }
  const layout = kanbanLayout(a, now());
  return {
    view: renderKanban(layout, heading, session.moveOpen, session.kbShown),
    toolbar: renderKanbanToolbar({ choiceProps: view.choiceProps, columnProp: kanbanProp(view, c.columnProp)!, laneProp: kanbanProp(view, c.laneProp), columns: layout.allColumns,
      shown: layout.columns, sort: c.sort, hasPriority: priorityProp(view) !== null, tagLanes: multi, popover: session.popover }),
  };
}
