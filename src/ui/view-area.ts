// The view area shared by the workspace and the in-page block (N06b): a view's config + its loaded data + the clock →
// the view's HTML and its toolbar's HTML. Pure (no DOM, no SDK, no state of its own): the workspace passes its session
// state, the block passes `blockSession`. Also the one data loader both use (`readViewData`, `viewData`), so the two
// surfaces cannot drift apart.
import { buildData, loadTitles, readRaw, type RawData } from "../core/queries";
import { cardFieldsOf, extraFieldProps, offeredFields } from "../core/fields";
import { filterNodes } from "../core/nodes";
import type { ZoneOffset } from "../core/normalize";
import { tagsTitle, TAG_KEY, type Dq, type ViewTags } from "../core/schema";
import { dependsOnOf, toChoiceFilters, validateViewConfig, type ViewConfig } from "../core/view-config";
import { refUuids, titlesByUuid } from "../core/display-title";
import { addDays, daysBetween, nestItems, viewItems, type ViewItem } from "../core/layout-common";
import { layoutTimeline, type EditProps, type TimelineLayout } from "../core/timeline-layout";
import { editedNode, type DateWrite } from "../core/date-edit";
import { dayPeriod, whenColumnProp, whenMove, whenPeriods, WHEN_KEY, type WhenProps } from "../core/when";

const TASK_TAG = ":logseq.class/Task";
const SCHEDULED = ":logseq.property/scheduled";
const DEADLINE = ":logseq.property/deadline";
import { layoutCalendar, type CalendarLayout } from "../core/calendar-layout";
import { layoutAgenda, type AgendaLayout } from "../core/agenda";
import { layoutKanban, movedNode, priorityProp, tagLaneProp, type KanbanLayout, type PropertyWrite } from "../core/kanban";
import { layoutMatrix, type MatrixLayout } from "../core/matrix";
import type { ChoiceProp, ClosedValue, NodeSpan, PlannerNode, PlannerTask, TagInfo } from "../types";
import { esc } from "./html";
import { CALENDAR_TRAY_PAGE, renderCalendar, renderCalendarToolbar } from "./calendar";
import { AGENDA_GROUP_PAGE, renderAgenda, renderAgendaToolbar } from "./agenda";
import { renderKanban, renderKanbanToolbar } from "./kanban";
import { renderMatrix, renderMatrixToolbar } from "./matrix";
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
  /** Kanban and Matrix (N64): cards rendered per cell by `cellKey` / `matrixCellKey`; the Calendar's No date tray by `CALENDAR_TRAY_KEY` (N69) (absent = the first page). */
  kbShown: ReadonlyMap<string, number>;
  /** Kanban and Matrix moves being written, by node uuid: the card shows where the writes put it. */
  pending: ReadonlyMap<string, PropertyWrite[]>;
  /** The Kanban or Matrix card whose Move menu is open; null when none. */
  moveOpen: string | null;
  /** The open workspace popover (the Kanban toolbar's menus); null when none. */
  popover: string | null;
  /** Timeline: the Edit dates toggle is on (N06c; never in the in-page block). */
  editDates: boolean;
  /** Timeline date edits being written, by node uuid: the bar shows where the writes put it (N06c). */
  datePending: ReadonlyMap<string, DateWrite[]>;
  /** Timeline: the title column's width in px (N36); null = the default. */
  labelWidth: number | null;
}

/**
 * The in-page block's session (N06b): anchored on today, nested parents open and task rows folded (the Timeline's
 * defaults), the first pages; every folded Agenda bucket renders its entries (`open`), so the block can fold them with
 * the browser's own `details` toggle and needs no script.
 */
