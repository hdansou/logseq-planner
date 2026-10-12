// Matrix model (N64): two choice properties as axes, each split into bands, nodes filed by the band of each value.
// Pure: no DOM, no SDK, no clock. Moves are `PropertyWrite`s, written by the Kanban's `writeMove` (same read-back and
// roll-back).
//
// Rules:
// - An axis lists its property's closed values in the property's order, or reversed (`reverse`). In "quadrants" mode
//   it has two bands: the values whose uuids are in `first` (in the axis's order), then every other value. Membership is
//   by uuid, so a value added to the property later joins the second band, and a uuid that is gone is ignored. In
//   "values" mode every value is its own band.
// - A card is in the cell of its two bands. A card without a value on either axis is unplaced. A done card (any
//   done choice value, `isNodeDone`) is left out unless `showDone`, and counted.
// - A move writes, per axis whose band changes, the target band's first value (its `drop`); a card that stays in its
//   band keeps its own value. To Unplaced (`NO_VALUE` on both axes) removes the values the card has.
// - A card's date drops a 00:00 time, as the Agenda's does (N62).
// - Cards sort by due date (the resolved span end), undated last, then title.
import type { ChoiceProp, ClosedValue, LocalDate, Rollup } from "../types";
import { withoutMidnight } from "./agenda";
import { displayTitle } from "./display-title";
import { priorityProp } from "./fields";
import { NO_VALUE, type PropertyWrite } from "./kanban";
import { categoryOf, compareDates, dayCount, daysBetween, formatDate, type ViewItem } from "./layout-common";
import { isNodeDone } from "./nodes";

export const MATRIX_MODES = ["quadrants", "values"] as const;
export type MatrixMode = (typeof MATRIX_MODES)[number];

/** A saved axis: the choice property (ident), its direction, and the value uuids of its first band (quadrants). */
export interface MatrixAxisConfig {
  prop: string;
  reverse: boolean;
  first: string[];
}

/** An axis with its property resolved. */
export interface MatrixAxisInput {
  prop: ChoiceProp;
  reverse: boolean;
  first: readonly string[];
}

/**
 * Named pairs: the property titles each axis is matched by (lower case, a prefix match) and the quadrant labels, in the
 * order top left, top right, bottom left, bottom right.
 */
export const MATRIX_PRESETS = {
  eisenhower: { x: ["urgen"], y: ["importan"], labels: ["Do first", "Schedule", "Delegate", "Eliminate"] },
  impactEffort: { x: ["effort", "size"], y: ["impact", "value"], labels: ["Quick wins", "Big bets", "Fill-ins", "Money pits"] },
} as const;

const named = (p: ChoiceProp, prefixes: readonly string[]) => prefixes.some((x) => p.title.trim().toLowerCase().startsWith(x));

/** The axis's values in its order. */
const ordered = (a: MatrixAxisInput): ClosedValue[] => (a.reverse ? [...a.prop.values].reverse() : a.prop.values);

/** The default first band of `prop` in the given direction: the first half of its values (the smaller half for an odd count), at least one. */
export function defaultFirst(prop: ChoiceProp, reverse: boolean): string[] {
  const values = reverse ? [...prop.values].reverse() : prop.values;
  return values.slice(0, Math.max(1, Math.floor(values.length / 2))).map((v) => v.uuid);
}

/**
 * The axes a new Matrix view starts with: a preset's pair when the properties are named for it (Urgency across and
 * Importance down; Effort across and Impact down), else Priority (or the first property) down and the next one across.
 * Priority runs high end first (the built-in values are ordered Low to Urgent). Null with fewer than two properties.
 */
