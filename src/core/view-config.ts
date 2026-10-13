// Saved-view configuration: type, defaults, validation, JSON (de)serialisation. Pure: no DOM, no SDK.
// Everything stored is graph-portable: tags and properties by ident, closed values by uuid (entity ids differ per device).
import type { ChoiceFilters, ChoiceProp, NodeProp, TagInfo } from "../types";
import { priorityProp } from "./kanban";
import { WHEN_KEY } from "./when";
import { defaultMatrixAxes, MATRIX_MODES, type MatrixAxisConfig } from "./matrix";
import { mergeTags, TAG_KEY, type ViewTags } from "./schema";

export { TAG_KEY };

export const VIEW_KINDS = ["timeline", "calendar", "agenda", "kanban", "matrix"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

const ZOOMS = ["day", "week", "month", "quarter"] as const;
const LAYOUTS = ["month", "week", "3days", "day"] as const;
const GROUPS = ["node", "date"] as const;
const SORTS = ["due", "priority", "title"] as const;
/** Timeline row order with two or more tags (N14): by date, a heading per tag, or children nested under their parent. */
export const ARRANGES = ["date", "tag", "nested"] as const;
export type Arrange = (typeof ARRANGES)[number];


/** A tag's Start / End mapping: Date or DateTime property idents; null = not mapped (a tag without dates, or no End). */
export interface DateMapping {
  start: string | null;
  end: string | null;
}

/** Saved closed-value selection by choice property ident: value uuids, `null` = "No value" (filters only). */
export type ValueSelection = Record<string, (string | null)[]>;

interface CommonConfig {
  /** Tag idents in selection order: at least one, no duplicates (N14: a view over several tags shows their union). */
  tags: string[];
  /** Include nodes of tags that extend a selected tag (one setting for the whole view). */
  childTags: boolean;
  /** Start / End per selected tag, by tag ident: exactly one entry per tag of `tags` (N14). */
  dates: Record<string, DateMapping>;
  /** Per choice property: uuids of the closed values that count as done. Absent property = default rule (`isDone`). */
  doneValues: Record<string, string[]>;
  /**
   * Per choice property: selected value uuids, `null` = "No value". Absent or empty = no filter. Under `TAG_KEY` (two or
   * more tags): the tag idents to show.
   */
  filters: ValueSelection;
  /**
   * Node property whose values are the nodes a node depends on (N12): Timeline connectors, and those nodes' tasks no
   * longer count the node. Null = None. Absent = not chosen: the default rule applies to the view's tags now
   * (`dependsOnOf`), until the user picks a value in the menu. An ident the tag no longer has behaves as null.
   */
  dependsOn?: string | null;
}

export type ViewConfig = CommonConfig &
  (
    /** `arrange` applies with two or more tags only (a one-tag Timeline is by date). */
    | { kind: "timeline"; zoom: (typeof ZOOMS)[number]; arrange: Arrange }
    | { kind: "calendar"; layout: (typeof LAYOUTS)[number] }
    | { kind: "agenda"; groupBy: (typeof GROUPS)[number]; showDone: boolean }
    /**
     * Column property (default Status); optional swimlane property (or `TAG_KEY`); card sort. Null = the view's tags
     * share no choice property.
     * `hiddenColumns`: per column property ident, the columns not shown (closed-value uuids, `NO_VALUE` = "No <prop>"),
     * kept per property so switching the column property and back keeps each choice; unknown keys are ignored (N08).
     * `hiddenFields`: idents of the choice properties whose value a card does not show (N38); [] = all shown. Only for
     * a tag without a list of its own below.
     * `cardFields` (N42): per tag ident, the idents of the properties its cards show, in order; a tag absent here shows
     * the default (the shared choice properties less `hiddenFields`).
     */
    | { kind: "kanban"; columnProp: string | null; laneProp: string | null; sort: (typeof SORTS)[number]; hiddenColumns: Record<string, string[]>; hiddenFields: string[]; cardFields: Record<string, string[]> }
    /**
     * N64: two choice properties as axes (`x` across, `y` down; both null when the view's tags share fewer than two),
     * `mode` quadrants (each axis in two bands) or every value; done cards shown or not; `labels` = the four quadrant
     * names, top left to bottom right, "" = the default (core/matrix.ts).
     */
    | { kind: "matrix"; x: MatrixAxisConfig | null; y: MatrixAxisConfig | null; mode: (typeof MATRIX_MODES)[number]; showDone: boolean; labels: string[] }
  );

const VERSION = 1;

/** Start/End, else Scheduled/Deadline, else the first date property (REQUIREMENTS: dates from the tag's own properties). */
export function defaultDates(tag: TagInfo): DateMapping {
  const named = (title: string) => tag.dateProps.find((p) => p.title.toLowerCase() === title)?.ident ?? null;
  for (const [s, e] of [["start", "end"], ["scheduled", "deadline"]]) {
    const start = named(s);
    const end = named(e);
    if (start || end) return { start, end };
  }
  return { start: tag.dateProps[0]?.ident ?? null, end: null };
}

/** The node property titled like "depends on" (lowercased, non-alphanumerics removed: `depends_on`, "Depends on", "depends-on"), else null. */
function defaultDependsOn(tag: { nodeProps: NodeProp[] }): string | null {
  return tag.nodeProps.find((p) => p.title.toLowerCase().replace(/[^a-z0-9]/g, "") === "dependson")?.ident ?? null;
}

/**
 * The dependency property the view uses on `tag` now: the chosen one, or by the default rule when the config predates
 * the setting; null for None and for an ident the tag no longer has (no error: the view just draws no dependencies).
 */
export function dependsOnOf(config: ViewConfig, tag: { nodeProps: NodeProp[] }): string | null {
  const ident = config.dependsOn === undefined ? defaultDependsOn(tag) : config.dependsOn;
  return tag.nodeProps.some((p) => p.ident === ident) ? ident : null;
}

/** The choice property a Kanban view starts on: Status, else the first one; null when there is none. */
const defaultColumn = (choiceProps: ChoiceProp[]): string | null => (choiceProps.find((p) => p.title === "Status") ?? choiceProps[0])?.ident ?? null;

/** The Timeline arrangement a view over `count` tags starts with (N14): nested with two or more, by date with one. */
const defaultArrange = (count: number): Arrange => (count > 1 ? "nested" : "date");

/**
 * The view a user gets when they pick `tag` (or several tags, in selection order): each tag's dates by the default rule, the
 * dependency property not chosen (the default rule applies, `dependsOnOf`), nothing filtered.
 */
export function defaultViewConfig(tag: TagInfo | TagInfo[], kind: ViewKind = "timeline"): ViewConfig {
  const view = mergeTags([tag].flat());
  const common: CommonConfig = {
    tags: view.tags.map((t) => t.ident), childTags: true, dates: Object.fromEntries(view.tags.map((t) => [t.ident, defaultDates(t)])),
    doneValues: {}, filters: {},
  };
  switch (kind) {
    case "timeline":
      return { ...common, kind, zoom: "month", arrange: defaultArrange(view.tags.length) };
    case "calendar":
      return { ...common, kind, layout: "month" };
    case "agenda":
      return { ...common, kind, groupBy: "node", showDone: false };
    case "kanban":
      return { ...common, kind, columnProp: defaultColumn(view.choiceProps), laneProp: null, sort: "due", hiddenColumns: {}, hiddenFields: [], cardFields: {} };
    case "matrix":
      return { ...common, kind, ...(defaultMatrixAxes(view.choiceProps) ?? { x: null, y: null }), mode: "quadrants", showDone: false, labels: ["", "", "", ""] };
  }
}

/**
 * `config` over the tags `tags` (N14: a tag ticked or unticked, or a gone tag dropped): kept tags keep their dates, a
 * new one gets its default dates; filters, done values, the Kanban column and lane and the dependency property are kept
 * where the new tags share them, else dropped (column: the default; dependency: back to not chosen, the default rule); the Tag filter keeps
 * the tags still selected and goes, like a Tag swimlane, below two tags. The Timeline arrangement takes the default of
 * the new tag count when the view crosses between one tag and several. Throws on an empty list.
 */
export function withTags(config: ViewConfig, tags: TagInfo[]): ViewConfig {
  const view = mergeTags(tags);
  const idents = view.tags.map((t) => t.ident);
  const multi = idents.length > 1;
  const shared = new Set(view.choiceProps.map((p) => p.ident));
  const filters: ValueSelection = {};
  for (const [key, values] of Object.entries(config.filters)) {
    if (key === TAG_KEY) {
      const kept = values.filter((v) => v !== null && idents.includes(v));
      if (multi && kept.length) filters[key] = kept;
    } else if (shared.has(key)) filters[key] = values;
  }
  const doneValues = Object.fromEntries(Object.entries(config.doneValues).filter(([ident]) => shared.has(ident)));
  // A choice (an ident, or null = None) stays only while the view's tags still have the property; else, like absent, back to
  // "not chosen": the default rule applies wherever it is used (`dependsOnOf`).
  const { dependsOn, ...rest } = config;
  const kept = dependsOn === null || (dependsOn !== undefined && view.nodeProps.some((p) => p.ident === dependsOn));
  const common = {
    ...rest, tags: idents, dates: Object.fromEntries(view.tags.map((t) => [t.ident, config.dates[t.ident] ?? defaultDates(t)])),
    filters, doneValues, ...(kept ? { dependsOn } : {}),
  } as ViewConfig;
  if (common.kind === "timeline") {
    return (config.tags.length > 1) === multi ? common : { ...common, arrange: defaultArrange(idents.length) };
  }
  if (common.kind === "matrix") {
    const kept = common.x !== null && common.y !== null && shared.has(common.x.prop) && shared.has(common.y.prop);
    return kept ? common : { ...common, ...(defaultMatrixAxes(view.choiceProps) ?? { x: null, y: null }) };
  }
  if (common.kind !== "kanban") return common;
  const keep = common.columnProp === WHEN_KEY ? view.tags.some((t) => t.dateProps.length) : common.columnProp !== null && shared.has(common.columnProp);
  const columnProp = keep ? common.columnProp : defaultColumn(view.choiceProps);
  const lane = common.laneProp;
  const laneProp = lane !== null && lane !== columnProp && (lane === TAG_KEY ? multi : shared.has(lane)) ? lane : null;
  const sort = common.sort === "priority" && !priorityProp(view) ? "due" : common.sort;
  return { ...common, columnProp, laneProp, sort };
}

/**
 * `config` without the tags that are gone from the graph (N14, a saved view naming a deleted tag): their dates go with
 * them (`withTags`). Returns `config` itself when every tag is known; throws "unknown tag" when none is left, so the
 * caller's unknown-tag fallback (the default view) applies.
 */
export function withKnownTags(config: ViewConfig, tags: TagInfo[]): ViewConfig {
  const known = config.tags.map((ident) => tags.find((t) => t.ident === ident)).filter((t): t is TagInfo => !!t);
  if (known.length === 0) throw new Error(`Invalid view config: unknown tag ${config.tags.join(", ")}`);
  return known.length === config.tags.length ? config : withTags(config, known);
}

/**
 * `config` with its unmapped fields filled from the view's tags now (T14): per tag, a null Start takes the default Start,
 * and then a null End the default End (the Start/End rule of `defaultDates`); a null Kanban column takes the default
 * column property. A field the user set stays. Returns `config` itself when nothing changes. Assumes `config` is valid
 * for `view` (`validateViewConfig`).
 */
export function withDefaults(config: ViewConfig, view: ViewTags): ViewConfig {
  let next = config;
  for (const tag of view.tags) {
    const mapped = config.dates[tag.ident];
    if (mapped.start !== null) continue;
    const d = defaultDates(tag);
    if (d.start !== null) next = { ...next, dates: { ...next.dates, [tag.ident]: { start: d.start, end: mapped.end ?? d.end } } };
  }
  if (next.kind === "kanban" && next.columnProp === null) {
    const column = defaultColumn(view.choiceProps);
    if (column !== null) next = { ...next, columnProp: column };
  }
  if (next.kind === "matrix" && (next.x === null || next.y === null)) {
    const axes = defaultMatrixAxes(view.choiceProps);
    if (axes) next = { ...next, ...axes };
  }
  return next;
}

const oneOf = (what: string, allowed: readonly string[], value: unknown) => {
  if (!allowed.includes(value as string)) throw new Error(`Invalid view config: ${what} "${String(value)}" is not one of ${allowed.join(", ")}`);
};

const invalid = (msg: string) => new Error(`Invalid view config: ${msg}`);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (what: string, v: unknown) => {
  if (typeof v !== "boolean") throw invalid(`${what} must be true or false`);
};
const stringOrNull = (what: string, v: unknown) => {
  if (v !== null && typeof v !== "string") throw invalid(`${what} must be a string or null`);
};
/** A plain object whose values are lists of value uuids (and `null` when `allowNull`; `kind` names the strings in errors). */
const selection = (what: string, v: unknown, allowNull: boolean, kind = "value uuids") => {
  if (!isObject(v)) throw invalid(`${what} must be an object`);
  for (const [ident, list] of Object.entries(v)) {
    if (!Array.isArray(list)) throw invalid(`${what}[${ident}] must be a list`);
    if (!list.every((u) => typeof u === "string" || (allowNull && u === null))) throw invalid(`${what}[${ident}] must hold ${kind}${allowNull ? " or null" : ""}`);
  }
};

/**
 * Throws a clear error unless `config` has the stored shape: every field of its kind with the right type (strings,
 * string-or-null, booleans, value-uuid lists in plain objects) and known option values. Graph-free: no tag needed.
 */
export function checkViewConfigShape(config: unknown): asserts config is ViewConfig {
  if (!isObject(config)) throw invalid("missing config object");
  oneOf("unknown view kind", VIEW_KINDS, config.kind);
  const tags = config.tags;
  if (!Array.isArray(tags) || tags.length === 0 || !tags.every((t) => typeof t === "string")) throw invalid("tags must be a non-empty list of tag idents");
  if (new Set(tags).size !== tags.length) throw invalid("tags must not repeat a tag");
  bool("childTags", config.childTags);
  if (!isObject(config.dates)) throw invalid("dates must be an object");
  for (const [ident, mapping] of Object.entries(config.dates)) {
    if (!tags.includes(ident)) throw invalid(`dates names ${ident}, which is not one of the view's tags`);
    if (!isObject(mapping)) throw invalid(`dates[${ident}] must be an object`);
    stringOrNull(`dates[${ident}].start`, mapping.start);
    stringOrNull(`dates[${ident}].end`, mapping.end);
  }
  for (const ident of tags) if (!(ident in config.dates)) throw invalid(`dates has no Start / End for ${ident}`);
  selection("doneValues", config.doneValues, false);
  selection("filters", config.filters, true);
  if ("dependsOn" in config) stringOrNull("dependsOn", config.dependsOn);
  switch (config.kind) {
    case "timeline":
      oneOf("timeline zoom", ZOOMS, config.zoom);
      return oneOf("timeline arrange", ARRANGES, config.arrange);
    case "calendar":
      return oneOf("calendar layout", LAYOUTS, config.layout);
    case "agenda":
      oneOf("agenda groupBy", GROUPS, config.groupBy);
      return bool("showDone", config.showDone);
    case "kanban":
      oneOf("kanban sort", SORTS, config.sort);
      stringOrNull("columnProp", config.columnProp);
      stringOrNull("laneProp", config.laneProp);
      selection("hiddenColumns", config.hiddenColumns, false, "column keys");
      if (!Array.isArray(config.hiddenFields) || !config.hiddenFields.every((f) => typeof f === "string")) throw invalid("hiddenFields must be a list of property idents");
      if (!isObject(config.cardFields) || !Object.values(config.cardFields).every((l) => Array.isArray(l) && l.every((f) => typeof f === "string"))) throw invalid("cardFields must be an object of lists of property idents");
      return;
    case "matrix": {
      oneOf("matrix mode", MATRIX_MODES, config.mode);
      bool("showDone", config.showDone);
      if (!Array.isArray(config.labels) || config.labels.length !== 4 || !config.labels.every((l) => typeof l === "string")) throw invalid("labels must be a list of four strings");
      for (const which of ["x", "y"] as const) {
        const a = config[which];
        if (a === null) continue;
        if (!isObject(a)) throw invalid(`${which} must be an axis object or null`);
        if (typeof a.prop !== "string") throw invalid(`${which}.prop must be a property ident`);
        bool(`${which}.reverse`, a.reverse);
        if (!Array.isArray(a.first) || !a.first.every((u) => typeof u === "string")) throw invalid(`${which}.first must be a list of value uuids`);
      }
      if ((config.x === null) !== (config.y === null)) throw invalid("x and y must both be set or both be null");
      return;
    }
  }
}

/**
 * Throws a clear error when `config` has a wrong shape or names an unknown tag, property, value or option. Returns the
 * view's tags with the properties they share (`mergeTags`), against which filters, done values and the Kanban column
 * and lane are checked; Start / End are checked against each tag's own date properties.
 */
export function validateViewConfig(config: ViewConfig, tags: TagInfo[]): ViewTags {
  checkViewConfigShape(config);
  const view = mergeTags(config.tags.map((ident) => {
    const tag = tags.find((t) => t.ident === ident);
    if (!tag) throw new Error(`Invalid view config: unknown tag ${ident}`);
    return tag;
  }));
  for (const tag of view.tags) {
    for (const ident of [config.dates[tag.ident].start, config.dates[tag.ident].end]) {
      if (ident !== null && !tag.dateProps.some((p) => p.ident === ident)) throw new Error(`Invalid view config: unknown date property ${ident} on ${tag.title}`);
    }
  }
  const multi = view.tags.length > 1;
  const choice = (ident: string) => {
    const p = view.choiceProps.find((x) => x.ident === ident);
    if (!p) throw new Error(`Invalid view config: unknown choice property ${ident} on ${view.tags.map((t) => t.title).join(" + ")}`);
    return p;
  };
  const values = (selection: ValueSelection | Record<string, string[]>, allowNull: boolean) => {
    for (const [ident, uuids] of Object.entries(selection)) {
      if (ident === TAG_KEY && allowNull) {
        if (!multi) throw new Error("Invalid view config: a Tag filter needs two or more tags");
        for (const u of uuids) if (u === null || !config.tags.includes(u)) throw new Error(`Invalid view config: Tag filter value ${String(u)} is not one of the view's tags`);
        continue;
      }
      const p = choice(ident);
      for (const u of uuids) {
        if (u === null ? !allowNull : !p.values.some((v) => v.uuid === u)) throw new Error(`Invalid view config: unknown value ${String(u)} for ${p.title}`);
      }
    }
  };
  values(config.filters, true);
  values(config.doneValues, false);
  if (config.kind === "kanban") {
    if (config.columnProp === WHEN_KEY) {
      if (!view.tags.some((t) => t.dateProps.length)) throw new Error("Invalid view config: When columns need a Date or DateTime property");
    } else if (config.columnProp !== null) choice(config.columnProp);
    if (config.laneProp === TAG_KEY) {
      if (!multi) throw new Error("Invalid view config: Tag swimlanes need two or more tags");
    } else if (config.laneProp !== null) choice(config.laneProp);
  }
  // N64: a first band's uuids are not checked: a value that is gone is ignored there (core/matrix.ts).
  if (config.kind === "matrix" && config.x && config.y) {
    choice(config.x.prop);
    choice(config.y.prop);
    if (config.x.prop === config.y.prop) throw new Error("Invalid view config: the Matrix axes use the same property");
  }
  return view;
}

/**
 * Saved value uuids → the closed-value ids `filterNodes` takes (`null` stays "No value"). The Tag filter (`TAG_KEY`) is
 * not a choice and is left out (the workspace applies it by node tag). Assumes a validated config.
 */
export function toChoiceFilters(config: ViewConfig, view: { choiceProps: ChoiceProp[] }): ChoiceFilters {
  const out: ChoiceFilters = {};
  for (const [ident, uuids] of Object.entries(config.filters)) {
    if (ident === TAG_KEY) continue;
    const p = view.choiceProps.find((x) => x.ident === ident)!;
    out[ident] = uuids.map((u) => (u === null ? null : p.values.find((v) => v.uuid === u)!.id));
  }
  return out;
}

export const serializeViewConfig = (config: ViewConfig): string => JSON.stringify({ v: VERSION, config });

/**
 * Throws on invalid JSON, another version or a config of the wrong shape (`checkViewConfigShape`); idents are checked by
 * `validateViewConfig`. A stored Kanban config without `hiddenColumns` loads with nothing hidden: the key was added (N08)
 * after views were first saved, and this is the one place stored configs come in. A stored config without `dependsOn`
 * (added in N12) loads with the key absent, which means the default rule: the parse has no tag to apply it to, so
 * `dependsOnOf` applies it against the view's tag wherever the setting is used. A stored config from before N14 has one
 * `tag` with its `start` and `end`: it loads as `tags: [tag]` with `dates: { [tag]: { start, end } }`, and a Timeline
 * without `arrange` loads arranged by date (the one-tag default).
 */
export function parseViewConfig(text: string): ViewConfig {
  let parsed: { v?: unknown; config?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid view config: not valid JSON");
  }
  if (parsed?.v !== VERSION) throw new Error(`Invalid view config: unsupported version ${String(parsed?.v)}, expected ${VERSION}`);
  let stored = parsed.config;
  if (isObject(stored) && stored.kind === "kanban" && !("hiddenColumns" in stored)) stored.hiddenColumns = {};
  if (isObject(stored) && stored.kind === "kanban" && !("hiddenFields" in stored)) stored.hiddenFields = [];
  if (isObject(stored) && stored.kind === "kanban" && !("cardFields" in stored)) stored.cardFields = {};
  if (isObject(stored) && !("tags" in stored) && typeof stored.tag === "string") {
    const { tag, start, end, ...rest } = stored;
    stored = { ...rest, tags: [tag], dates: { [tag]: { start, end } } };
  }
  if (isObject(stored) && stored.kind === "timeline" && !("arrange" in stored)) stored.arrange = "date";
  checkViewConfigShape(stored);
  return stored;
}