export const blockSession = (): ViewSession => ({
  anchor: null, expanded: new Set(), collapsed: new Set(), agendaOpen: new Set(["later", "none", "earlier"]),
  agendaGroups: AGENDA_GROUP_PAGE, agendaOverdue: AGENDA_GROUP_PAGE, kbShown: new Map(), pending: new Map(), moveOpen: null, popover: null,
  editDates: false, datePending: new Map(), labelWidth: null,
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
  return viewData(dq, config, tags, await readRaw(dq, tags, view.tags, dependsOnOf(config, view), undefined, extraFieldProps(config, view)), zone);
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
  const edit = a.session.editDates ? { edit: editProps(a) } : {};
  const pending = a.session.datePending.size ? { pending: new Set(a.session.datePending.keys()) } : {};
  return layoutCalendar({
    items: viewItems(shown.nodes, shown.tasks, datesOf(c), statusValues),
    layout: c.layout, anchor: a.session.anchor ?? now.today, today: now.today, time: now.time, weekStart: now.weekStart, statusValues,
    titles: a.titles, ...edit, ...pending,
  });
}

/** The Calendar layout on screen (the view is a Calendar): what a time-grid date edit starts from (N46). */
export const calendarLayoutOf = (a: ViewAreaInput, now: Now): CalendarLayout =>
  calendarLayout(a, now, visibleData(a.config, a.view, shownNodes(a.nodes, a.session), a.tasks));

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
  const byWhen = c.columnProp === WHEN_KEY;
  const periods = byWhen ? whenPeriods(now.today, now.weekStart) : [];
  const props = whenPropsOf(a);
  return layoutKanban({
    items: viewItems(shown.nodes, shown.tasks, datesOf(c), statusValues),
    columnProp: byWhen ? whenColumnProp(periods) : kanbanProp(a.view, c.columnProp)!, laneProp: kanbanProp(a.view, c.laneProp), sort: c.sort, today: now.today,
    choiceProps: a.view.choiceProps, doneValues: c.doneValues, titles: a.titles, pending: new Set([...a.session.pending.keys(), ...a.session.datePending.keys()]),
    when: byWhen ? { periods, fixed: (item) => { const p = props(item.node); return !p.start && !p.end; } } : undefined,
    hidden: c.hiddenColumns[c.columnProp] ?? [], hiddenFields: c.hiddenFields,
    cardFields: new Map(a.view.tags.map((t) => [t.ident, cardFieldsOf(c, t, a.view)])),
    tagTitles: a.view.tags.length > 1 ? new Map(a.view.tags.map((t) => [t.ident, `#${t.title}`])) : undefined,
  });
}

/** The Calendar's No date tray in `ViewSession.kbShown` (N69): how many of its items render. */
export const CALENDAR_TRAY_KEY = "@cal-tray";

/** A node's mapped Start and End properties (the view's Dates for its tag, N14): what a move by When writes (N67). */
export const whenPropsOf = (a: ViewAreaInput) => (n: PlannerNode): WhenProps => {
  const c = a.config;
  const tag = a.view.tags.find((t) => t.ident === n.tag);
  const prop = (ident: string | null | undefined) => (ident ? tag?.dateProps.find((p) => p.ident === ident) ?? null : null);
  return { start: prop(c.dates[n.tag]?.start), end: prop(c.dates[n.tag]?.end) };
};

/**
 * The date writes that move `uuid` to `target` (a When period key, `NO_VALUE` = No date, or a day `YYYY-MM-DD`, N68):
 * `whenMove` on the node as it shows now, or on a #Task block listed with the nodes (its Scheduled and Deadline as Start
 * and End). Kanban by When (N67) and Agenda drags (N68). N69 Calendar: `grab` = the day the item was picked up by (a
 * band's day under the pointer, a chip's day): the dates move by the days from `grab` to the target day, so that day
 * lands on the target. Throws as `whenMove` does, and for an unknown uuid or target.
 */