export function defaultMatrixAxes(choiceProps: ChoiceProp[]): { x: MatrixAxisConfig; y: MatrixAxisConfig } | null {
  if (choiceProps.length < 2) return null;
  let x: ChoiceProp | undefined;
  let y: ChoiceProp | undefined;
  for (const preset of Object.values(MATRIX_PRESETS)) {
    const px = choiceProps.find((p) => named(p, preset.x));
    const py = choiceProps.find((p) => named(p, preset.y));
    if (px && py && px !== py) {
      x = px;
      y = py;
      break;
    }
  }
  if (!x || !y) {
    y = priorityProp({ choiceProps }) ?? choiceProps[0];
    x = choiceProps.find((p) => p !== y)!;
  }
  const axis = (p: ChoiceProp): MatrixAxisConfig => {
    const reverse = p === priorityProp({ choiceProps });
    return { prop: p.ident, reverse, first: defaultFirst(p, reverse) };
  };
  return { x: axis(x), y: axis(y) };
}

/** A band of an axis: its values in the axis's order; `drop` = the value a move into it writes (null when it has none). */
export interface MatrixBand {
  /** "first" / "second" in quadrants, the value's uuid in "values". */
  key: string;
  title: string;
  values: ClosedValue[];
  drop: ClosedValue | null;
}

export interface MatrixAxis {
  prop: { ident: string; title: string };
  bands: MatrixBand[];
}

/** The bands of `axis` in `mode` (see the rules above). */
export function axisBands(axis: MatrixAxisInput, mode: MatrixMode): MatrixBand[] {
  const values = ordered(axis);
  const band = (key: string, vs: ClosedValue[]): MatrixBand => ({ key, title: vs.map((v) => v.title).join(", "), values: vs, drop: vs[0] ?? null });
  if (mode === "values") return values.map((v) => band(v.uuid, [v]));
  const first = new Set(axis.first);
  return [band("first", values.filter((v) => first.has(v.uuid))), band("second", values.filter((v) => !first.has(v.uuid)))];
}

export interface MatrixCard {
  uuid: string;
  title: string;
  cat: number;
  done: boolean;
  late: boolean;
  due: LocalDate | null;
  /** "8 Oct", "ends 23 Oct", "8 Oct, 2 days late", "no date". */
  when: string;
  progress: Rollup;
  /** Its value on each axis (null = none). */
  x: ClosedValue | null;
  y: ClosedValue | null;
  pending: boolean;
  label: string;
}

export interface MatrixCell {
  x: MatrixBand;
  y: MatrixBand;
  /** The quadrant's label (quadrants mode); null in "values" mode. */
  label: string | null;
  cards: MatrixCard[];
}

export interface MatrixLayout {
  mode: MatrixMode;
  x: MatrixAxis;
  y: MatrixAxis;
  /** One row per band down, one cell per band across. */
  rows: MatrixCell[][];
  /** Cards without a value on either axis. */
  unplaced: MatrixCard[];
  /** Done cards left out (Show done off). */
  doneHidden: number;
}

export interface MatrixInput {
  items: ViewItem[];
  x: MatrixAxisInput;
  y: MatrixAxisInput;
  mode: MatrixMode;
  showDone: boolean;
  /** Four labels, top left to bottom right; "" = the default. */
  labels: readonly string[];
  today: string;
  doneValues: Record<string, string[]>;
  titles: ReadonlyMap<string, string>;
  pending: ReadonlySet<string>;
}

/** The label a quadrant shows when the user has not named it: the preset's when the axes are named for one, else its two bands. */
function defaultLabel(input: MatrixInput, y: MatrixBand, x: MatrixBand, i: number): string {
  for (const preset of Object.values(MATRIX_PRESETS)) {
    if (named(input.x.prop, preset.x) && named(input.y.prop, preset.y)) return preset.labels[i];
  }
  return `${y.title || "—"} · ${x.title || "—"}`;
}

