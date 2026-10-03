// Shared fakes for the workspace and view tests (not a test file: no suite of its own).
import tagsFixture from "../core/__fixtures__/tags.json";
import propsFixture from "../core/__fixtures__/class-properties.json";
import nodesFixture from "../core/__fixtures__/nodes.json";
import datesFixture from "../core/__fixtures__/dates.json";
import tasksFixture from "../core/__fixtures__/tasks.json";
import { TAG_PROPERTIES_QUERY, TAGS_QUERY, type Dq } from "../core/schema";
import { nodesQuery, notRecycled, TASKS_QUERY, TITLES_QUERY } from "../core/queries";
import type { KanbanWriteDeps, StorageDeps, ViewBlock } from "../types";

/** Property values written by a fake write layer, by node uuid then property ident (with colon): closed value id, or null = removed. */
export type Edits = Map<string, Record<string, number | null>>;

/** The fixture row with the edits applied (a removed value loses its key, as in a real pull). */
function edited(row: Record<string, unknown>, edits?: Edits): Record<string, unknown> {
  const e = edits?.get(row.uuid as string);
  if (!e) return row;
  const out = { ...row };
  for (const [ident, id] of Object.entries(e)) {
    if (id === null) delete out[ident];
    else out[ident] = { id };
  }
  return out;
}

type Row = Record<string, unknown>;
const taskRows = () => (tasksFixture.taskRefs.detail as unknown as [Row][]).map(([t]) => t);


/** Pull-map key of an attribute (`:db/id` → `id`, `:block/title` → `title`, a property keeps its ident). */
const pullKey = (attr: string) => (attr.startsWith(":block/") ? attr.slice(7) : attr === ":db/id" ? "id" : attr);

/** Journal page id → journal day, from the fixture's journal-day rows (dates.json). */
const journalDays = new Map((datesFixture.date.detail as { raw: number; "journal-day": number }[]).map((r) => [r.raw, r["journal-day"]]));

/** What a node query pulls: its attributes, and the Date idents pulled with their page's journal day. */
interface NodePull {
  attrs: string[];
  dates: Set<string>;
}

/**
 * The pull of a node query built by `nodesQuery` for ANY tag list (the tags a refresh read may differ from the
 * fixture's: a property added or removed), or null when `query` is not one: same text as `nodesQuery` apart from the
 * pulled attributes. A Date ident appears as `{<ident> [:db/id :block/journal-day]}`.
 */
function nodePullOf(query: string): NodePull | null {
  const head = "[:find (pull ?b [";
  const template = nodesQuery([]);
  if (!query.startsWith(head) || query.slice(query.indexOf("])\n")) !== template.slice(template.indexOf("])\n"))) return null;
  const pull = query.slice(head.length, query.indexOf("])\n"));
  const dates = new Set([...pull.matchAll(/\{(\S+) \[:db\/id :block\/journal-day\]\}/g)].map((m) => m[1]));
  const attrs = pull.replace(/\{(\S+) \[:db\/id :block\/journal-day\]\}/g, "$1").split(/\s+/).filter(Boolean);
  return { attrs, dates };
}

/**
 * A `pull [*]` fixture row cut down to the attributes the node query pulls (absent attributes stay absent, like a real
 * pull); a pulled Date value `{id}` gets its page's `journal-day` from dates.json, as the nested pull returns it.
 */
function narrowNode(row: Row, pull: NodePull): Row {
  return Object.fromEntries(pull.attrs.filter((a) => pullKey(a) in row).map((a) => {
    const k = pullKey(a);
    const v = row[k] as { id: number };
    return [k, pull.dates.has(a) && journalDays.has(v.id) ? { id: v.id, "journal-day": journalDays.get(v.id) } : row[k]];
  }));
}

/** A fixture task row (T01 pull) cut down to the `TASKS_QUERY` pull: Status `{ident, title}`, Deadline, Scheduled, refs as `{id}`. */
function narrowTask(t: Row): Row {
  const out: Row = { id: t.id, uuid: t.uuid, title: t.title };
  for (const k of [":logseq.property/status", ":logseq.property/deadline", ":logseq.property/scheduled"]) if (k in t) out[k] = t[k];
  if (t.refs) out.refs = (t.refs as Row[]).map((r) => ({ id: r.id }));
  return out;
}

