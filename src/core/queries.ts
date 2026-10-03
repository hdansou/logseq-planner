// Graph queries for nodes and tasks. The datascript call is injected (see `Dq`); no SDK use here.
import type { PlannerNode, PlannerTask, TagInfo } from "../types";
import type { Dq } from "./schema";
import { buildNodes, buildTasks, systemZone, type ZoneOffset } from "./normalize";

/** Rules go last in `:in` as a string with a leading space (scripts/probe.mjs `RULES`). */
export const CLASS_EXTENDS_RULES = ` [[(class-extends ?p ?c) [?c :logseq.property.class/extends ?p]]
  [(class-extends ?p ?c) [?t :logseq.property.class/extends ?p] (class-extends ?t ?c)]]`;

/** What `buildNodes` reads besides the properties: `:db/id`, `:block/uuid`, `:block/title`, `:block/tags` (plain refs → `{id}`). */
const NODE_ATTRS = ":db/id :block/uuid :block/title :block/tags";

/**
 * The Date/DateTime and choice property idents of every tag (own and inherited), each once, sorted: what normalisation
 * can read on a node (the props of each tag it carries, `propsOf` in normalize.ts). A narrow pull instead of `pull [*]`
 * (T13a: 2,000 nodes 276 ms → 77 ms live); a ref-typed value still comes back as `{id}`, a DateTime as epoch ms.
 */
export function nodePropIdents(tags: TagInfo[]): string[] {
  return [...new Set(tags.flatMap((t) => [...t.dateProps, ...t.choiceProps].map((p) => p.ident)))].sort();
}

/**
 * The node pull: `NODE_ATTRS` and every tag's date/choice ident; a Date ident (a journal page ref) as
 * `{<ident> [:db/id :block/journal-day]}` so the day comes with the node (T13a: no separate journal-day query, which
 * queued behind the task query live). DateTime and choice idents stay plain (epoch ms, `{id}`).
 */
export function nodePull(tags: TagInfo[]): string {
  const dates = new Set(tags.flatMap((t) => t.dateProps).filter((p) => p.type === "date").map((p) => p.ident));
  return [NODE_ATTRS, ...nodePropIdents(tags).map((i) => (dates.has(i) ? `{${i} [:db/id :block/journal-day]}` : i))].join(" ");
}

// Same join as probe query `nodesOfTagWithExtends` (fixture nodes.json), with the narrow pull.
export const nodesQuery = (tags: TagInfo[]) => `[:find (pull ?b [${nodePull(tags)}])
          :in $ ?tag-title %
          :where [?tag :block/tags :logseq.class/Tag] [?tag :block/title ?tag-title]
                 [?b :block/tags ?t] (or [(= ?t ?tag)] (class-extends ?tag ?t))]`;

/**
 * #Task blocks that reference a node of the tag (same tag join as `nodesQuery`), pulling what `buildTasks` reads: Status
 * with its ident (the empty placeholder is recognised by it), Deadline, Scheduled and the refs' ids. T13a: bound by the
 * tag instead of every #Task of the graph, and no nested tag or ref titles (2,033 rows 314 ms → ~100 ms live).
 */
export const TASKS_QUERY = `[:find (pull ?b [:db/id :block/uuid :block/title
                        {:logseq.property/status [:db/ident :block/title]}
                        :logseq.property/deadline :logseq.property/scheduled
                        {:block/refs [:db/id]}])
          :in $ ?tag-title %
          :where [?tag :block/tags :logseq.class/Tag] [?tag :block/title ?tag-title]
                 [?n :block/tags ?t] (or [(= ?t ?tag)] (class-extends ?tag ?t))
                 [?b :block/refs ?n] [?b :block/tags :logseq.class/Task]]`;

export interface LoadNodesOptions {
  /** Include nodes of tags that extend `tag` (any depth). */
  childTags: boolean;
  /** Local zone offset; defaults to the machine's. */
  zone?: ZoneOffset;
}

