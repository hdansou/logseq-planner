// Kanban view (T11): renders a `KanbanLayout` as HTML for the workspace's view area and its per-view toolbar, and names
// the action a click means. Pure state → HTML, like agenda.ts; the workspace owns state, drag events and writes.
// One CSS grid (kanban.css): a header row of columns, then per lane a lane heading spanning the board and one cell per
// column. Hooks: `data-kb-column` (header, value uuid or "none"), `data-kb-lane-head`, `data-kb-cell` with
// `data-kb-col` / `data-kb-lane`, `data-kb-card` (uuid; `draggable`, `data-kb-pending`), `data-kb-open`, `data-kb-move`
// and, in the open Move menu, `data-kb-to-col` / `data-kb-to-lane`.
import { NO_VALUE, type KanbanCard, type KanbanCell, type KanbanLayout, type KanbanSlot, type KanbanSort } from "../core/kanban";
import type { ChoiceProp } from "../types";
import { esc, flag, menu, options, segmented } from "./html";

export type KanbanAction =
  | { type: "sort"; sort: KanbanSort }
  | { type: "open"; uuid: string }
  | { type: "moveMenu"; uuid: string }
  /** From the Move menu: the target column or lane (the other one stays). */
  | { type: "moveTo"; uuid: string; column: string | null; lane: string | null };

export interface KanbanToolbarInput {
  choiceProps: ChoiceProp[];
  columnProp: ChoiceProp;
  laneProp: ChoiceProp | null;
  sort: KanbanSort;
  /** The tag has a Priority choice: the Priority sort is offered. */
  hasPriority: boolean;
  /** The open workspace popover. */
  popover: string | null;
}

export function renderKanbanToolbar(t: KanbanToolbarInput): string {
  const columns = () => options("Column property", t.choiceProps.map((p) => ({ value: p.ident, text: p.title })), t.columnProp.ident);
  const lanes = () => options("Swimlane property", [{ value: "", text: "None" }, ...t.choiceProps.filter((p) => p.ident !== t.columnProp.ident).map((p) => ({ value: p.ident, text: p.title }))], t.laneProp?.ident ?? "");
  const sorts: [KanbanSort, string][] = [["due", "Due"], ...(t.hasPriority ? [["priority", "Priority"] as [KanbanSort, string]] : []), ["title", "Title"]];
  const changes = esc(t.columnProp.title) + (t.laneProp ? ` or ${esc(t.laneProp.title)}` : "");
  return menu("kb-column", t.popover === "kb-column", "Columns", esc(t.columnProp.title), columns)
    + menu("kb-lane", t.popover === "kb-lane", "Swimlanes", esc(t.laneProp?.title ?? "None"), lanes)
    + `<span class="pl-field-label">Sort</span>` + segmented("Sort cards by", "kb-sort", sorts, t.sort)
    + `<span class="pl-spacer"></span><span class="pl-hint">Drag a card, or use its ⋯ menu, to change ${changes}</span>`;
}

/** Last ident segment of a built-in value (`doing`, `in-review`, …) for the status icon; null for user values and "No". */
const statusKey = (s: KanbanSlot) => (s.value?.ident ? s.value.ident.split(".").pop()! : null);

function renderHead(c: KanbanSlot): string {
  const status = statusKey(c);
  return `<div class="pl-kb-head" data-kb-column="${esc(c.key)}"${status ? ` data-status="${esc(status)}"` : ""}${flag("data-done", c.done)}${flag("data-none", c.key === NO_VALUE)}>`
    + (status ? `<span class="pl-kb-icon" aria-hidden="true"></span>` : "")
    + `<span class="pl-kb-head-title">${esc(c.title)}</span><span class="pl-kb-count" data-kb-count>${c.count}</span></div>`;
}

function renderLane(l: KanbanSlot): string {
  return `<div class="pl-kb-lane" data-kb-lane-head="${esc(l.key)}"${flag("data-none", l.key === NO_VALUE)}>`
    + `<span class="pl-kb-lane-title">${esc(l.title)}</span><span class="pl-kb-count" data-kb-count>${l.count}</span></div>`;
}

/** The Move menu of a card: one listbox per property, the current value selected. */
function renderMoveMenu(card: KanbanCard, cell: KanbanCell, layout: KanbanLayout): string {
  const list = (slots: KanbanSlot[], current: string, attr: string) => {
    const prop = slots[0].prop.title;
    return `<p class="pl-kb-move-head">${esc(prop)}</p><div role="listbox" aria-label="${esc(prop)}">${slots
      .map((s) => `<button type="button" role="option" class="pl-row" data-${attr}="${esc(s.key)}" data-kb-card="${esc(card.uuid)}" aria-selected="${s.key === current}">${esc(s.title)}</button>`)
      .join("")}</div>`;
  };
  return `<div class="pl-popover pl-kb-move-menu" data-popover="kb-move">`
    + list(layout.columns, cell.column.key, "kb-to-col")
    + (cell.lane ? list(layout.lanes, cell.lane.key, "kb-to-lane") : "")
    + `</div>`;
}

