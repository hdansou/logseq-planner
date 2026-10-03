// Shared fakes for the workspace and view tests (not a test file: no suite of its own).
import tagsFixture from "../core/__fixtures__/tags.json";
import propsFixture from "../core/__fixtures__/class-properties.json";
import nodesFixture from "../core/__fixtures__/nodes.json";
import datesFixture from "../core/__fixtures__/dates.json";
import tasksFixture from "../core/__fixtures__/tasks.json";
import { TAG_PROPERTIES_QUERY, TAGS_QUERY, type Dq } from "../core/schema";
import { JOURNAL_DAYS_QUERY, NODES_QUERY, TASKS_QUERY, TITLES_QUERY } from "../core/queries";
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

/**
 * The fixture #Task blocks in the shape `pull [*]` gives a node (NODES_QUERY): the T01 task pull carries tags and Status
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
 * Answers the real loaders' queries from the T01 fixtures; nodes exist for Project (+ Client project) and Meeting, and
 * with `taskNodes` for Task (the fixture task blocks). TITLES_QUERY is answered from every fixture block's uuid and title.
 * `projectCopies` adds that many copies of Website relaunch ("Website relaunch 2", …; same dates, no tasks) to crowd a
 * calendar day; `edits` applies values written by `fakeGraph`.
 */
export const fixtureDq = (opts: { noTags?: boolean; projectCopies?: number; edits?: Edits; taskNodes?: boolean } = {}): Dq => async (query, ...inputs) => {
  if (query === TAGS_QUERY) return opts.noTags ? [] : (tagsFixture.query.detail as unknown[]);
  if (query === TAG_PROPERTIES_QUERY) return opts.noTags ? [] : (propsFixture.query.detail as unknown[]);
  if (query === NODES_QUERY) {
    if (inputs[0] === "Project") {
      const rows = nodesFixture.projectWithExtends.detail as unknown as [Record<string, unknown>][];
      const site = rows.find(([n]) => n.title === "Website relaunch")![0];
      const copies = Array.from({ length: opts.projectCopies ?? 0 }, (_, i) => [{
        ...site, id: 9000 + i, uuid: `6a000000-0000-4000-8000-0000000090${String(i).padStart(2, "0")}`,
        title: `Website relaunch ${i + 2}`, content: `Website relaunch ${i + 2}`, "full-title": `Website relaunch ${i + 2}`,
      }]);
      return [...rows, ...copies].map(([n]) => [edited(n, opts.edits)]);
    }
    if (inputs[0] === "Task" && opts.taskNodes) return taskNodeRows();
    if (inputs[0] === "Meeting") return (nodesFixture.meeting.detail as unknown as [Record<string, unknown>][]).map(([n]) => [edited(n, opts.edits)]);
    return [];
  }
  if (query === JOURNAL_DAYS_QUERY) return datesFixture.date.detail as unknown[];
  if (query === TASKS_QUERY) return tasksFixture.taskRefs.detail as unknown[];
  if (query === TITLES_QUERY) {
    const titles = fixtureTitles();
    return (inputs[0] as string[]).filter((u) => titles.has(u)).map((u) => [u, titles.get(u)]);
  }
  throw new Error(`unexpected query ${query}`);
};

/** In-memory saved-views graph; `silent` writes resolve without storing anything, like the real API on failure. */
export function fakeStorage(opts: { silent?: boolean; blocks?: ViewBlock[] } = {}): StorageDeps {
  let page: string | null = opts.blocks ? "page-1" : null;
  let blocks: ViewBlock[] = opts.blocks ?? [];
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
      blocks.push({ uuid, name, config: null });
      return uuid;
    },
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
export function fakeGraph() {
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
  return { dq: fixtureDq({ edits }), writes, calls, edits, state };
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
