// Schema discovery: tags, their date, choice and node properties (inherited included), closed values.
// Pure: no DOM, no SDK. The datascript call is injected (see `Dq`).
import type { ChoiceProp, ClosedValue, DateProp, NodeProp, TagInfo } from "../types";

/** `logseq.DB.datascriptQuery`-shaped call; `src/sdk.ts` supplies the real one. */
export type Dq = (query: string, ...inputs: unknown[]) => Promise<unknown[]>;

/**
 * A full property ident as Logseq generates it: `:namespace/name`, both parts from `[0-9a-zA-Z*+!_'?<>=.-]` (logseq
 * `normalize-ident-name-part`; e.g. "Done?", "A+B" and "Who's" give `?`, `+` and `'`). The one check used wherever an
 * ident is put into a query string (`nodePull`, `choiceReadQuery`): anything else is never interpolated.
 */
const IDENT_RE = /^:[0-9a-zA-Z*+!_'?<>=.-]+\/[0-9a-zA-Z*+!_'?<>=.-]+$/;
export const isPropertyIdent = (ident: string): boolean => IDENT_RE.test(ident);

const ROOT_IDENT = ":logseq.class/Root";
const CANCELED_IDENT = ":logseq.property/status.canceled";

// Both queries are the ones scripts/probe.mjs ran live (fixtures tags.json, class-properties.json).
export const TAGS_QUERY = `[:find (pull ?t [:db/id :db/ident :block/uuid :block/title :logseq.property/built-in?
                        {:logseq.property.class/extends [:db/id :db/ident :block/title]}
                        {:logseq.property.class/properties [:db/id :db/ident :block/title]}])
          :where [?t :block/tags :logseq.class/Tag]]`;

export const TAG_PROPERTIES_QUERY = `[:find ?tag-title (pull ?p [:db/id :db/ident :block/uuid :block/title :logseq.property/type
                        :db/cardinality :logseq.property/built-in? :logseq.property/hide? :logseq.property/public?
                        {:logseq.property/default-value [:db/ident :block/title]}
                        {:logseq.property/classes [:db/ident :block/title]}
                        {:block/_closed-value-property [:db/id :db/ident :block/uuid :block/title :block/order
                          :logseq.property/choice-checkbox-state :logseq.property/icon
                          {:logseq.property/choice-classes [:db/ident :block/title]}]}])
          :in $ [?tag-title ...]
          :where [?t :block/tags :logseq.class/Tag] [?t :block/title ?tag-title]
                 [?t :logseq.property.class/properties ?p]]`;

// Raw shapes as observed (docs/probes.md): pull-map keys keep their namespace except :block/* and :db/*.
interface RawRef {
  id: number;
  ident?: string;
  title?: string;
}
interface RawTag {
  id: number;
  uuid: string;
  ident: string;
  title: string;
  ":logseq.property/built-in?"?: boolean;
  ":logseq.property.class/extends"?: RawRef[];
  ":logseq.property.class/properties"?: RawRef[];
}
interface RawClosedValue {
  id: number;
  uuid: string;
  title: string;
  ident?: string;
  order: string;
  ":logseq.property/choice-checkbox-state"?: boolean;
}
interface RawProp {
  id: number;
  ident: string;
  title: string;
  ":logseq.property/type"?: string;
  /** `:db/cardinality` (pull key without `:db/`): `:db.cardinality/one` or `/many`. */
  cardinality?: string;
  "_closed-value-property"?: RawClosedValue[];
}

/** A choice holds one value only with this cardinality: filters, Kanban columns and done values assume one value per node. */
const ONE = ":db.cardinality/one";

const toClosedValue = (v: RawClosedValue): ClosedValue => ({
  id: v.id,
  uuid: v.uuid,
  title: v.title,
  ident: v.ident ?? null,
  order: v.order,
  checkbox: v[":logseq.property/choice-checkbox-state"] ?? null,
  canceled: v.ident === CANCELED_IDENT,
});

const byOrder = (a: ClosedValue, b: ClosedValue) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);

/**
 * Date/DateTime, choice and node properties of a tag, own first then inherited (parents walked depth-first). A choice
 * property counts only with cardinality one (T14): a many-valued one is not offered for filters, Kanban or done values.
 * A node property counts with any cardinality (N12: `depends_on` is many-valued).
 */
