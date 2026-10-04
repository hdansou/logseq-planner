// Saved-view configuration: type, defaults, validation, JSON (de)serialisation. Pure: no DOM, no SDK.
// Everything stored is graph-portable: tags and properties by ident, closed values by uuid (entity ids differ per device).
import type { ChoiceFilters, TagInfo } from "../types";

export const VIEW_KINDS = ["timeline", "calendar", "agenda", "kanban"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

const ZOOMS = ["day", "week", "month", "quarter"] as const;
const LAYOUTS = ["month", "week"] as const;
const GROUPS = ["node", "date"] as const;
const SORTS = ["due", "priority", "title"] as const;

/** Saved closed-value selection by choice property ident: value uuids, `null` = "No value" (filters only). */
export type ValueSelection = Record<string, (string | null)[]>;

interface CommonConfig {
  /** Tag ident. */
  tag: string;
  /** Include nodes of tags that extend it. */
  childTags: boolean;
  /** Date/DateTime property idents; null = not mapped (a tag without dates, or no End). */
  start: string | null;
  end: string | null;
  /** Per choice property: uuids of the closed values that count as done. Absent property = default rule (`isDone`). */
  doneValues: Record<string, string[]>;
  /** Per choice property: selected value uuids, `null` = "No value". Absent or empty = no filter. */
  filters: ValueSelection;
  /**
   * Node property whose values are the nodes a node depends on (N12): Timeline connectors, and those nodes' tasks no
   * longer count the node. Null = None. Absent only in a config stored before N12: the default rule applies
   * (`dependsOnOf`). An ident the tag no longer has behaves as null.
   */
  dependsOn?: string | null;
}

export type ViewConfig = CommonConfig &
  (
    | { kind: "timeline"; zoom: (typeof ZOOMS)[number] }
    | { kind: "calendar"; layout: (typeof LAYOUTS)[number] }
    | { kind: "agenda"; groupBy: (typeof GROUPS)[number]; showDone: boolean }
    /**
     * Column property (default Status); optional swimlane property; card sort. Null = the tag has no choice property.
     * `hiddenColumns`: per column property ident, the columns not shown (closed-value uuids, `NO_VALUE` = "No <prop>"),
     * kept per property so switching the column property and back keeps each choice; unknown keys are ignored (N08).
     */
    | { kind: "kanban"; columnProp: string | null; laneProp: string | null; sort: (typeof SORTS)[number]; hiddenColumns: Record<string, string[]> }
  );

const VERSION = 1;

/** Start/End, else Scheduled/Deadline, else the first date property (REQUIREMENTS: dates from the tag's own properties). */
function defaultDates(tag: TagInfo): { start: string | null; end: string | null } {
  const named = (title: string) => tag.dateProps.find((p) => p.title.toLowerCase() === title)?.ident ?? null;
  for (const [s, e] of [["start", "end"], ["scheduled", "deadline"]]) {
    const start = named(s);
    const end = named(e);
    if (start || end) return { start, end };
  }
  return { start: tag.dateProps[0]?.ident ?? null, end: null };
}

/** The node property titled like "depends on" (lowercased, non-alphanumerics removed: `depends_on`, "Depends on", "depends-on"), else null. */
function defaultDependsOn(tag: TagInfo): string | null {
  return tag.nodeProps.find((p) => p.title.toLowerCase().replace(/[^a-z0-9]/g, "") === "dependson")?.ident ?? null;
}

/**
 * The dependency property the view uses on `tag` now: the chosen one, or by the default rule when the config predates
 * the setting; null for None and for an ident the tag no longer has (no error: the view just draws no dependencies).
 */
export function dependsOnOf(config: ViewConfig, tag: TagInfo): string | null {
  const ident = config.dependsOn === undefined ? defaultDependsOn(tag) : config.dependsOn;
  return tag.nodeProps.some((p) => p.ident === ident) ? ident : null;
}

/** The view a user gets when they pick `tag`: mapped dates and the dependency property by the default rules, nothing filtered. */
export function defaultViewConfig(tag: TagInfo, kind: ViewKind = "timeline"): ViewConfig {
  const common: CommonConfig = { tag: tag.ident, childTags: true, ...defaultDates(tag), doneValues: {}, filters: {}, dependsOn: defaultDependsOn(tag) };
  switch (kind) {
    case "timeline":
      return { ...common, kind, zoom: "month" };
    case "calendar":
      return { ...common, kind, layout: "month" };
    case "agenda":
      return { ...common, kind, groupBy: "node", showDone: false };
    case "kanban": {
      const status = tag.choiceProps.find((p) => p.title === "Status") ?? tag.choiceProps[0];
      return { ...common, kind, columnProp: status?.ident ?? null, laneProp: null, sort: "due", hiddenColumns: {} };
    }
  }
}

/**
 * `config` with its unmapped fields filled from `tag` now (T14): a null Start takes the default Start, and then a null
 * End the default End (the Start/End rule of `defaultDates`); a null Kanban column takes the default column property.
 * A field the user set stays. Returns `config` itself when nothing changes. Assumes `config` is valid for `tag`.
 */
export function withDefaults(config: ViewConfig, tag: TagInfo): ViewConfig {
  let next = config;
  if (config.start === null) {
    const d = defaultDates(tag);
    if (d.start !== null) next = { ...next, start: d.start, end: config.end ?? d.end };
  }
  if (next.kind === "kanban" && next.columnProp === null) {
    const column = (defaultViewConfig(tag, "kanban") as Extract<ViewConfig, { kind: "kanban" }>).columnProp;
    if (column !== null) next = { ...next, columnProp: column };
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
  if (typeof config.tag !== "string") throw invalid("tag must be a string");
  bool("childTags", config.childTags);
  stringOrNull("start", config.start);
  stringOrNull("end", config.end);
  selection("doneValues", config.doneValues, false);
  selection("filters", config.filters, true);
  if ("dependsOn" in config) stringOrNull("dependsOn", config.dependsOn);
  switch (config.kind) {
    case "timeline":
      return oneOf("timeline zoom", ZOOMS, config.zoom);
    case "calendar":
      return oneOf("calendar layout", LAYOUTS, config.layout);
    case "agenda":
      oneOf("agenda groupBy", GROUPS, config.groupBy);
      return bool("showDone", config.showDone);
    case "kanban":
      oneOf("kanban sort", SORTS, config.sort);
      stringOrNull("columnProp", config.columnProp);
      stringOrNull("laneProp", config.laneProp);
      return selection("hiddenColumns", config.hiddenColumns, false, "column keys");
  }
}

/** Throws a clear error when `config` has a wrong shape or names an unknown tag, property, value or option. Returns the tag. */
export function validateViewConfig(config: ViewConfig, tags: TagInfo[]): TagInfo {
  checkViewConfigShape(config);
  const tag = tags.find((t) => t.ident === config.tag);
  if (!tag) throw new Error(`Invalid view config: unknown tag ${config.tag}`);
  const date = (ident: string | null) => {
    if (ident !== null && !tag.dateProps.some((p) => p.ident === ident)) throw new Error(`Invalid view config: unknown date property ${ident} on ${tag.title}`);
  };
  const choice = (ident: string) => {
    const p = tag.choiceProps.find((x) => x.ident === ident);
    if (!p) throw new Error(`Invalid view config: unknown choice property ${ident} on ${tag.title}`);
    return p;
  };
  date(config.start);
  date(config.end);
  const values = (selection: ValueSelection | Record<string, string[]>, allowNull: boolean) => {
    for (const [ident, uuids] of Object.entries(selection)) {
      const p = choice(ident);
      for (const u of uuids) {
        if (u === null ? !allowNull : !p.values.some((v) => v.uuid === u)) throw new Error(`Invalid view config: unknown value ${String(u)} for ${p.title}`);
      }
    }
  };
  values(config.filters, true);
  values(config.doneValues, false);
  if (config.kind === "kanban") {
    if (config.columnProp !== null) choice(config.columnProp);
    if (config.laneProp !== null) choice(config.laneProp);
  }
  return tag;
}

/** Saved value uuids → the closed-value ids `filterNodes` takes (`null` stays "No value"). Assumes a validated config. */
export function toChoiceFilters(config: ViewConfig, tag: TagInfo): ChoiceFilters {
  const out: ChoiceFilters = {};
  for (const [ident, uuids] of Object.entries(config.filters)) {
    const p = tag.choiceProps.find((x) => x.ident === ident)!;
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
 * `dependsOnOf` applies it against the view's tag wherever the setting is used.
 */
export function parseViewConfig(text: string): ViewConfig {
  let parsed: { v?: unknown; config?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid view config: not valid JSON");
  }
  if (parsed?.v !== VERSION) throw new Error(`Invalid view config: unsupported version ${String(parsed?.v)}, expected ${VERSION}`);
  const stored = parsed.config;
  if (isObject(stored) && stored.kind === "kanban" && !("hiddenColumns" in stored)) stored.hiddenColumns = {};
  checkViewConfigShape(stored);
  return stored;
}
