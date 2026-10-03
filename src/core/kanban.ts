// Kanban board model (T11): columns from a choice property's closed values plus "No <prop>", optional swimlanes from a
// second choice property plus "No <prop>", cards sorted inside each cell, and the property writes a move needs.
// Pure apart from `writeMove`, which takes the SDK calls injected (`KanbanWriteDeps`). No DOM, no clock.
//
// Rules:
// - Columns (and lanes) list every closed value in the property's order, whatever the filters, then the "No <prop>"
//   column (lane), which is always there: it is the drop target that removes the value.
// - Sort inside a cell: "due" = the node's resolved span end (End, a one-date point, or derived from its tasks),
//   undated last; "priority" = the tag's Priority choice (`priorityProp`): built-in Priority values are ordered Low,
//   Medium, High, Urgent, so the LAST value ranks highest; no value last; "title". Ties: due, then title.
// - A card is done when any of its choice values is done (`isDone` with the view's done values, as in the Agenda); a
//   column is done when its value is. An open card past its end is late.
// - Writes follow what T01 observed live (docs/probes.md, writes.json) and nothing else: `upsertBlockProperty(uuid,
//   <full ident without the leading colon>, <closed value entity id>)`, `removeBlockProperty(uuid, <same key>)`. Both
//   resolve null on success and on failure, so every write is read back and a mismatch throws. A removal reads back as
//   either no attribute (user property) or the empty placeholder entity (built-in Status, seen live in T11).
import type { ChoiceProp, ClosedValue, KanbanWriteDeps, LocalDate, PlannerNode, Rollup } from "../types";
import { displayTitle } from "./display-title";
import { categoryOf, compareDates, daysBetween, formatDate, type ViewItem } from "./layout-common";
import { isDone } from "./nodes";
import { isEmptyPlaceholder } from "./normalize";

/** Key of the "No <prop>" column and lane (closed values are keyed by uuid, which is never this). */
export const NO_VALUE = "none";

export type KanbanSort = "due" | "priority" | "title";

/** A column or a lane: one closed value of a property, or "No <prop>". */
export interface KanbanSlot {
  /** The value's uuid, or `NO_VALUE`. */
  key: string;
  prop: { ident: string; title: string };
  /** Null for "No <prop>". */
  value: ClosedValue | null;
  title: string;
  /** Cards in this column (all lanes) or lane (all columns). */
  count: number;
  /** The value counts as done under the view's done values (always false for "No <prop>"). */
  done: boolean;
}

export interface KanbanCard {
  uuid: string;
  /** Display title (inline refs resolved). */
  title: string;
  cat: number;
  done: boolean;
  late: boolean;
  /** The resolved span end; null when undated. */
  due: LocalDate | null;
  /** "ends 23 Oct", "8 Oct", "ends 8 Oct, 2 days late", "no date". */
  when: string;
  progress: Rollup;
  /** Values of the tag's other choice properties (not the column, lane or priority property), in property order. */
  meta: string[];
  /** The node's Priority value (`key` = last ident segment for built-ins, else the lower-case title). */
  priority: { title: string; key: string } | null;
  /** Its move is being written: shown in the target, not draggable. */
  pending: boolean;
  /** Accessible name. */
  label: string;
}

export interface KanbanCell {
  column: KanbanSlot;
  /** Null when the board has no swimlanes. */
  lane: KanbanSlot | null;
  cards: KanbanCard[];
}

export interface KanbanLayout {
  columns: KanbanSlot[];
  /** Empty without swimlanes. */
  lanes: KanbanSlot[];
  /** One row per lane (a single row with `lane: null` without swimlanes), each with one cell per column. */
  rows: { lane: KanbanSlot | null; cells: KanbanCell[] }[];
  sort: KanbanSort;
}

export interface KanbanInput {
  items: ViewItem[];
  columnProp: ChoiceProp;
  laneProp: ChoiceProp | null;
  sort: KanbanSort;
  today: string;
  /** The tag's choice properties (card meta, priority, done). */
  choiceProps: ChoiceProp[];
  /** The view's done override: closed-value uuids by choice property ident. */
  doneValues: Record<string, string[]>;
  /** Titles of the loaded nodes by uuid (`titlesByUuid`). */
  titles: ReadonlyMap<string, string>;
  /** Uuids of the nodes whose move is being written. */
  pending: ReadonlySet<string>;
}

