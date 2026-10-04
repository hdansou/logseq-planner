// Agenda view (T10): renders an `AgendaLayout` as HTML for the workspace's view area and its per-view toolbar, and
// names the action a click means. Pure state → HTML, like calendar.ts; the workspace owns state and events.
// By date: one section per non-empty bucket (Later, No date and Earlier are folded `details` whose entries render only
// once opened, `data-ag-fold` on the summary); by node: one section per node with its own line and its tasks, the first
// `AGENDA_GROUP_PAGE` groups and a `data-ag-more` button for the next page; the Overdue bucket (by date) renders its
// entries the same way, `data-ag-more="overdue"` inside the section. Every entry is a button carrying `data-ag-entry` (node | task), `data-ag-open`
// (uuid), `data-bucket` and the flags `data-late` / `data-done`.
import type { AgendaBucket, AgendaEntry, AgendaGroup, AgendaGroupBy, AgendaLayout } from "../core/agenda";
import { esc, flag, segmented, toggleButton } from "./html";

export type AgendaAction =
  | { type: "group"; groupBy: AgendaGroupBy }
  | { type: "showDone" }
  /** Render the next page: of the Overdue bucket's entries (`overdue`), else of the node groups. */
  | { type: "more"; overdue: boolean }
  | { type: "open"; uuid: string };

/** Node grouping renders this many groups, and the Overdue bucket this many entries, at first and per "Show more" (T13a: 2,000 groups were ~19k elements). */
export const AGENDA_GROUP_PAGE = 100;

/** Session state that decides how much of the agenda is rendered (T13a). */
export interface AgendaShown {
  /** Keys of the folded buckets (Later, No date, Earlier) the user opened: only those render their entries. */
  open: ReadonlySet<string>;
  /** How many node groups to render. */
  groups: number;
  /** How many entries of the Overdue bucket to render. */
  overdue: number;
}

const GROUPS: [AgendaGroupBy, string][] = [["node", "Node"], ["date", "Date"]];

export function renderAgendaToolbar(groupBy: AgendaGroupBy, showDone: boolean): string {
  return segmented("Group by", "ag-group-by", GROUPS, groupBy) + `<span class="pl-spacer"></span>` + toggleButton("Show done", "ag-show-done", showDone);
}

/** The entry's button; `chip` adds the node's name (a task listed by date). */
function renderEntry(e: AgendaEntry, chip: boolean): string {
  return `<button type="button" class="pl-ag-entry" data-ag-entry="${e.kind}" data-ag-open="${esc(e.uuid)}" data-bucket="${esc(e.bucket)}" data-cat="${e.cat}"`
    + `${e.status ? ` data-status="${esc(e.status)}"` : ""}${flag("data-late", e.late)}${flag("data-done", e.done)}`
    + ` aria-label="${esc(e.label)}" title="${esc(e.label)}">`
    + `<span class="pl-ag-icon" aria-hidden="true"></span><span class="pl-ag-title">${esc(e.title)}</span>`
    + (chip && e.node ? `<span class="pl-chip pl-ag-node" data-ag-node data-cat="${e.cat}">${esc(e.node)}</span>` : "")
    + `<span class="pl-ag-when">${esc(e.when)}</span></button>`;
}

const items = (entries: AgendaEntry[], chip: boolean) => `<ul class="pl-ag-list">${entries.map((e) => `<li>${renderEntry(e, chip)}</li>`).join("")}</ul>`;

/** A folded bucket is a `details`; its entries are rendered only while it is open (`open`), the count always. */
function renderBucket(b: AgendaBucket, shown: AgendaShown): string {
  const open = shown.open;
  const id = `pl-ag-h-${esc(b.key)}`;
  const title = `${esc(b.label)} <span class="pl-ag-count" data-ag-count>${b.entries.length}</span>`;
  const attrs = `class="pl-ag-bucket" data-ag-bucket="${esc(b.key)}"`;
  const unfolded = open.has(b.key);
  const paged = b.key === "overdue";
  const list = paged ? items(b.entries.slice(0, shown.overdue), true) + moreButton(b.entries.length - shown.overdue, "overdue") : items(b.entries, true);
  return b.collapsed
    ? `<details ${attrs}${unfolded ? " open" : ""}><summary data-ag-fold="${esc(b.key)}"><h2 class="pl-ag-head" id="${id}">${title}</h2></summary>${unfolded ? list : ""}</details>`
    : `<section ${attrs} aria-labelledby="${id}"><h2 class="pl-ag-head" id="${id}">${title}</h2>${list}</section>`;
}