function renderCard(card: KanbanCard, cell: KanbanCell, layout: KanbanLayout, moveOpen: string | null): string {
  const pct = card.progress.total ? Math.round((card.progress.done / card.progress.total) * 100) : null;
  const meta = [
    card.progress.total ? `<span>${card.progress.done}/${card.progress.total} tasks</span>` : "",
    card.priority ? `<span class="pl-kb-priority" data-priority="${esc(card.priority.key)}">${esc(card.priority.title)}</span>` : "",
    ...card.meta.map((m) => `<span>${esc(m)}</span>`),
    `<span class="pl-kb-when">${esc(card.when)}</span>`,
  ].filter(Boolean).join("");
  const open = moveOpen === card.uuid;
  return `<div role="listitem" class="pl-kb-card" data-kb-card="${esc(card.uuid)}" data-cat="${card.cat}" draggable="${!card.pending}"`
    + `${flag("data-kb-pending", card.pending)}${card.pending ? ' aria-busy="true"' : ""}${flag("data-done", card.done)}${flag("data-late", card.late)}>`
    + `<button type="button" class="pl-kb-open" data-kb-open="${esc(card.uuid)}" aria-label="${esc(card.label)}" title="${esc(card.label)}">`
    + `<span class="pl-kb-title-row"><span class="pl-kb-dot" aria-hidden="true"></span><span class="pl-kb-title">${esc(card.title)}</span></span>`
    + (pct === null ? "" : `<span class="pl-kb-meter" aria-hidden="true"><i style="width: ${pct}%"></i></span>`)
    + `<span class="pl-kb-meta">${meta}</span></button>`
    + `<span class="pl-anchor pl-kb-move-anchor"><button type="button" class="pl-icon-btn pl-kb-move" data-kb-move="${esc(card.uuid)}" aria-haspopup="true" aria-expanded="${open}"`
    + ` aria-label="Move ${esc(card.title)}"${flag("disabled", card.pending)}>⋯</button>${open ? renderMoveMenu(card, cell, layout) : ""}</span></div>`;
}

function renderCell(cell: KanbanCell, layout: KanbanLayout, moveOpen: string | null): string {
  const name = [cell.column.title, cell.lane?.title].filter(Boolean).join(", ");
  return `<div class="pl-kb-cell" role="list" aria-label="${esc(name)}" data-kb-cell data-kb-col="${esc(cell.column.key)}"`
    + `${cell.lane ? ` data-kb-lane="${esc(cell.lane.key)}"` : ""}${flag("data-none", cell.column.key === NO_VALUE || cell.lane?.key === NO_VALUE)}>`
    + (cell.cards.length ? cell.cards.map((c) => renderCard(c, cell, layout, moveOpen)).join("") : `<span class="pl-kb-drop" aria-hidden="true">Drop here</span>`)
    + `</div>`;
}

/** The board. `heading` names the nodes (the tag, e.g. "#Project"); `moveOpen` = uuid of the card whose Move menu is open. */
export function renderKanban(layout: KanbanLayout, heading: string, moveOpen: string | null): string {
  const columnProp = layout.columns[0].prop;
  const lanes = layout.lanes.length ? layout.lanes[0].prop.ident : "";
  return `<div class="pl-kb" data-kanban data-kb-prop="${esc(columnProp.ident)}" data-kb-lane-prop="${esc(lanes)}" role="region" aria-label="${esc(`${heading} board by ${columnProp.title}`)}"`
    + ` style="--pl-kb-cols: ${layout.columns.length}">`
    + layout.columns.map(renderHead).join("")
    + layout.rows.map((r) => (r.lane ? renderLane(r.lane) : "") + r.cells.map((c) => renderCell(c, layout, moveOpen)).join("")).join("")
    + `</div>`;
}

/** The action a click on `target` asks for, or null when it is not a Kanban control. */
export function kanbanAction(target: Element): KanbanAction | null {
  const el = target.closest<HTMLElement>("[data-kb-sort], [data-kb-to-col], [data-kb-to-lane], [data-kb-move], [data-kb-open]");
  if (!el) return null;
  const d = el.dataset;
  if (d.kbSort) return { type: "sort", sort: d.kbSort as KanbanSort };
  if (d.kbToCol !== undefined) return { type: "moveTo", uuid: d.kbCard!, column: d.kbToCol, lane: null };
  if (d.kbToLane !== undefined) return { type: "moveTo", uuid: d.kbCard!, column: null, lane: d.kbToLane };
  if (d.kbMove) return { type: "moveMenu", uuid: d.kbMove };
  return { type: "open", uuid: d.kbOpen! };
}