/** One property write of a move. `node` is the node's display title (for error messages). */
export type PropertyWrite = { uuid: string; node: string; prop: { ident: string; title: string } } & (
  | { kind: "set"; value: ClosedValue }
  | { kind: "remove" }
);

const PRIORITY_IDENT = ":logseq.property/priority";

/** The tag's Priority choice property: the built-in one, else one titled "Priority"; null when it has none. */
export const priorityProp = (tag: { choiceProps: ChoiceProp[] }): ChoiceProp | null =>
  tag.choiceProps.find((p) => p.ident === PRIORITY_IDENT) ?? tag.choiceProps.find((p) => p.title.trim().toLowerCase() === "priority") ?? null;

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

function slots(prop: ChoiceProp, doneValues: Record<string, string[]>): KanbanSlot[] {
  const ref = { ident: prop.ident, title: prop.title };
  return [
    ...prop.values.map((v) => ({ key: v.uuid, prop: ref, value: v, title: v.title, count: 0, done: isDone(v, doneValues[prop.ident]) })),
    { key: NO_VALUE, prop: ref, value: null, title: `No ${prop.title}`, count: 0, done: false },
  ];
}

const keyOf = (node: PlannerNode, prop: ChoiceProp) => node.choices[prop.ident]?.uuid ?? NO_VALUE;

export function layoutKanban(input: KanbanInput): KanbanLayout {
  const { columnProp, laneProp, today } = input;
  const priority = priorityProp(input);
  const columns = slots(columnProp, input.doneValues);
  const lanes = laneProp ? slots(laneProp, input.doneValues) : [];
  const rank = (c: KanbanCard) => (c.priority && priority ? priority.values.findIndex((v) => v.title === c.priority!.title) : -1);
  const byDue = (a: KanbanCard, b: KanbanCard) => (a.due ? (b.due ? compareDates(a.due, b.due) : -1) : b.due ? 1 : 0);
  const byTitle = (a: KanbanCard, b: KanbanCard) => a.title.localeCompare(b.title);
  const order = {
    due: (a: KanbanCard, b: KanbanCard) => byDue(a, b) || byTitle(a, b),
    priority: (a: KanbanCard, b: KanbanCard) => rank(b) - rank(a) || byDue(a, b) || byTitle(a, b),
    title: (a: KanbanCard, b: KanbanCard) => byTitle(a, b) || byDue(a, b),
  }[input.sort];

  const toCard = (item: ViewItem): KanbanCard => {
    const { node, span, progress } = item;
    const title = displayTitle(node.title, input.titles);
    const done = Object.entries(node.choices).some(([ident, v]) => isDone(v, input.doneValues[ident]));
    const due = span.end;
    const late = !done && !!due && due.day < today;
    const point = !!span.start && !!due && span.start.day === due.day && span.start.time === due.time;
    const when = !due ? "no date" : `${point ? "" : "ends "}${formatDate(due)}${late ? `, ${plural(daysBetween(due.day, today))} late` : ""}`;
    const own = new Set([columnProp.ident, laneProp?.ident, priority?.ident]);
    const meta = input.choiceProps.filter((p) => !own.has(p.ident)).map((p) => node.choices[p.ident]?.title).filter((t): t is string => !!t);
    const pv = priority ? node.choices[priority.ident] : undefined;
    const pri = pv ? { title: pv.title, key: pv.ident ? pv.ident.split(".").pop()! : pv.title.trim().toLowerCase() } : null;
    const label = [title, when, progress.total ? `${progress.done} of ${progress.total} tasks done` : "", pri && `${pri.title} priority`, ...meta, done && "done"]
      .filter(Boolean).join(", ");
    return { uuid: node.uuid, title, cat: categoryOf(node.uuid), done, late, due, when, progress, meta, priority: pri, pending: input.pending.has(node.uuid), label };
  };

  const rows = (laneProp ? lanes : [null]).map((lane) => ({ lane, cells: columns.map((column): KanbanCell => ({ column, lane, cards: [] })) }));
  for (const item of input.items) {
    const ci = columns.findIndex((c) => c.key === keyOf(item.node, columnProp));
    const li = laneProp ? lanes.findIndex((l) => l.key === keyOf(item.node, laneProp)) : 0;
    rows[li].cells[ci].cards.push(toCard(item));
    columns[ci].count++;
    if (laneProp) lanes[li].count++;
  }
  for (const r of rows) for (const c of r.cells) c.cards.sort(order);
  return { columns, lanes, rows, sort: input.sort };
}