function renderGroup(g: AgendaGroup): string {
  const n = g.node;
  const id = `pl-ag-h-${esc(n.uuid)}`;
  const progress = g.progress.total ? `<span class="pl-ag-progress" data-ag-progress>${g.progress.done}/${g.progress.total}</span>` : "";
  const line = `<button type="button" class="pl-ag-entry pl-ag-node-line" data-ag-entry="node" data-ag-open="${esc(n.uuid)}" data-bucket="${esc(n.bucket)}" data-cat="${n.cat}"`
    + `${flag("data-late", n.late)}${flag("data-done", n.done)} aria-label="${esc(n.label)}" title="${esc(n.label)}">`
    + `<span class="pl-ag-icon" aria-hidden="true"></span><span class="pl-ag-title">${esc(n.title)}</span>`
    + (g.meta.length ? `<span class="pl-ag-meta">${esc(g.meta.join(" · "))}</span>` : "")
    + progress + `<span class="pl-ag-when">${esc(n.when)}</span></button>`;
  return `<section class="pl-ag-group" data-ag-group="${esc(n.uuid)}" data-cat="${n.cat}"${flag("data-late", n.late)} aria-labelledby="${id}">`
    + `<h2 class="pl-ag-group-head" id="${id}">${line}</h2>${g.tasks.length ? items(g.tasks, false) : ""}</section>`;
}

/** Nothing to list: one message, and the way out (Show done) when it is off. */
function renderEmpty(showDone: boolean): string {
  return `<div class="pl-empty" data-ag-empty><b>Nothing on the agenda</b>`
    + `<span>${showDone ? "No nodes or tasks to list." : "No open nodes or tasks. Turn on Show done to include done and canceled ones."}</span></div>`;
}

/** The button for the next page while `rest` items are left; `scope` is the value of `data-ag-more` (empty for the node groups). */
function moreButton(rest: number, scope: string): string {
  if (rest <= 0) return "";
  const page = Math.min(rest, AGENDA_GROUP_PAGE);
  return `<button type="button" class="pl-btn pl-ag-more" data-ag-more="${scope}">Show ${page.toLocaleString("en-US")} more${rest > page ? ` of ${rest.toLocaleString("en-US")}` : ""}</button>`;
}

/** The first `shown` groups, then a button for the next page while some are left. */
function renderGroups(groups: AgendaGroup[], shown: number): string {
  return groups.slice(0, shown).map(renderGroup).join("") + moreButton(groups.length - shown, "");
}

/** The agenda. `heading` names the nodes (the tag, e.g. "#Project"); `shown` = the unfolded buckets and the number of groups to render. */
export function renderAgenda(layout: AgendaLayout, heading: string, showDone: boolean, shown: AgendaShown): string {
  const body = layout.empty ? renderEmpty(showDone)
    : layout.groupBy === "date" ? layout.buckets.map((b) => renderBucket(b, shown)).join("") : renderGroups(layout.groups, shown.groups);
  return `<div class="pl-ag" data-agenda data-group="${layout.groupBy}" role="region" aria-label="${esc(`${heading} agenda`)}">${body}</div>`;
}

/** The action a click on `target` asks for, or null when it is not an Agenda control. */
export function agendaAction(target: Element): AgendaAction | null {
  const el = target.closest<HTMLElement>("[data-ag-group-by], [data-ag-show-done], [data-ag-more], [data-ag-open]");
  if (!el) return null;
  if (el.dataset.agGroupBy) return { type: "group", groupBy: el.dataset.agGroupBy as AgendaGroupBy };
  if (el.hasAttribute("data-ag-show-done")) return { type: "showDone" };
  if (el.hasAttribute("data-ag-more")) return { type: "more", overdue: el.dataset.agMore === "overdue" };
  return { type: "open", uuid: el.dataset.agOpen! };
}