export function dateMoveOf(a: ViewAreaInput, now: Now, uuid: string, target: string, grab: string | null = null): { title: string; writes: DateWrite[] } {
  const c = a.config;
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(target);
  const periodOf = (span: NodeSpan) => {
    if (!isDay) return whenPeriods(now.today, now.weekStart).find((p) => p.key === target) ?? null;
    return dayPeriod(grab && span.end ? addDays(span.end.day, daysBetween(grab, target)) : target);
  };
  const plan = (node: PlannerNode, span: NodeSpan, props: WhenProps) => {
    const period = periodOf(span);
    if (!period) throw new Error(`No period ${target}`);
    return whenMove(node, span, props, period);
  };
  const shown = visibleData(c, a.view, shownNodes(a.nodes, a.session), a.tasks);
  const item = viewItems(shown.nodes, shown.tasks, datesOf(c), taskStatusValues(a.tags)).find((i) => i.node.uuid === uuid);
  if (item) return { title: item.node.title, writes: plan(item.node, item.span, whenPropsOf(a)(item.node)) };
  const task = shown.tasks.find((t) => t.uuid === uuid);
  if (!task) throw new Error(`No node or task ${uuid} in the view`);
  const props = a.tags.find((t) => t.ident === TASK_TAG)?.dateProps ?? [];
  const start = props.find((p) => p.ident === SCHEDULED) ?? null;
  const end = props.find((p) => p.ident === DEADLINE) ?? null;
  const dates = Object.fromEntries([[SCHEDULED, task.scheduled], [DEADLINE, task.deadline]].filter(([, v]) => v)) as PlannerNode["dates"];
  const s = task.scheduled ?? task.deadline;
  const e = task.deadline ?? task.scheduled;
  const span: NodeSpan = { kind: task.scheduled && task.deadline ? "mapped" : s ? "point" : "undated", start: s, end: e };
  const node: PlannerNode = { id: task.id, uuid, title: task.title, tagIds: [], tag: TASK_TAG, links: [], dependsOn: [], dates, choices: {} };
  return { title: task.title, writes: plan(node, span, { start, end }) };
}

/**
 * The properties a Matrix axis can use (N70): When first (its periods on `now`) when the view's tags have a Date or
 * DateTime property, then the shared choice properties.
 */
export function matrixProps(view: ViewTags, now: Now): ChoiceProp[] {
  const when = view.tags.some((t) => t.dateProps.length) ? [whenColumnProp(whenPeriods(now.today, now.weekStart))] : [];
  return [...when, ...view.choiceProps];
}

/** A Matrix view's axes with their properties (the view has axes). */
export function matrixAxes(a: ViewAreaInput, now: Now) {
  const c = a.config;
  if (c.kind !== "matrix" || !c.x || !c.y) throw new Error(`matrixAxes called for a ${c.kind} view without axes`);
  const props = matrixProps(a.view, now);
  const prop = (ident: string) => props.find((p) => p.ident === ident)!;
  return { x: { prop: prop(c.x.prop), reverse: c.x.reverse, first: c.x.first }, y: { prop: prop(c.y.prop), reverse: c.y.reverse, first: c.y.first } };
}

/** The Matrix layout of the visible nodes (N64; the view has axes). */
export function matrixLayout(a: ViewAreaInput, now: Now): MatrixLayout {
  const c = a.config;
  if (c.kind !== "matrix") throw new Error(`matrixLayout called for a ${c.kind} view`);
  const shown = visibleData(c, a.view, shownNodes(a.nodes, a.session), a.tasks);
  return layoutMatrix({
    items: viewItems(shown.nodes, shown.tasks, datesOf(c), taskStatusValues(a.tags)), ...matrixAxes(a, now), periods: whenPeriods(now.today, now.weekStart),
    mode: c.mode, showDone: c.showDone, labels: c.labels, today: now.today, doneValues: c.doneValues, titles: a.titles,
    pending: new Set([...a.session.pending.keys(), ...a.session.datePending.keys()]),
  });
}

