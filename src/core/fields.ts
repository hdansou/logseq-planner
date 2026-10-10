/**
 * The properties a Kanban card shows (N42): which ones for a node's tag, which of them the node query must pull with an
 * attribute of their own, and how each value reads on a card (a bare value; the app puts the property's name on it as its
 * tooltip). Pure.
 */
import type { ChoiceProp, FieldProp, PlannerNode, TagInfo } from "../types";
import { formatDate } from "./layout-common";
import type { ViewTags } from "./schema";
import type { ViewConfig } from "./view-config";

const PRIORITY_IDENT = ":logseq.property/priority";

/** The tag's Priority choice property: the built-in one, else one titled "Priority"; null when it has none. */
export const priorityProp = (tag: { choiceProps: ChoiceProp[] }): ChoiceProp | null =>
  tag.choiceProps.find((p) => p.ident === PRIORITY_IDENT) ?? tag.choiceProps.find((p) => p.title.trim().toLowerCase() === "priority") ?? null;

type KanbanConfig = Extract<ViewConfig, { kind: "kanban" }>;

/** Types whose value is not in the node row already: the pull needs an attribute for them. */
const NEEDS_ATTRIBUTE = new Set(["text", "number", "checkbox", "url", "node"]);

/** The properties a card never offers or shows as a field: the ones it sits in (column, lane) and its Priority. */
const reserved = (config: KanbanConfig, view: ViewTags): Set<string> =>
  new Set([config.columnProp, config.laneProp, priorityProp(view)?.ident].filter((x): x is string => !!x));

/**
 * The fields a card of `tag` shows, in order. With a list of its own for the tag (`cardFields`) exactly that, leaving out
 * what the tag no longer has and the reserved ones; else the default: the choice properties the view's tags share, less
 * the reserved ones and the hidden ones (`hiddenFields`), which is what cards showed before N42.
 */
export function cardFieldsOf(config: KanbanConfig, tag: TagInfo, view: ViewTags): FieldProp[] {
  const skip = reserved(config, view);
  const own = config.cardFields[tag.ident];
  if (own) return own.map((ident) => tag.fieldProps.find((f) => f.ident === ident)).filter((f): f is FieldProp => !!f && !skip.has(f.ident));
  const shared = new Set(view.choiceProps.map((p) => p.ident));
  return tag.fieldProps.filter((f) => f.type === "choice" && shared.has(f.ident) && !skip.has(f.ident) && !config.hiddenFields.includes(f.ident));
}

/** The properties a card of `tag` can be given as fields: all of the tag's, less the reserved ones (the menu lists these). */
export const offeredFields = (config: KanbanConfig, tag: TagInfo, view: ViewTags): FieldProp[] => {
  const skip = reserved(config, view);
  return tag.fieldProps.filter((f) => !skip.has(f.ident));
};

/** Every property the card fields of the view's tags need pulled with an attribute of their own (none for any other view kind). */
export function extraFieldProps(config: ViewConfig, view: ViewTags): FieldProp[] {
  if (config.kind !== "kanban") return [];
  const seen = new Map<string, FieldProp>();
  for (const tag of view.tags) for (const f of cardFieldsOf(config, tag, view)) if (NEEDS_ATTRIBUTE.has(f.type)) seen.set(f.ident, f);
  return [...seen.values()];
}

/** The host of a web address (without `www.`), else the text as written. */
const urlText = (value: string): string => {
  try {
    return new URL(value).hostname.replace(/^www\./, "") || value;
  } catch {
    return value;
  }
};

/** What a node's value of `prop` reads like on a card: a list, empty when the node has none. */
export function fieldTexts(prop: FieldProp, node: PlannerNode): string[] {
  switch (prop.type) {
    case "choice": {
      const v = node.choices[prop.ident];
      return v ? [v.title] : [];
    }
    case "date":
    case "datetime": {
      const d = node.dates[prop.ident];
      return d ? [formatDate(d)] : [];
    }
    default: {
      const values = node.extras?.[prop.ident] ?? [];
      if (prop.type === "checkbox") return values.includes(true) ? [prop.title] : [];
      if (prop.type === "url") return values.map((v) => urlText(String(v)));
      return values.map(String);
    }
  }
}
