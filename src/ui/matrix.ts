// Matrix view (N64): renders a `MatrixLayout` as HTML for the view area and its toolbar, and names the action a click
// means. Pure state → HTML, like kanban.ts; the workspace owns state, drag events and writes.
// One CSS grid (matrix.css): a corner and a head per band across, then per band down a head and its cells. Below it the
// Unplaced list. Hooks: `data-matrix` (`data-mx-layout` = the mode), `data-mx-xhead` / `data-mx-yhead` (band key),
// `data-mx-cell` with `data-mx-x` / `data-mx-y` (band keys; the Unplaced list is `data-mx-unplaced` with both "none"),
// cards `data-mx-card` (uuid; `draggable`, `data-mx-pending`), `data-mx-open`, `data-mx-move` and, in the open Move menu,
// `data-mx-to-x` / `data-mx-to-y` (band keys; an empty value keeps that axis); `data-mx-more` pages a cell.
// Toolbar: Across (`mx-x`), Down (`mx-y`), the mode (`data-mx-mode`), Bands (`mx-bands`: `data-mx-reverse`, `data-mx-split`),
// Labels (`mx-labels`: `data-mx-label` inputs), Show done (`data-mx-show-done`).
import { NO_VALUE } from "../core/kanban";
import type { MatrixBand, MatrixCard, MatrixCell, MatrixLayout, MatrixMode } from "../core/matrix";
import type { ChoiceProp } from "../types";
import { esc, flag, menu, options, segmented, toggleButton } from "./html";

export type MatrixAction =
  | { type: "open"; uuid: string }
  | { type: "moveMenu"; uuid: string }
  /** From the Move menu: the target band across and down; null keeps the card's band on that axis. */
  | { type: "moveTo"; uuid: string; x: string | null; y: string | null }
  | { type: "mode"; mode: MatrixMode }
  | { type: "showDone" }
  /** Bands: one value more (+1) or fewer (−1) in an axis's first band. */
  | { type: "split"; axis: "x" | "y"; delta: number }
  | { type: "more"; cell: string };

/** A cell renders this many cards at first and per "Show more" (as the Kanban's cells). */
export const MATRIX_CELL_PAGE = 50;

/** A cell's key for the per-cell card limit. */
export const matrixCellKey = (x: string, y: string): string => `${x}|${y}`;
const UNPLACED_KEY = matrixCellKey(NO_VALUE, NO_VALUE);

/** An axis as the Bands menu shows it: its property, direction and first band (value uuids; gone ones ignored). */
export interface MatrixToolbarAxis {
  prop: ChoiceProp;
  reverse: boolean;
  first: readonly string[];
}

export interface MatrixToolbarInput {
  layout: MatrixLayout;
  choiceProps: ChoiceProp[];
  /** Each axis in its order with its first band, for the Bands menu. */
  axes: { x: MatrixToolbarAxis; y: MatrixToolbarAxis };
  /** The saved labels ("" = default) and the defaults. */
  labels: readonly string[];
  defaults: readonly string[];
  showDone: boolean;
  popover: string | null;
}

function bandsPopover(t: MatrixToolbarInput): string {
  const axis = (which: "x" | "y", name: string) => {
    const a = t.axes[which];
    const values = a.reverse ? [...a.prop.values].reverse() : a.prop.values;
    const inFirst = values.map((v) => a.first.includes(v.uuid));
    const count = inFirst.filter(Boolean).length;
    const chips = values.map((v, i) => `<span class="pl-mx-chip"${flag("data-first", inFirst[i])}${flag("data-cut", i > 0 && inFirst[i - 1] && !inFirst[i])}>${esc(v.title)}</span>`).join("");
    return `<fieldset class="pl-mx-axis" data-mx-axis="${which}"><legend>${esc(name)}: ${esc(a.prop.title)}</legend>`
      + `<label class="pl-row"><input type="checkbox" data-mx-reverse="${which}"${flag("checked", a.reverse)}> Reverse order</label>`
      + `<div class="pl-mx-chips">${chips}</div>`
      + `<div class="pl-mx-step"><span>First band</span>`
      + `<button type="button" class="pl-btn" data-mx-split="${which}:-1" aria-label="One value fewer in the first ${esc(a.prop.title)} band"${flag("disabled", count <= 1)}>−</button>`
      + `<b>${count} of ${values.length}</b>`
      + `<button type="button" class="pl-btn" data-mx-split="${which}:1" aria-label="One value more in the first ${esc(a.prop.title)} band"${flag("disabled", count >= values.length - 1)}>+</button></div></fieldset>`;
  };
  return axis("x", "Across") + axis("y", "Down") + `<p class="pl-hint">Saved with the view. A value added to the property later joins the second band.</p>`;
}

function labelsPopover(t: MatrixToolbarInput): string {
  const names = ["Top left", "Top right", "Bottom left", "Bottom right"];
  return names.map((n, i) => `<label class="pl-mx-label-field"><span>${n}</span><input class="pl-input" data-mx-label="${i}" value="${esc(t.labels[i] ?? "")}" placeholder="${esc(t.defaults[i])}" autocomplete="off"></label>`).join("")
    + `<p class="pl-hint">Leave a name empty for the default. Saved with the view.</p>`;
}

