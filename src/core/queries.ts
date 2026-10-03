// Graph queries for nodes and tasks. The datascript call is injected (see `Dq`); no SDK use here.
import type { PlannerNode, PlannerTask, TagInfo } from "../types";
import type { Dq } from "./schema";
import { buildNodes, buildTasks, journalPageIds, systemZone, type ZoneOffset } from "./normalize";

/** Rules go last in `:in` as a string with a leading space (scripts/probe.mjs `RULES`). */
export const CLASS_EXTENDS_RULES = ` [[(class-extends ?p ?c) [?c :logseq.property.class/extends ?p]]
  [(class-extends ?p ?c) [?t :logseq.property.class/extends ?p] (class-extends ?t ?c)]]`;

// Same as probe query `nodesOfTagWithExtends` (fixture nodes.json).
export const NODES_QUERY = `[:find (pull ?b [*])
          :in $ ?tag-title %
          :where [?tag :block/tags :logseq.class/Tag] [?tag :block/title ?tag-title]
                 [?b :block/tags ?t] (or [(= ?t ?tag)] (class-extends ?tag ?t))]`;

// The probe's `dateValues` rows (`:keys raw journal-day`), looked up by journal page id.
export const JOURNAL_DAYS_QUERY = `[:find ?raw ?journal-day
          :keys raw journal-day
          :in $ [?raw ...]
          :where [?raw :block/journal-day ?journal-day]]`;

// Same pull as probe query `taskRefs` (fixture tasks.json), over every #Task block of the graph.
export const TASKS_QUERY = `[:find (pull ?b [:db/id :block/uuid :block/title
                        {:block/tags [:db/ident :block/title]}
                        {:logseq.property/status [:db/ident :block/title]}
                        :logseq.property/deadline :logseq.property/scheduled
                        {:block/refs [:db/id :db/ident :block/uuid :block/title {:block/tags [:db/ident]}]}])
          :where [?b :block/tags :logseq.class/Task]]`;

export interface LoadNodesOptions {
  /** Include nodes of tags that extend `tag` (any depth). */
  childTags: boolean;
  /** Local zone offset; defaults to the machine's. */
  zone?: ZoneOffset;
}

/** Nodes of `tag` (plus extending tags when `childTags`) with their dates and choice values mapped. */
export async function loadNodes(dq: Dq, tags: TagInfo[], tag: TagInfo, opts: LoadNodesOptions): Promise<PlannerNode[]> {
  const raw = await dq(NODES_QUERY, tag.title, CLASS_EXTENDS_RULES);
  const pageIds = journalPageIds(raw, tags, tag, opts.childTags);
  const days = pageIds.length > 0 ? await dq(JOURNAL_DAYS_QUERY, pageIds) : [];
  return buildNodes(raw, days, tags, tag, opts.childTags, opts.zone ?? systemZone);
}

/** #Task blocks whose `:block/refs` hit one of `nodes` (inline refs and node-property links). */
export async function loadTasks(dq: Dq, nodes: PlannerNode[]): Promise<PlannerTask[]> {
  if (nodes.length === 0) return [];
  return buildTasks(await dq(TASKS_QUERY), nodes);
}