/** Nodes of `tag` (plus extending tags when `childTags`) with their dates and choice values mapped. */
export async function loadNodes(dq: Dq, tags: TagInfo[], tag: TagInfo, opts: LoadNodesOptions): Promise<PlannerNode[]> {
  const raw = await dq(nodesQuery(tags), tag.title, CLASS_EXTENDS_RULES);
  return buildNodes(raw, tags, tag, opts.childTags, opts.zone ?? systemZone);
}

/** The rows of the node and task queries for one tag, with what they were asked with (to tell when they are stale). */
export interface RawData {
  /** The node query string (`nodesQuery(tags)`): it names the pulled idents. */
  nodesQuery: string;
  /** The tag title both queries were run with. */
  title: string;
  nodes: unknown[];
  tasks: unknown[];
}

/**
 * Runs the node and task queries for `tag`. The task query does not need the nodes (it joins on the tag), so both are
 * asked at once. With `prev` (rows read earlier, e.g. with the tags shown before a refresh re-read them), only the
 * stale part is asked again: the node rows when the pull (`nodesQuery(tags)`) or the tag title differ, the task rows
 * when the title differs; with neither, `prev` is returned and no query is sent.
 */
export async function readRaw(dq: Dq, tags: TagInfo[], tag: TagInfo, prev?: RawData): Promise<RawData> {
  const query = nodesQuery(tags);
  const sameTitle = prev?.title === tag.title;
  const [nodes, tasks] = await Promise.all([
    sameTitle && prev!.nodesQuery === query ? prev!.nodes : dq(query, tag.title, CLASS_EXTENDS_RULES),
    sameTitle ? prev!.tasks : dq(TASKS_QUERY, tag.title, CLASS_EXTENDS_RULES),
  ]);
  return { nodesQuery: query, title: tag.title, nodes, tasks };
}

/** Raw rows → nodes (`tags` maps the dates and closed values) and the #Task blocks whose refs hit one of them. */
export function buildData(raw: RawData, tags: TagInfo[], tag: TagInfo, opts: LoadNodesOptions): { nodes: PlannerNode[]; tasks: PlannerTask[] } {
  const zone = opts.zone ?? systemZone;
  const nodes = buildNodes(raw.nodes, tags, tag, opts.childTags, zone);
  return { nodes, tasks: buildTasks(raw.tasks, nodes, zone) };
}

/**
 * The nodes of `tag` and the #Task blocks whose `:block/refs` hit them (inline refs and node-property links);
 * `buildTasks` keeps the tasks that hit a loaded node (with child tags off the query also returns tasks of child-tag nodes).
 */
export async function loadNodesAndTasks(dq: Dq, tags: TagInfo[], tag: TagInfo, opts: LoadNodesOptions): Promise<{ nodes: PlannerNode[]; tasks: PlannerTask[] }> {
  return buildData(await readRaw(dq, tags, tag), tags, tag, opts);
}

/**
 * uuid → title for blocks by uuid string. The uuids are passed as ONE collection input of plain strings: the host
 * EDN-reads only top-level string inputs (frontend/worker/handler/query.cljs `query-input-value`), and a collection
 * input worked live with numbers and strings (T01/T04); a collection of uuid values has not been tried, so each block's
 * uuid is turned into its string with `(str ?u)` and joined on `?s` (datascript joins a function binding to a variable
 * that is already bound). Rows: `[uuid-string title]`.
 */
export const TITLES_QUERY = `[:find ?s ?title
          :in $ [?s ...]
          :where [?b :block/uuid ?u] [(str ?u) ?s] [?b :block/title ?title]]`;

/** Titles of the blocks with these (lower-case) uuids; one query, none when `uuids` is empty. Unknown uuids are absent. */
export async function loadTitles(dq: Dq, uuids: string[]): Promise<Map<string, string>> {
  if (uuids.length === 0) return new Map();
  const rows = (await dq(TITLES_QUERY, uuids)) as [string, string][];
  return new Map(rows.map(([u, title]) => [u.toLowerCase(), title]));
}