export function renderMatrixToolbar(t: MatrixToolbarInput): string {
  const { layout } = t;
  const list = (label: string, other: string) => () =>
    options(label, t.choiceProps.filter((p) => p.ident !== other).map((p) => ({ value: p.ident, text: p.title })), label === "Across" ? layout.x.prop.ident : layout.y.prop.ident);
  const quadrants = layout.mode === "quadrants";
  return menu("mx-x", t.popover === "mx-x", "Across", esc(layout.x.prop.title), list("Across", layout.y.prop.ident))
    + menu("mx-y", t.popover === "mx-y", "Down", esc(layout.y.prop.title), list("Down", layout.x.prop.ident))
    + segmented("Matrix layout", "mx-mode", [["quadrants", "Quadrants"], ["values", "Every value"]], layout.mode)
    + (quadrants ? menu("mx-bands", t.popover === "mx-bands", "Bands", `${layout.x.bands[0].values.length} · ${layout.y.bands[0].values.length}`, () => bandsPopover(t)) : "")
    + (quadrants ? menu("mx-labels", t.popover === "mx-labels", "Labels", t.labels.some(Boolean) ? "Custom" : "Default", () => labelsPopover(t)) : "")
    + toggleButton("Show done", "mx-show-done", t.showDone)
    + (layout.doneHidden && !t.showDone ? `<span class="pl-hint" data-mx-done-hidden>${layout.doneHidden} done hidden</span>` : "")
    + `<span class="pl-spacer"></span><span class="pl-hint">Drag a card, or use its ⋯ menu, to change ${esc(layout.x.prop.title)} or ${esc(layout.y.prop.title)}</span>`;
}

/** The Move menu's targets: the four quadrants, or one list per axis in "values" mode; then Unplaced. */
function renderMoveMenu(card: MatrixCard, layout: MatrixLayout, cell: { x: string; y: string }): string {
  const target = (x: string, y: string, text: string, current: boolean) =>
    `<button type="button" role="option" class="pl-row" data-mx-to-x="${esc(x)}" data-mx-to-y="${esc(y)}" data-mx-card="${esc(card.uuid)}" aria-selected="${current}">${esc(text)}</button>`;
  const unplaced = target(NO_VALUE, NO_VALUE, "Unplaced", cell.x === NO_VALUE && cell.y === NO_VALUE);
  if (layout.mode === "quadrants") {
    const quads = layout.rows.flat().map((c) => target(c.x.key, c.y.key, c.label ?? "", c.x.key === cell.x && c.y.key === cell.y)).join("");
    return `<div class="pl-popover pl-mx-move-menu" data-popover="mx-move"><div role="listbox" aria-label="Move to">${quads}${unplaced}</div></div>`;
  }
  const axis = (which: "x" | "y") => {
    const a = layout[which];
    const current = which === "x" ? cell.x : cell.y;
    return `<p class="pl-kb-move-head">${esc(a.prop.title)}</p><div role="listbox" aria-label="${esc(a.prop.title)}">${a.bands
      .map((b) => target(which === "x" ? b.key : "", which === "y" ? b.key : "", b.title, b.key === current)).join("")}</div>`;
  };
  return `<div class="pl-popover pl-mx-move-menu" data-popover="mx-move">${axis("x")}${axis("y")}<div role="listbox" aria-label="Unplaced">${unplaced}</div></div>`;
}

function renderCard(card: MatrixCard, layout: MatrixLayout, cell: { x: string; y: string }, moveOpen: string | null): string {
  const meta = [card.x?.title ?? `No ${layout.x.prop.title}`, card.y?.title ?? `No ${layout.y.prop.title}`, card.when];
  const open = moveOpen === card.uuid;
  return `<div role="listitem" class="pl-mx-card" data-mx-card="${esc(card.uuid)}" data-cat="${card.cat}" draggable="${!card.pending}"`
    + `${flag("data-mx-pending", card.pending)}${card.pending ? ' aria-busy="true"' : ""}${flag("data-done", card.done)}${flag("data-late", card.late)}>`
    + `<button type="button" class="pl-mx-open" data-mx-open="${esc(card.uuid)}" aria-label="${esc(card.label)}" title="${esc(card.label)}">`
    + `<span class="pl-mx-title">${esc(card.title)}</span><span class="pl-mx-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</span></button>`
    + `<span class="pl-anchor pl-mx-move-anchor"><button type="button" class="pl-icon-btn pl-mx-move" data-mx-move="${esc(card.uuid)}" aria-haspopup="true" aria-expanded="${open}"`
    + ` aria-label="Move ${esc(card.title)}"${flag("disabled", card.pending)}>⋯</button>${open ? renderMoveMenu(card, layout, cell) : ""}</span></div>`;
}

/** The cards a list renders: the first `limit`, plus any later one that is pending or has its Move menu open. */
const shownCards = (cards: MatrixCard[], limit: number, moveOpen: string | null) => cards.filter((c, i) => i < limit || c.pending || c.uuid === moveOpen);

