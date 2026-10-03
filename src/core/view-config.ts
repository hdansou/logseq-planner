// Saved-view configuration: type, defaults, validation, JSON (de)serialisation. Pure: no DOM, no SDK.
// Everything stored is graph-portable: tags and properties by ident, closed values by uuid (entity ids differ per device).
import type { ChoiceFilters, TagInfo } from "../types";

export const VIEW_KINDS = ["timeline", "calendar", "agenda", "kanban"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

const ZOOMS = ["week", "month", "quarter"] as const;
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
}

export type ViewConfig = CommonConfig &
  (
    | { kind: "timeline"; zoom: (typeof ZOOMS)[number] }
    | { kind: "calendar"; layout: (typeof LAYOUTS)[number] }
    | { kind: "agenda"; groupBy: (typeof GROUPS)[number]; showDone: boolean }
    /** Column property (default Status); optional swimlane property; card sort. Null = the tag has no choice property. */
    | { kind: "kanban"; columnProp: string | null; laneProp: string | null; sort: (typeof SORTS)[number] }
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

/** The view a user gets when they pick `tag`: mapped dates by the default rule, nothing filtered. */
export function defaultViewConfig(tag: TagInfo, kind: ViewKind = "timeline"): ViewConfig {
  const common: CommonConfig = { tag: tag.ident, childTags: true, ...defaultDates(tag), doneValues: {}, filters: {} };
  switch (kind) {
    case "timeline":
      return { ...common, kind, zoom: "month" };
    case "calendar":
      return { ...common, kind, layout: "month" };
    case "agenda":
      return { ...common, kind, groupBy: "node", showDone: false };
    case "kanban": {
      const status = tag.choiceProps.find((p) => p.title === "Status") ?? tag.choiceProps[0];
      return { ...common, kind, columnProp: status?.ident ?? null, laneProp: null, sort: "due" };
    }
  }
}

const oneOf = (what: string, allowed: readonly string[], value: unknown) => {
  if (!allowed.includes(value as string)) throw new Error(`Invalid view config: ${what} "${String(value)}" is not one of ${allowed.join(", ")}`);
};

/** Throws a clear error when `config` names an unknown tag, property, value or option. Returns the tag. */
export function validateViewConfig(config: ViewConfig, tags: TagInfo[]): TagInfo {
  oneOf("unknown view kind", VIEW_KINDS, config.kind);
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
  switch (config.kind) {
    case "timeline":
      oneOf("timeline zoom", ZOOMS, config.zoom);
      break;
    case "calendar":
      oneOf("calendar layout", LAYOUTS, config.layout);
      break;
    case "agenda":
      oneOf("agenda groupBy", GROUPS, config.groupBy);
      break;
    case "kanban":
      oneOf("kanban sort", SORTS, config.sort);
      if (config.columnProp !== null) choice(config.columnProp);
      if (config.laneProp !== null) choice(config.laneProp);
      break;
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

/** Throws on invalid JSON, another version or a missing config; shape is checked by `validateViewConfig`. */
export function parseViewConfig(text: string): ViewConfig {
  let parsed: { v?: unknown; config?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid view config: not valid JSON");
  }
  if (parsed?.v !== VERSION) throw new Error(`Invalid view config: unsupported version ${String(parsed?.v)}, expected ${VERSION}`);
  if (typeof parsed.config !== "object" || parsed.config === null) throw new Error("Invalid view config: missing config object");
  return parsed.config as ViewConfig;
}