/**
 * The fixture #Task blocks in the shape `pull [*]` gives a node (cut down by `narrowNode` for `nodesQuery`): the T01 task pull carries tags and Status
 * as `{ident, title}`, so they are turned into `{id}` refs through the tag and closed-value ids of the same fixtures.
 */
function taskNodeRows(): [Row][] {
  const tags = (tagsFixture.query.detail as unknown as [{ id: number; ident: string }][]).map(([t]) => t);
  const props = propsFixture.query.detail as unknown as [string, { ident: string; "_closed-value-property"?: { id: number; ident?: string }[] }][];
  const statusValues = props.map(([, p]) => p).find((p) => p.ident === ":logseq.property/status")!["_closed-value-property"]!;
  return taskRows().map((t) => {
    const status = t[":logseq.property/status"] as { ident: string } | undefined;
    const row: Row = { id: t.id, uuid: t.uuid, title: t.title, tags: (t.tags as { ident: string }[]).map((x) => ({ id: tags.find((g) => g.ident === x.ident)!.id })) };
    if (status) row[":logseq.property/status"] = { id: statusValues.find((v) => v.ident === status.ident)!.id };
    return [row];
  });
}

/** uuid → title of every block in the fixtures (nodes, tasks and the blocks tasks reference): the TITLES_QUERY answer. */
function fixtureTitles(): Map<string, string> {
  const blocks = [
    ...(nodesFixture.projectWithExtends.detail as unknown as [Row][]).map(([n]) => n),
    ...(nodesFixture.meeting.detail as unknown as [Row][]).map(([n]) => n),
    ...taskRows(),
    ...taskRows().flatMap((t) => (t.refs as Row[] | undefined) ?? []),
  ];
  return new Map(blocks.map((b) => [String(b.uuid), String(b.title)]));
}

/**
 * A top-level string input as the host passes it to datascript: EDN-read (frontend/worker/handler/query.cljs
 * `query-input-value`), so a string that reads as a number, a boolean, nil or a keyword arrives as that value, and only
 * other strings stay strings. Seen live 2026-10-03 (T14, F2): tags titled "2026 goals", "true" and ":kw" were not found
 * when their title was the input. A number (or a collection) is passed through unchanged.
 */
export function hostReadInput(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const first = v.trim().split(/\s+/)[0] ?? "";
  if (/^[+-]?\d/.test(first)) return Number.parseFloat(first);
  if (first === "true" || first === "false") return first === "true";
  if (first === "nil") return null;
  if (first.startsWith(":")) return { keyword: first.slice(1) };
  return v;
}

/** Block or page ids (`:db/id`) that carry `:logseq.property/deleted-at` (in Recycle). */
export interface Recycled {
  /** Pages in Recycle: their blocks keep `:block/page` → the page and have no deleted-at themselves (seen live 2026-10-03, T14 F4). */
  pages?: number[];
  /** Blocks (nodes or tasks) that carry deleted-at themselves. */
  blocks?: number[];
}

/**
 * Answers the real loaders' queries from the T01 fixtures; nodes exist for Project (+ Client project) and Meeting, and
 * with `taskNodes` for Task (the fixture task blocks). TITLES_QUERY is answered from every fixture block's uuid and title.
 * `projectCopies` adds that many copies of Website relaunch ("Website relaunch 2", …; same dates, no tasks) to crowd a
 * calendar day; `edits` applies values written by `fakeGraph`. `retitle` renames fixture tags (original title → new
 * title) in the tag rows, nothing else (T14: titles the host's input reading mangles, and same-titled tags).
 * `recycled` marks pages or blocks as in Recycle; the node and task queries leave them out only when they carry the
 * Recycle clauses (`notRecycled`), as datascript would.
 * Every top-level string input goes through `hostReadInput` first, like the host's.
 */