/** The cell at column `column` and lane `lane` (null without swimlanes); throws when there is none. */
export function findCell(layout: KanbanLayout, column: string, lane: string | null): KanbanCell {
  const row = layout.rows.find((r) => (r.lane?.key ?? null) === lane);
  const cell = row?.cells.find((c) => c.column.key === column);
  if (!cell) throw new Error(`No Kanban cell for column ${column}${lane === null ? "" : ` and lane ${lane}`}`);
  return cell;
}

/** The card with `uuid` and the cell it is in; throws when it is not on the board. */
export function cardCell(layout: KanbanLayout, uuid: string): { card: KanbanCard; cell: KanbanCell } {
  for (const r of layout.rows) {
    for (const cell of r.cells) {
      const card = cell.cards.find((c) => c.uuid === uuid);
      if (card) return { card, cell };
    }
  }
  throw new Error(`No Kanban card ${uuid}`);
}

const write = (card: KanbanCard, slot: KanbanSlot): PropertyWrite =>
  slot.value
    ? { kind: "set", uuid: card.uuid, node: card.title, prop: slot.prop, value: slot.value }
    : { kind: "remove", uuid: card.uuid, node: card.title, prop: slot.prop };

/** The writes that move `card` from `from` to `to`: the column property when it changes, then the lane property when it does. */
export function moveDescriptor(card: KanbanCard, from: KanbanCell, to: KanbanCell): PropertyWrite[] {
  const writes: PropertyWrite[] = [];
  if (from.column.key !== to.column.key) writes.push(write(card, to.column));
  if (from.lane && to.lane && from.lane.key !== to.lane.key) writes.push(write(card, to.lane));
  return writes;
}

/** A copy of `node` with `writes` applied: where the card shows while its move is written. */
export function movedNode(node: PlannerNode, writes: PropertyWrite[]): PlannerNode {
  const choices = { ...node.choices };
  for (const w of writes) {
    if (w.kind === "set") choices[w.prop.ident] = w.value;
    else delete choices[w.prop.ident];
  }
  return { ...node, choices };
}

/** The property key the write calls take: the full ident without its leading colon (the form T01's working calls used). */
export const writeKey = (ident: string): string => ident.replace(/^:/, "");

/** Writes a move in order, reading each property back; throws on the first write the graph does not hold. */
export async function writeMove(deps: KanbanWriteDeps, writes: PropertyWrite[]): Promise<void> {
  for (const w of writes) {
    const key = writeKey(w.prop.ident);
    if (w.kind === "set") await deps.upsertBlockProperty(w.uuid, key, w.value.id);
    else await deps.removeBlockProperty(w.uuid, key);
    const read = await deps.readChoice(w.uuid, w.prop.ident);
    // No value = the attribute is gone (user properties) or points at the empty placeholder (built-in Status, seen live).
    const stored = read === null || isEmptyPlaceholder(read) ? null : read.id;
    if (w.kind === "set" && stored !== w.value.id) {
      throw new Error(`${w.prop.title} of "${w.node}" was not saved as ${w.value.title} (read back differs). The board shows what the graph holds.`);
    }
    if (w.kind === "remove" && stored !== null) {
      throw new Error(`${w.prop.title} of "${w.node}" was not removed (read back still has a value). The board shows what the graph holds.`);
    }
  }
}