function collectProps(tag: RawTag, tagsById: Map<number, RawTag>, propsById: Map<number, RawProp>) {
  const dateProps: DateProp[] = [];
  const choiceProps: ChoiceProp[] = [];
  const nodeProps: NodeProp[] = [];
  const seenTags = new Set<number>();
  const seenProps = new Set<number>();
  const visit = (t: RawTag) => {
    if (seenTags.has(t.id)) return;
    seenTags.add(t.id);
    for (const ref of t[":logseq.property.class/properties"] ?? []) {
      const p = propsById.get(ref.id);
      if (!p || seenProps.has(p.id)) continue;
      seenProps.add(p.id);
      const type = p[":logseq.property/type"];
      const closed = p["_closed-value-property"] ?? [];
      if (type === "date" || type === "datetime") {
        dateProps.push({ id: p.id, ident: p.ident, title: p.title, type });
      } else if (type === "node") {
        nodeProps.push({ id: p.id, ident: p.ident, title: p.title });
      } else if (type === "default" && closed.length > 0 && p.cardinality === ONE) {
        choiceProps.push({
          id: p.id,
          ident: p.ident,
          title: p.title,
          values: closed.map(toClosedValue).sort(byOrder),
        });
      }
    }
    for (const parent of t[":logseq.property.class/extends"] ?? []) {
      const next = tagsById.get(parent.id);
      if (next) visit(next);
    }
  };
  visit(tag);
  return { dateProps, choiceProps, nodeProps };
}

/** Raw `TAGS_QUERY` and `TAG_PROPERTIES_QUERY` results → tags with inherited properties resolved. */
export function buildTagInfos(rawTags: unknown[], rawProps: unknown[]): TagInfo[] {
  const tags = (rawTags as [RawTag][]).map(([t]) => t);
  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const propsById = new Map((rawProps as [string, RawProp][]).map(([, p]) => [p.id, p]));

  const infos: TagInfo[] = tags
    .filter((t) => t.ident !== ROOT_IDENT)
    .map((t) => ({
      id: t.id,
      uuid: t.uuid,
      ident: t.ident,
      title: t.title,
      builtIn: t[":logseq.property/built-in?"] === true,
      parentIds: (t[":logseq.property.class/extends"] ?? []).filter((p) => p.ident !== ROOT_IDENT).map((p) => p.id),
      childIds: [],
      ...collectProps(t, tagsById, propsById),
    }));
  const infoById = new Map(infos.map((i) => [i.id, i]));
  for (const info of infos) for (const pid of info.parentIds) infoById.get(pid)?.childIds.push(info.id);
  return infos;
}

/** Runs both queries through the injected `dq` and builds the tag list. */
export async function loadTagInfos(dq: Dq): Promise<TagInfo[]> {
  const rawTags = await dq(TAGS_QUERY);
  const owners = (rawTags as [RawTag][])
    .map(([t]) => t)
    .filter((t) => (t[":logseq.property.class/properties"] ?? []).length > 0)
    .map((t) => t.title);
  const rawProps = await dq(TAG_PROPERTIES_QUERY, owners);
  return buildTagInfos(rawTags, rawProps);
}

/**
 * The reserved key of the Tag pseudo-property (N14), never a property ident (those start with ":"): in `filters` its
 * values are tag idents (which of the view's tags to show), as a Kanban `laneProp` it lanes the cards by tag (read-only).
 * Offered with two or more tags only.
 */
export const TAG_KEY = "@tag";

/**
 * The tags of a view (N14) and the properties they share: what filters, Kanban columns / swimlanes / Show, Done when,
 * Depends on and the Priority sort offer. One tag shares all of its own (and inherited) properties.
 */
export interface ViewTags {
  /** The selected tags, in selection order (at least one). */
  tags: TagInfo[];
  /** Choice properties every selected tag has (own or inherited), matched by ident, in the first tag's order. */
  choiceProps: ChoiceProp[];
  /** Node properties every selected tag has, same rule. */
  nodeProps: NodeProp[];
}

/** The view's tags with their shared properties (`ViewTags`); linear in the tags' properties. Throws on an empty list. */
export function mergeTags(tags: TagInfo[]): ViewTags {
  if (tags.length === 0) throw new Error("A view needs at least one tag");
  const [first, ...rest] = tags;
  const shared = <P extends { ident: string }>(of: (t: TagInfo) => P[]): P[] => {
    const others = rest.map((t) => new Set(of(t).map((p) => p.ident)));
    return of(first).filter((p) => others.every((idents) => idents.has(p.ident)));
  };
  return { tags, choiceProps: shared((t) => t.choiceProps), nodeProps: shared((t) => t.nodeProps) };
}

/** "#Milestone + #Task": the view's tags as the workspace names them (titles unescaped: escape when rendering). */
export const tagsTitle = (tags: TagInfo[]): string => tags.map((t) => `#${t.title}`).join(" + ");