/**
 * The view (an empty state, or the Timeline, Calendar, Agenda, Kanban or Matrix) and its toolbar, for a config with its loaded
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
  if (c.kind === "matrix" && (c.x === null || c.y === null) && view.tags.some((t) => t.dateProps.length)) {
    return only(empty("no-axes", `${name} ${multi ? "share" : "has"} no choice properties`,
      `A Matrix needs a choice property${multi ? " every selected tag has" : ""}, like Priority, to go with When. Add one to the ${multi ? "tags" : "tag"} in Logseq, or choose ${multi ? "other tags" : "another tag"}.`));
  }
  if (c.kind === "matrix" && (c.x === null || c.y === null)) {
    return only(empty("no-axes", `${name} ${multi ? "share" : "has"} fewer than two choice properties`,
      `A Matrix needs two choice properties${multi ? " every selected tag has" : ""}, like Priority and Status, or Impact and Effort. Add them to the ${multi ? "tags" : "tag"} in Logseq, or choose ${multi ? "other tags" : "another tag"}.`));
  }
  if (c.kind !== "kanban" && c.kind !== "matrix" && !view.tags.some((t) => t.dateProps.length)) {
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
    return { view: renderTimeline(layout, heading, { expanded: session.expanded, collapsed: session.collapsed, labelWidth: session.labelWidth }), toolbar: renderTimelineToolbar(layout, multi ? c.arrange : null) };
  }
  if (c.kind === "calendar") {
    const layout = calendarLayout(a, now(), shown);
    // N69: items drag onto a day or the No date tray; a node of a tag with no Start or End cannot.
    const props = whenPropsOf(a);
    const drag = { fixed: new Set(shown.nodes.filter((n) => { const p = props(n); return !p.start && !p.end; }).map((n) => n.uuid)), tray: session.kbShown.get(CALENDAR_TRAY_KEY) ?? CALENDAR_TRAY_PAGE };
    return { view: renderCalendar(layout, heading, drag), toolbar: renderCalendarToolbar(layout) };
  }
  if (c.kind === "agenda") {
    const at = now();
    const layout = agendaLayout(a, at, shown);
    // N68: entries drag onto a day heading or a period; a node of a tag with no Start or End cannot.
    const props = whenPropsOf(a);
    const drag = {
      targets: whenPeriods(at.today, at.weekStart).filter((p) => p.drop !== null || p.key === "none").map((p) => ({ key: p.key, title: p.title })),
      fixed: new Set(shown.nodes.filter((n) => { const p = props(n); return !p.start && !p.end; }).map((n) => n.uuid)),
    };
    return { view: renderAgenda(layout, heading, c.showDone, { open: session.agendaOpen, groups: session.agendaGroups, overdue: session.agendaOverdue }, drag), toolbar: renderAgendaToolbar(c.groupBy, c.showDone) };
  }
  if (c.kind === "matrix") {
    const at = now();
    const layout = matrixLayout(a, at);
    const axes = matrixAxes(a, at);
    const defaults = layout.mode === "quadrants" ? layoutMatrix({ ...axes, items: [], mode: "quadrants", showDone: false, labels: ["", "", "", ""], today: "", doneValues: {}, titles: new Map(), pending: new Set() }).rows.flat().map((cell) => cell.label ?? "") : [];
    return {
      view: renderMatrix(layout, heading, session.moveOpen, session.kbShown),
      toolbar: renderMatrixToolbar({ layout, choiceProps: matrixProps(view, at), labels: c.labels, defaults, showDone: c.showDone, popover: session.popover,
        axes }),
    };
  }
  const layout = kanbanLayout(a, now());
  return {
    view: renderKanban(layout, heading, session.moveOpen, session.kbShown),
    toolbar: renderKanbanToolbar({ choiceProps: view.choiceProps, columnProp: layout.allColumns[0].prop, laneProp: kanbanProp(view, c.laneProp), columns: layout.allColumns,
      when: view.tags.some((t) => t.dateProps.length), doneHidden: layout.doneHidden,
      shown: layout.columns, sort: c.sort, hasPriority: priorityProp(view) !== null, tagLanes: multi, popover: session.popover,
      fieldGroups: view.tags.map((t) => ({ ident: t.ident, title: t.title, offered: offeredFields(c, t, view), shown: new Set(cardFieldsOf(c, t, view).map((f) => f.ident)) })) }),
  };
}