export const fixtureDq = (opts: { noTags?: boolean; projectCopies?: number; edits?: Edits; taskNodes?: boolean; retitle?: Record<string, string>; recycled?: Recycled } = {}): Dq => async (query, ...rawInputs) => {
  const inputs = rawInputs.map(hostReadInput);
  if (query === TAGS_QUERY) return opts.noTags ? [] : tagRows();
  if (query === TAG_PROPERTIES_QUERY) return opts.noTags ? [] : (propsFixture.query.detail as unknown[]);
  const pull = nodePullOf(query);
  if (pull) {
    const live = liveFilter(query, "?b");
    return nodeRows(inputs[0]).filter(([n]) => live(n)).map(([n]) => [narrowNode(n, pull)]);
  }
  if (query === TASKS_QUERY) {
    // Bound by the tag: the fixture tasks that reference one of its nodes (child tags included, as the query's rule does).
    const liveNode = liveFilter(query, "?n");
    const liveTask = liveFilter(query, "?b");
    const ids = new Set(nodeRows(inputs[0]).filter(([n]) => liveNode(n)).map(([n]) => n.id));
    return taskRows().filter((t) => liveTask(t) && ((t.refs as Row[] | undefined) ?? []).some((r) => ids.has(r.id))).map((t) => [narrowTask(t)]);
  }
  if (query === TITLES_QUERY) {
    const titles = fixtureTitles();
    return (inputs[0] as string[]).filter((u) => titles.has(u)).map((u) => [u, titles.get(u)]);
  }
  throw new Error(`unexpected query ${query}`);

  /** The fixture tag rows with `retitle` applied. */
  function tagRows(): [Row][] {
    return (tagsFixture.query.detail as unknown as [Row][]).map(([t]) => [opts.retitle && String(t.title) in opts.retitle ? { ...t, title: opts.retitle[String(t.title)] } : t]);
  }

  /**
   * The datascript meaning of the Recycle clauses for variable `v`, when the query has them: the block has no
   * deleted-at, and neither has its `:block/page`. Without them every row passes (the host returns recycled blocks).
   */
  function liveFilter(q: string, v: string): (row: Row) => boolean {
    if (!q.includes(notRecycled(v))) return () => true;
    const pages = new Set(opts.recycled?.pages ?? []);
    const blocks = new Set(opts.recycled?.blocks ?? []);
    return (row) => !blocks.has(row.id as number) && !pages.has((row.page as { id?: number } | undefined)?.id as number);
  }

  /**
   * The `pull [*]` fixture rows of the nodes of the tag the input names (child tags included), with the edits applied.
   * The node and task queries join the input as the tag's entity id: a number matches the tag with that id; anything
   * else matches nothing (a title input, even one the host did not read as a number, a boolean or a keyword).
   */
  function nodeRows(input: unknown): [Row][] {
    const rows = tagRows().map(([t]) => t);
    const matched = typeof input === "number" ? rows.filter((t) => t.id === input) : [];
    const original = (t: Row) => (tagsFixture.query.detail as unknown as [Row][]).find(([o]) => o.id === t.id)![0].title;
    return matched.flatMap((t) => rowsOfTitle(original(t)));
  }

  function rowsOfTitle(title: unknown): [Row][] {
    if (title === "Project") {
      const rows = nodesFixture.projectWithExtends.detail as unknown as [Record<string, unknown>][];
      const site = rows.find(([n]) => n.title === "Website relaunch")![0];
      const copies = Array.from({ length: opts.projectCopies ?? 0 }, (_, i) => [{
        ...site, id: 9000 + i, uuid: `6a000000-0000-4000-8000-0000000090${String(i).padStart(2, "0")}`,
        title: `Website relaunch ${i + 2}`, content: `Website relaunch ${i + 2}`, "full-title": `Website relaunch ${i + 2}`,
      }]);
      return [...rows, ...copies].map(([n]) => [edited(n, opts.edits)]);
    }
    if (title === "Task" && opts.taskNodes) return taskNodeRows();
    if (title === "Meeting") return (nodesFixture.meeting.detail as unknown as [Record<string, unknown>][]).map(([n]) => [edited(n, opts.edits)]);
    return [];
  }
};

/**
 * What the host does with a new block's text (seen live 2026-10-03, T14 F3): "#Project kanban" became the title
 * "#[[<tag uuid>]] kanban" with the block tagged #Project; `[[…]]` makes a ref. The fakes rewrite each `#word` and tag
 * the block; `[[` tags it too (one tag is enough for a read-back to see it).
 */