function cards(list: MatrixCard[], key: string, layout: MatrixLayout, at: { x: string; y: string }, moveOpen: string | null, limits: ReadonlyMap<string, number>): string {
  const shown = shownCards(list, limits.get(key) ?? MATRIX_CELL_PAGE, moveOpen);
  const rest = list.length - shown.length;
  const page = Math.min(rest, MATRIX_CELL_PAGE);
  return shown.map((c) => renderCard(c, layout, at, moveOpen)).join("")
    + (rest > 0 ? `<button type="button" class="pl-btn pl-mx-more" data-mx-more="${esc(key)}" data-rest="${rest}">Show ${page} more${rest > page ? ` of ${rest.toLocaleString("en-US")}` : ""}</button>` : "");
}

function renderCell(cell: MatrixCell, layout: MatrixLayout, moveOpen: string | null, limits: ReadonlyMap<string, number>): string {
  const at = { x: cell.x.key, y: cell.y.key };
  const name = cell.label ?? `${cell.y.title}, ${cell.x.title}`;
  return `<div class="pl-mx-cell" role="list" aria-label="${esc(name)}" data-mx-cell data-mx-x="${esc(at.x)}" data-mx-y="${esc(at.y)}"${flag("data-mx-closed", !cell.x.drop || !cell.y.drop)}>`
    + `<div class="pl-mx-cell-head">${cell.label === null ? "" : `<span class="pl-mx-label">${esc(cell.label)}</span>`}<span class="pl-mx-count">${cell.cards.length}</span></div>`
    + cards(cell.cards, matrixCellKey(at.x, at.y), layout, at, moveOpen, limits)
    + `</div>`;
}

const bandHead = (b: MatrixBand, which: "x" | "y") => `<div class="pl-mx-${which}head" data-mx-${which}head="${esc(b.key)}">${esc(b.title || "(no values)")}</div>`;

/**
 * The grid and the Unplaced list. `heading` names the nodes; `moveOpen` = uuid of the card whose Move menu is open;
 * `limits` = cards to render per cell by `matrixCellKey` (absent = `MATRIX_CELL_PAGE`).
 */
export function renderMatrix(layout: MatrixLayout, heading: string, moveOpen: string | null, limits: ReadonlyMap<string, number>): string {
  const grid = `<div class="pl-mx" data-matrix data-mx-layout="${layout.mode}" role="region" aria-label="${esc(`${heading} by ${layout.y.prop.title} and ${layout.x.prop.title}`)}"`
    + ` style="--pl-mx-cols: ${layout.x.bands.length}">`
    + `<div class="pl-mx-corner" aria-hidden="true"><span>${esc(layout.y.prop.title)} ↓</span><span>${esc(layout.x.prop.title)} →</span></div>`
    + layout.x.bands.map((b) => bandHead(b, "x")).join("")
    + layout.rows.map((row, i) => bandHead(layout.y.bands[i], "y") + row.map((c) => renderCell(c, layout, moveOpen, limits)).join("")).join("")
    + `</div>`;
  const at = { x: NO_VALUE, y: NO_VALUE };
  const list = `<section class="pl-mx-unplaced" role="list" aria-label="Unplaced" data-mx-unplaced data-mx-cell data-mx-x="${NO_VALUE}" data-mx-y="${NO_VALUE}">`
    + `<div class="pl-mx-cell-head"><span class="pl-mx-label">Unplaced</span><span class="pl-mx-count">${layout.unplaced.length}</span></div>`
    + `<p class="pl-hint">Without a value for ${esc(layout.x.prop.title)} or ${esc(layout.y.prop.title)}, by due date.<span data-mx-drag-hint> Drag a card into the grid, or use its ⋯ menu.</span></p>`
    + `<div class="pl-mx-list">${cards(layout.unplaced, UNPLACED_KEY, layout, at, moveOpen, limits)}</div></section>`;
  return grid + list;
}

/** The action a click on `target` asks for, or null when it is not a Matrix control. */
export function matrixAction(target: Element): MatrixAction | null {
  const el = target.closest<HTMLElement>("[data-mx-to-x], [data-mx-move], [data-mx-more], [data-mx-open], [data-mx-mode], [data-mx-show-done], [data-mx-split]");
  if (!el) return null;
  const d = el.dataset;
  if (d.mxToX !== undefined) return { type: "moveTo", uuid: d.mxCard!, x: d.mxToX || null, y: d.mxToY || null };
  if (d.mxMove) return { type: "moveMenu", uuid: d.mxMove };
  if (d.mxMore !== undefined) return { type: "more", cell: d.mxMore };
  if (d.mxMode) return { type: "mode", mode: d.mxMode as MatrixMode };
  if (d.mxShowDone !== undefined) return { type: "showDone" };
  if (d.mxSplit) {
    const [axis, delta] = d.mxSplit.split(":");
    return { type: "split", axis: axis as "x" | "y", delta: Number(delta) };
  }
  return { type: "open", uuid: d.mxOpen! };
}
