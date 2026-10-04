// Graph queries for nodes and tasks. The datascript call is injected (see `Dq`); no SDK use here.
import type { PlannerNode, PlannerTask, TagInfo } from "../types";
import { isPropertyIdent, type Dq } from "./schema";
import { buildNodes, buildTasks, systemZone, type ZoneOffset } from "./normalize";

/** Rules go last in `:in` as a string with a leading space (scripts/probe.mjs `RULES`). */
export const CLASS_EXTENDS_RULES = ` [[(class-extends ?p ?c) [?c :logseq.property.class/extends ?p]]
  [(class-extends ?p ?c) [?t :logseq.property.class/extends ?p] (class-extends ?t ?c)]]`;

/**
 * Datascript clauses that keep block `v` only when it is not in Recycle: neither the block nor its page carries
 * `:logseq.property/deleted-at`. A block on a recycled page has no deleted-at of its own and keeps `:block/page` → that
 * page (seen live 2026-10-03, T14 F4). `?pg` is local to the `not-join`, so the clauses can be used for two variables.
 */
export const notRecycled = (v: string): string =>
  `(not [${v} :logseq.property/deleted-at _]) (not-join [${v}] [${v} :block/page ?pg] [?pg :logseq.property/deleted-at _])`;

/** What `buildNodes` reads besides the properties: `:db/id`, `:block/uuid`, `:block/title`, `:block/tags` (plain refs → `{id}`). */
const NODE_ATTRS = ":db/id :block/uuid :block/title :block/tags";

/**
 * The Date/DateTime and choice property idents of every tag (own and inherited), each once, sorted: what normalisation
 * can read on a node (the props of each tag it carries, `propsOf` in normalize.ts). A narrow pull instead of `pull [*]`
 * (T13a: 2,000 nodes 276 ms → 77 ms live); a ref-typed value still comes back as `{id}`, a DateTime as epoch ms.
 */
export function nodePropIdents(tags: TagInfo[]): string[] {
  // An ident that is not a valid keyword is skipped, never interpolated (T14): that property reads as no value.
  return [...new Set(tags.flatMap((t) => [...t.dateProps, ...t.choiceProps].map((p) => p.ident)))].filter(isPropertyIdent).sort();
}

/** The dependency property as a pulled attribute (N12): ` <ident>`, or "" for none or an ident that is not a valid keyword. */
const dependsAttr = (dependsOn: string | null) => (dependsOn !== null && isPropertyIdent(dependsOn) ? ` ${dependsOn}` : "");

/**
 * The node pull: `NODE_ATTRS` and every tag's date/choice ident; a Date ident (a journal page ref) as
 * `{<ident> [:db/id :block/journal-day]}` so the day comes with the node (T13a: no separate journal-day query, which
 * queued behind the task query live). DateTime and choice idents stay plain (epoch ms, `{id}`). The view's dependency
 * property (N12), when it has one, last and plain: its values come back as `[{id}]` (or `{id}`).
 */
export function nodePull(tags: TagInfo[], dependsOn: string | null = null): string {
  const dates = new Set(tags.flatMap((t) => t.dateProps).filter((p) => p.type === "date").map((p) => p.ident));
  return [NODE_ATTRS, ...nodePropIdents(tags).map((i) => (dates.has(i) ? `{${i} [:db/id :block/journal-day]}` : i))].join(" ") + dependsAttr(dependsOn);
}

/**
 * The view's tags are the `[?tag ...]` input as their entity ids (numbers; N14: one or more, the union of their nodes,
 * each block once as `:find` returns a set): the host EDN-reads a top-level string input, so a title such as "2026 goals",
 * "true" or ":kw" never matched (T14, F2, seen live); numbers are passed through (a collection input of numbers worked
 * live, T01/T04), and two tags with the same title no longer merge. Same join as probe query `nodesOfTagWithExtends`
 * (fixture nodes.json), with the narrow pull; blocks in Recycle (or on a recycled page) are left out (`notRecycled`).
 */
export const nodesQuery = (tags: TagInfo[], dependsOn: string | null = null) => `[:find (pull ?b [${nodePull(tags, dependsOn)}])
          :in $ [?tag ...] %
          :where [?b :block/tags ?t] (or [(= ?t ?tag)] (class-extends ?tag ?t))
                 ${notRecycled("?b")}]`;

/**
 * #Task blocks that reference a node of the view's tags (same tag join as `nodesQuery`), pulling what `buildTasks` reads: Status
 * with its ident (the empty placeholder is recognised by it), Deadline, Scheduled and the refs' ids. T13a: bound by the
 * tag instead of every #Task of the graph, and no nested tag or ref titles (2,033 rows 314 ms → ~100 ms live). Neither
 * the task nor the node it links may be in Recycle (T14); `buildTasks` also drops refs to nodes that are not loaded.
 * The view's dependency property (N12), when it has one, is pulled last and plain: a task's values for it decide which
 * refs do not link (`buildTasks`).
 */