export const hostTitle = (name: string) => name.replace(/#([^\s#]+)/g, "#[[6a000000-0000-4000-8000-00000000aaaa]]");
export const hostTags = (name: string) => (/#[^\s#]|\[\[/.test(name) ? 1 : 0);

/** In-memory saved-views graph; `silent` writes resolve without storing anything, like the real API on failure. */
export function fakeStorage(opts: { silent?: boolean; blocks?: ViewBlock[] } = {}): StorageDeps {
  let page: string | null = opts.blocks ? "page-1" : null;
  let blocks: ViewBlock[] = opts.blocks ?? [];
  const tags = new Map<string, number>();
  let n = 0;
  return {
    findPage: async () => page,
    createPage: async () => void (page = "page-1"),
    ensureConfigProperty: async () => {},
    listBlocks: async () => blocks.map((b) => ({ ...b })),
    readBlock: async (u) => blocks.find((b) => b.uuid === u) ?? null,
    appendBlock: async (_p, name) => {
      if (opts.silent) return "ghost";
      const uuid = `b-${++n}`;
      blocks.push({ uuid, name: hostTitle(name), config: null });
      tags.set(uuid, hostTags(name));
      return uuid;
    },
    blockTags: async (u) => tags.get(u) ?? 0,
    setConfig: async (u, text) => {
      const b = blocks.find((x) => x.uuid === u);
      if (b) b.config = text;
    },
    removeBlock: async (u) => void (blocks = blocks.filter((b) => b.uuid !== u)),
  };
}

/** For views that never write: any Kanban write call fails the test. */
export const noWrites: KanbanWriteDeps = {
  upsertBlockProperty: async () => { throw new Error("unexpected upsertBlockProperty"); },
  removeBlockProperty: async () => { throw new Error("unexpected removeBlockProperty"); },
  readChoice: async () => { throw new Error("unexpected readChoice"); },
};

const fixtureRows = () =>
  [...(nodesFixture.projectWithExtends.detail as unknown as [Record<string, unknown>][]), ...(nodesFixture.meeting.detail as unknown as [Record<string, unknown>][])].map(([n]) => n);

/**
 * A graph that Kanban moves can write to: `dq` answers from the fixtures with the written values applied, `writes`
 * behaves like the observed SDK (T01): both calls resolve null whether they worked or not; only a full ident without the
 * leading colon and a numeric closed value id change the real property (an unqualified key would create a plugin
 * property, a uuid or ident string blanks the value). `silent` makes every call do nothing, like a failed write;
 * `hold` (when set) delays the write calls until it resolves. `calls` records every call in order.
 */
export function fakeGraph(opts: { projectCopies?: number } = {}) {
  const edits: Edits = new Map();
  const calls: unknown[][] = [];
  const state = { silent: false, hold: null as Promise<void> | null };
  const FULL_KEY = /^[a-z][\w.-]*\/[\w.-]+$/i;
  const put = (uuid: string, key: string, id: number | null) => {
    if (state.silent || !FULL_KEY.test(key)) return;
    edits.set(uuid, { ...edits.get(uuid), [`:${key}`]: id });
  };
  const writes: KanbanWriteDeps = {
    upsertBlockProperty: async (uuid, key, valueId) => {
      calls.push(["upsertBlockProperty", uuid, key, valueId]);
      if (state.hold) await state.hold;
      put(uuid, key, typeof valueId === "number" ? valueId : null);
      return null;
    },
    removeBlockProperty: async (uuid, key) => {
      calls.push(["removeBlockProperty", uuid, key]);
      if (state.hold) await state.hold;
      put(uuid, key, null);
      return null;
    },
    readChoice: async (uuid, ident) => {
      calls.push(["readChoice", uuid, ident]);
      const e = edits.get(uuid);
      if (e && ident in e) return e[ident] === null ? null : { id: e[ident]!, ident: null };
      const row = fixtureRows().find((n) => n.uuid === uuid);
      if (!row) throw new Error(`no node ${uuid}`);
      const v = row[ident] as { id: number } | undefined;
      return v ? { id: v.id, ident: null } : null;
    },
  };
  return { dq: fixtureDq({ edits, projectCopies: opts.projectCopies }), writes, calls, edits, state };
}

/** A manual clock for `Later`: timers run only when `advance` moves time past them, in due order; `pending` counts live timers. */
export function fakeClock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const later = (fn: () => void, ms: number) => {
    const id = next++;
    timers.set(id, { at: now + ms, fn });
    return () => void timers.delete(id);
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { later, advance, pending: () => timers.size };
}

/** A `DB.onChanged` stand-in: `fire()` is an event; `subscribe` returns the unsubscribe. */
export function fakeChangeFeed() {
  const subs = new Set<() => void>();
  return {
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    fire: () => subs.forEach((cb) => cb()),
    count: () => subs.size,
  };
}