export function layoutMatrix(input: MatrixInput): MatrixLayout {
  const { mode, today } = input;
  const xBands = axisBands(input.x, mode);
  const yBands = axisBands(input.y, mode);
  const rows: MatrixCell[][] = yBands.map((y, b) => xBands.map((x, a) => ({
    x, y, cards: [],
    label: mode === "quadrants" ? input.labels[b * 2 + a]?.trim() || defaultLabel(input, y, x, b * 2 + a) : null,
  })));
  const unplaced: MatrixCard[] = [];
  let doneHidden = 0;
  const bandOf = (bands: MatrixBand[], v: ClosedValue | null) => (v ? bands.findIndex((b) => b.values.some((x) => x.uuid === v.uuid)) : -1);

  for (const { node, span, progress } of input.items) {
    const done = isNodeDone(node, input.doneValues);
    if (done && !input.showDone) {
      doneHidden++;
      continue;
    }
    const title = displayTitle(node.title, input.titles);
    const due = span.end;
    const late = !done && !!due && due.day < today;
    const point = !!span.start && !!due && span.start.day === due.day && span.start.time === due.time;
    const when = !due ? "no date" : `${point || !span.start ? "" : "ends "}${withoutMidnight(formatDate(due))}${late ? `, ${dayCount(daysBetween(due.day, today))} late` : ""}`;
    const x = node.choices[input.x.prop.ident] ?? null;
    const y = node.choices[input.y.prop.ident] ?? null;
    const label = [title, when, x && `${input.x.prop.title} ${x.title}`, y && `${input.y.prop.title} ${y.title}`, done && "done"].filter(Boolean).join(", ");
    const card: MatrixCard = { uuid: node.uuid, title, cat: categoryOf(node.uuid), done, late, due, when, progress, x, y, pending: input.pending.has(node.uuid), label };
    const a = bandOf(xBands, x);
    const b = bandOf(yBands, y);
    if (a < 0 || b < 0) unplaced.push(card);
    else rows[b][a].cards.push(card);
  }
  const byDue = (p: MatrixCard, q: MatrixCard) => (p.due ? (q.due ? compareDates(p.due, q.due) : -1) : q.due ? 1 : 0);
  const order = (p: MatrixCard, q: MatrixCard) => byDue(p, q) || p.title.localeCompare(q.title);
  for (const row of rows) for (const cell of row) cell.cards.sort(order);
  unplaced.sort(order);
  const axis = (a: MatrixAxisInput, bands: MatrixBand[]): MatrixAxis => ({ prop: { ident: a.prop.ident, title: a.prop.title }, bands });
  return { mode, x: axis(input.x, xBands), y: axis(input.y, yBands), rows, unplaced, doneHidden };
}

/** The card with `uuid`, in a cell or unplaced; throws when it is not in the layout. */
export function matrixCard(layout: MatrixLayout, uuid: string): MatrixCard {
  const card = [...layout.rows.flat().flatMap((c) => c.cards), ...layout.unplaced].find((c) => c.uuid === uuid);
  if (!card) throw new Error(`No Matrix card ${uuid}`);
  return card;
}

/**
 * The writes that move the card `uuid` to the band `xKey` across and `yKey` down (`NO_VALUE` on both = Unplaced): see
 * the rules at the top. Throws for an unknown band or a band without values.
 */
export function matrixMove(layout: MatrixLayout, uuid: string, xKey: string, yKey: string): PropertyWrite[] {
  const card = matrixCard(layout, uuid);
  const writes: PropertyWrite[] = [];
  const one = (axis: MatrixAxis, current: ClosedValue | null, key: string) => {
    if (key === NO_VALUE) {
      if (current) writes.push({ kind: "remove", uuid, node: card.title, prop: axis.prop, previous: current });
      return;
    }
    const band = axis.bands.find((b) => b.key === key);
    if (!band) throw new Error(`No ${axis.prop.title} band ${key}`);
    if (current && band.values.some((v) => v.uuid === current.uuid)) return;
    if (!band.drop) throw new Error(`"${card.title}" cannot move there: that ${axis.prop.title} band has no values.`);
    writes.push({ kind: "set", uuid, node: card.title, prop: axis.prop, value: band.drop, previous: current });
  };
  one(layout.x, card.x, xKey);
  one(layout.y, card.y, yKey);
  return writes;
}