export const tasksQuery = (dependsOn: string | null) => `[:find (pull ?b [:db/id :block/uuid :block/title
                        {:logseq.property/status [:db/ident :block/title]}
                        :logseq.property/deadline :logseq.property/scheduled
                        {:block/refs [:db/id]}${dependsAttr(dependsOn)}])
          :in $ [?tag ...] %
          :where [?n :block/tags ?t] (or [(= ?t ?tag)] (class-extends ?tag ?t))
                 ${notRecycled("?n")}
                 [?b :block/refs ?n] [?b :block/tags :logseq.class/Task]
                 ${notRecycled("?b")}]`;

export interface LoadNodesOptions {
  /** Include nodes of tags that extend a selected tag (any depth). */
  childTags: boolean;
  /** Local zone offset; defaults to the machine's. */
  zone?: ZoneOffset;
  /** The view's dependency property (N12; test-only loaders): pulled and applied when set. */
  dependsOn?: string | null;
}

/** The query input for the view's tags: their entity ids. */
const tagIds = (selected: TagInfo[]) => selected.map((t) => t.id);

/**
 * Nodes of the view's tags `selected` (plus extending tags when `childTags`) with their dates and choice values mapped.
 * Test-only: the workspace reads through `readRaw` + `buildData`.
 */
export async function loadNodes(dq: Dq, tags: TagInfo[], selected: TagInfo[], opts: LoadNodesOptions): Promise<PlannerNode[]> {
  const raw = await dq(nodesQuery(tags, opts.dependsOn ?? null), tagIds(selected), CLASS_EXTENDS_RULES);
  return buildNodes(raw, tags, selected, opts.childTags, opts.zone ?? systemZone, opts.dependsOn ?? null);
}

/** The rows of the node and task queries for the view's tags, with what they were asked with (to tell when they are stale). */
export interface RawData {
  /** The node query string (`nodesQuery(tags, dependsOn)`): it names the pulled idents. */
  nodesQuery: string;
  /** The tag entity ids both queries were run with, in selection order. */
  tagIds: number[];
  /** The dependency property both queries pulled (N12); null = none. `buildData` reads the rows with it. */
  dependsOn: string | null;
  nodes: unknown[];
  tasks: unknown[];
}

/**
 * Runs the node and task queries for the view's tags `selected`, pulling the dependency property `dependsOn` (N12; null
 * = none). The task query does not need the nodes (it joins on the tags), so both are asked at once. With `prev` (rows
 * read earlier, e.g. with the tags shown before a refresh re-read them), only the stale part is asked again: the node
 * rows when the pull (`nodesQuery(tags, dependsOn)`) or the tag ids differ, the task rows when the tag ids or the
 * dependency property differ (a renamed tag is the same tag; the rows do not depend on the selection order, which
 * `buildData` applies); with neither, `prev`'s rows are reused and no query is sent.
 */
export async function readRaw(dq: Dq, tags: TagInfo[], selected: TagInfo[], dependsOn: string | null, prev?: RawData): Promise<RawData> {
  const query = nodesQuery(tags, dependsOn);
  const ids = tagIds(selected);
  const key = (list: number[]) => [...list].sort((a, b) => a - b).join(" ");
  const sameTags = !!prev && key(prev.tagIds) === key(ids);
  const [nodes, tasks] = await Promise.all([
    sameTags && prev!.nodesQuery === query ? prev!.nodes : dq(query, ids, CLASS_EXTENDS_RULES),
    sameTags && prev!.dependsOn === dependsOn ? prev!.tasks : dq(tasksQuery(dependsOn), ids, CLASS_EXTENDS_RULES),
  ]);
  return { nodesQuery: query, tagIds: ids, dependsOn, nodes, tasks };
}

/**
 * Raw rows → the nodes of the view's tags `selected` (`tags` maps the dates and closed values) and the #Task blocks
 * whose refs hit one of them, both read with the dependency property the rows were pulled with (`raw.dependsOn`).
 */
export function buildData(raw: RawData, tags: TagInfo[], selected: TagInfo[], opts: Omit<LoadNodesOptions, "dependsOn">): { nodes: PlannerNode[]; tasks: PlannerTask[] } {
  const zone = opts.zone ?? systemZone;
  const nodes = buildNodes(raw.nodes, tags, selected, opts.childTags, zone, raw.dependsOn);
  return { nodes, tasks: buildTasks(raw.tasks, nodes, zone, raw.dependsOn) };
}

/**
 * The nodes of the view's tags `selected` and the #Task blocks whose `:block/refs` hit them (inline refs and node-property links);
 * `buildTasks` keeps the tasks that hit a loaded node (with child tags off the query also returns tasks of child-tag nodes).
 * Test-only: the workspace reads through `readRaw` + `buildData`.
 */
export async function loadNodesAndTasks(dq: Dq, tags: TagInfo[], selected: TagInfo[], opts: LoadNodesOptions): Promise<{ nodes: PlannerNode[]; tasks: PlannerTask[] }> {
  return buildData(await readRaw(dq, tags, selected, opts.dependsOn ?? null), tags, selected, opts);
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
