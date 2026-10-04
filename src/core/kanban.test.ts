import { describe, expect, it, vi } from "vitest";
import writesFixture from "./__fixtures__/writes.json";
import { EMPTY_PLACEHOLDER } from "./normalize";
import { loadTagInfos } from "./schema";
import { CLASS_EXTENDS_RULES, loadNodes, loadNodesAndTasks, nodesQuery } from "./queries";
import { titlesByUuid } from "./display-title";
import { viewItems } from "./layout-common";
import {
  findCell, layoutKanban, moveDescriptor, movedNode, moveTarget, NO_VALUE, priorityProp, writeKey, writeMove,
  type KanbanInput, type KanbanLayout, type PropertyWrite,
} from "./kanban";
import { fixtureDq } from "../ui/test-fakes";
import type { KanbanWriteDeps, LocalDate, PlannerNode, TagInfo } from "../types";

const dq = fixtureDq();
const tags = await loadTagInfos(dq);
const tag = (title: string): TagInfo => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
const west5 = () => -300;
const TODAY = "2026-10-03";
const choiceProp = (t: TagInfo, title: string) => t.choiceProps.find((p) => p.title === title)!;
const value = (t: TagInfo, prop: string, title: string) => choiceProp(t, prop).values.find((v) => v.title === title)!;
const statusValues = choiceProp(tag("Task"), "Status").values;
const SITE = "6a000000-0000-4000-8000-000000000001";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const ACME = "6a000000-0000-4000-8000-000000000003";
const ARCHIVE = "6a000000-0000-4000-8000-000000000004";

/** #Project from the fixtures (child tags included), columns by Status, optional Owner lanes. */
async function project(over: Partial<KanbanInput> = {}): Promise<KanbanLayout> {
  const t = tag("Project");
  const { nodes, tasks } = await loadNodesAndTasks(dq, tags, t, { childTags: true, zone: west5 });
  const start = t.dateProps.find((p) => p.title === "Start")!.ident;
  const end = t.dateProps.find((p) => p.title === "End")!.ident;
  return layoutKanban({
    items: viewItems(nodes, tasks, start, end, statusValues), columnProp: choiceProp(t, "Status"), laneProp: null, sort: "due",
    today: TODAY, choiceProps: t.choiceProps, doneValues: {}, titles: titlesByUuid(nodes), pending: new Set(), hidden: [], ...over,
  });
}

const cardsIn = (l: KanbanLayout, col: string, lane: string | null = null) =>
  findCell(l, col, lane).cards.map((c) => c.title);
const colKey = (t: TagInfo, prop: string, title: string) => value(t, prop, title).uuid;

/** Synthetic #Task nodes: [title, deadline day | null, priority title | null], all Todo. */
function tasksBoard(spec: [string, string | null, string | null][], sort: KanbanInput["sort"]) {
  const t = tag("Task");
  const deadline = t.dateProps.find((p) => p.title === "Deadline")!.ident;
  const status = choiceProp(t, "Status");
  const priority = choiceProp(t, "Priority");
  const nodes: PlannerNode[] = spec.map(([title, day, pri], i) => ({
    id: i + 1, uuid: `00000000-0000-4000-8000-00000000000${i + 1}`, title, tagIds: [],
    dates: day ? { [deadline]: { day, time: null } as LocalDate } : {},
    choices: { [status.ident]: value(t, "Status", "Todo"), ...(pri ? { [priority.ident]: value(t, "Priority", pri) } : {}) },
  }));
  return layoutKanban({
    items: viewItems(nodes, [], null, deadline, statusValues), columnProp: status, laneProp: null, sort, today: TODAY,
    choiceProps: t.choiceProps, doneValues: {}, titles: titlesByUuid(nodes), pending: new Set(), hidden: [],
  });
}
const SORT_SPEC: [string, string | null, string | null][] = [
  ["Bravo", "2026-10-05", "Low"], ["Alpha", "2026-10-20", "Urgent"], ["Charlie", null, "High"], ["Delta", "2026-10-01", null],
];

describe("columns", () => {
  it("are the closed values of the column property in order, then No <prop>; counts per column", async () => {
    const l = await project();
    expect(l.columns.map((c) => c.title)).toEqual(["Backlog", "Todo", "Doing", "In Review", "Done", "Canceled", "No Status"]);
    expect(l.columns[l.columns.length - 1].key).toBe(NO_VALUE);
    expect(l.columns[l.columns.length - 1].value).toBeNull();
    expect(l.columns.map((c) => c.count)).toEqual([1, 1, 1, 1, 0, 0, 0]);
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0].lane).toBeNull();
    const p = tag("Project");
    expect(cardsIn(l, colKey(p, "Status", "Doing"))).toEqual(["Website relaunch"]);
    expect(cardsIn(l, colKey(p, "Status", "Backlog"))).toEqual(["Archive cleanup"]);
    expect(cardsIn(l, colKey(p, "Status", "In Review"))).toEqual(["Acme rollout"]);
    expect(cardsIn(l, NO_VALUE)).toEqual([]);
  });

  it("a node without a value sits in No <prop>", async () => {
    const p = tag("Project");
    const l = await project({ columnProp: choiceProp(p, "Owner") });
    expect(l.columns.map((c) => c.title)).toEqual(["Alice", "Bob", "No Owner"]);
    expect(cardsIn(l, NO_VALUE)).toEqual(["Archive cleanup"]);
  });

  it("marks done columns with the view's done values (built-in flags by default, override wins)", async () => {
    const l = await project();
    expect(l.columns.filter((c) => c.done).map((c) => c.title)).toEqual(["Done", "Canceled"]);
    const p = tag("Project");
    const status = choiceProp(p, "Status");
    const o = await project({ doneValues: { [status.ident]: [value(p, "Status", "In Review").uuid] } });
    expect(o.columns.filter((c) => c.done).map((c) => c.title)).toEqual(["In Review"]);
    expect(findCell(o, colKey(p, "Status", "In Review"), null).cards[0].done).toBe(true);
  });
});

describe("hidden columns (N08)", () => {
  const p = () => tag("Project");
  const titles = (l: KanbanLayout) => l.columns.map((c) => c.title);
  const onBoard = (l: KanbanLayout) => l.rows.flatMap((r) => r.cells.flatMap((c) => c.cards.map((x) => x.uuid))).sort();
  const hideStatus = (...names: string[]) => names.map((n) => (n === "No Status" ? NO_VALUE : colKey(p(), "Status", n)));

  it("are left out of the columns and cells; their cards are not on the board; shown counts unchanged", async () => {
    const l = await project({ hidden: hideStatus("Backlog", "In Review", "Canceled", "No Status") });
    expect(titles(l)).toEqual(["Todo", "Doing", "Done"]);
    expect(l.columns.map((c) => c.count)).toEqual([1, 1, 0]);
    expect(l.rows[0].cells.map((c) => c.column.title)).toEqual(["Todo", "Doing", "Done"]);
    expect(onBoard(l)).toEqual([MOBILE, SITE].sort());
    // every column of the property stays listed (the Show menu, the Move menu)
    expect(l.allColumns.map((c) => c.title)).toEqual(["Backlog", "Todo", "Doing", "In Review", "Done", "Canceled", "No Status"]);
    expect(l.allColumns[1]).toBe(l.columns[0]);
  });

  it("No <prop> can be hidden: cards without a value leave the board", async () => {
    const l = await project({ columnProp: choiceProp(p(), "Owner"), hidden: [NO_VALUE] });
    expect(titles(l)).toEqual(["Alice", "Bob"]);
    expect(onBoard(l)).not.toContain(ARCHIVE);
  });

  it("swimlanes: every lane is still listed; lane counts count only cards in shown columns", async () => {
    const l = await project({ laneProp: choiceProp(p(), "Owner"), hidden: hideStatus("Doing") });
    expect(l.lanes.map((x) => x.title)).toEqual(["Alice", "Bob", "No Owner"]);
    expect(l.lanes.map((x) => x.count)).toEqual([1, 1, 1]);
    expect(l.rows.map((r) => r.cells.length)).toEqual([6, 6, 6]);
    const empty = await project({ laneProp: choiceProp(p(), "Owner"), hidden: hideStatus("Todo") });
    expect(empty.lanes.map((x) => [x.title, x.count])).toEqual([["Alice", 2], ["Bob", 0], ["No Owner", 1]]);
  });

  it("keys that match no current value are ignored; when every listed key is unknown nothing is hidden", async () => {
    const l = await project({ hidden: ["no-such-uuid", ...hideStatus("Done")] });
    expect(titles(l)).toEqual(["Backlog", "Todo", "Doing", "In Review", "Canceled", "No Status"]);
    const none = await project({ hidden: ["no-such-uuid", "another"] });
    expect(titles(none)).toHaveLength(7);
  });

  it("a list that would hide every column hides none (at least one column stays shown)", async () => {
    const l = await project({ hidden: hideStatus("Backlog", "Todo", "Doing", "In Review", "Done", "Canceled", "No Status") });
    expect(titles(l)).toHaveLength(7);
  });

  it("a pending card whose target column is hidden leaves the board like any other card", async () => {
    const t = p();
    const { nodes, tasks } = await loadNodesAndTasks(dq, tags, t, { childTags: true, zone: west5 });
    const status = choiceProp(t, "Status");
    const moved = nodes.map((n) => (n.uuid === SITE ? movedNode(n, [{ kind: "set", uuid: SITE, node: "", prop: status, value: value(t, "Status", "Canceled"), previous: null }]) : n));
    const l = await project({ items: viewItems(moved, tasks, null, null, statusValues), pending: new Set([SITE]), hidden: hideStatus("Canceled") });
    expect(onBoard(l)).not.toContain(SITE);
    expect(l.columns.find((c) => c.title === "Doing")!.count).toBe(0);
  });

  it("moveTarget: a hidden column is still a target (the Move menu lists it); the write is the same", async () => {
    const l = await project({ hidden: hideStatus("Done") });
    const from = findCell(l, colKey(p(), "Status", "Doing"), null);
    const to = moveTarget(l, colKey(p(), "Status", "Done"), null);
    expect(to.column.title).toBe("Done");
    expect(moveDescriptor(from.cards[0], from, to)).toEqual<PropertyWrite[]>([
      { kind: "set", uuid: SITE, node: "Website relaunch", prop: { ident: choiceProp(p(), "Status").ident, title: "Status" }, value: value(p(), "Status", "Done"), previous: value(p(), "Status", "Doing") },
    ]);
    expect(() => moveTarget(l, "no-such-uuid", null)).toThrow(/No Kanban column/);
  });
});

describe("swimlanes", () => {
  it("one row per lane value, then No <prop>; every row has every column", async () => {
    const p = tag("Project");
    const l = await project({ laneProp: choiceProp(p, "Owner") });
    expect(l.lanes.map((x) => x.title)).toEqual(["Alice", "Bob", "No Owner"]);
    expect(l.lanes.map((x) => x.count)).toEqual([2, 1, 1]);
    expect(l.rows.map((r) => r.cells.length)).toEqual([7, 7, 7]);
    const alice = colKey(p, "Owner", "Alice");
    const bob = colKey(p, "Owner", "Bob");
    expect(cardsIn(l, colKey(p, "Status", "Doing"), alice)).toEqual(["Website relaunch"]);
    expect(cardsIn(l, colKey(p, "Status", "In Review"), alice)).toEqual(["Acme rollout"]);
    expect(cardsIn(l, colKey(p, "Status", "Todo"), bob)).toEqual(["Mobile app"]);
    expect(cardsIn(l, colKey(p, "Status", "Backlog"), NO_VALUE)).toEqual(["Archive cleanup"]);
    expect(cardsIn(l, colKey(p, "Status", "Backlog"), alice)).toEqual([]);
    // column counts cover every lane
    expect(l.columns.map((c) => c.count)).toEqual([1, 1, 1, 1, 0, 0, 0]);
  });
});

describe("cards", () => {
  it("carry the display title, due date text, progress and the other choice values", async () => {
    const l = await project();
    const p = tag("Project");
    const site = findCell(l, colKey(p, "Status", "Doing"), null).cards[0];
    expect(site.uuid).toBe(SITE);
    expect(site.due).toEqual({ day: "2026-10-23", time: null });
    expect(site.when).toBe("ends 23 Oct");
    expect(site.progress).toEqual({ done: 1, total: 2 });
    expect(site.meta).toEqual(["Alice"]);
    expect(site.late).toBe(false);
    const mobile = findCell(l, colKey(p, "Status", "Todo"), null).cards[0];
    expect(mobile.when).toBe("8 Oct"); // one date: a point
    const archive = findCell(l, colKey(p, "Status", "Backlog"), null).cards[0];
    expect(archive.due).toBeNull();
    expect(archive.when).toBe("no date");
    expect(archive.meta).toEqual([]);
    expect(site.label).toBe("Website relaunch, ends 23 Oct, 1 of 2 tasks done, Alice");
  });

  it("an open card past its end is late; a done one is not", async () => {
    const p = tag("Project");
    const l = await project({ today: "2026-10-10" });
    const acme = findCell(l, colKey(p, "Status", "In Review"), null).cards[0];
    expect(acme.late).toBe(true);
    expect(acme.when).toBe("ends 8 Oct, 2 days late");
    const status = choiceProp(p, "Status");
    const done = await project({ today: "2026-10-10", doneValues: { [status.ident]: [value(p, "Status", "In Review").uuid] } });
    expect(findCell(done, colKey(p, "Status", "In Review"), null).cards[0].late).toBe(false);
  });

  it("flags pending cards", async () => {
    const l = await project({ pending: new Set([ACME]) });
    const all = l.rows.flatMap((r) => r.cells.flatMap((c) => c.cards));
    expect(all.filter((c) => c.pending).map((c) => c.uuid)).toEqual([ACME]);
  });
});

describe("sort inside a cell", () => {
  it("due (default): by due/end date, undated last", () => {
    expect(cardsIn(tasksBoard(SORT_SPEC, "due"), colKey(tag("Task"), "Status", "Todo"))).toEqual(["Delta", "Bravo", "Alpha", "Charlie"]);
  });

  it("priority: the tag's Priority choice, highest (last value) first, none last", () => {
    expect(priorityProp(tag("Task"))!.title).toBe("Priority");
    expect(priorityProp(tag("Project"))).toBeNull();
    expect(cardsIn(tasksBoard(SORT_SPEC, "priority"), colKey(tag("Task"), "Status", "Todo"))).toEqual(["Alpha", "Charlie", "Bravo", "Delta"]);
  });

  it("title", () => {
    expect(cardsIn(tasksBoard([...SORT_SPEC].reverse(), "title"), colKey(tag("Task"), "Status", "Todo"))).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("the card shows its priority value", () => {
    const l = tasksBoard(SORT_SPEC, "due");
    const alpha = findCell(l, colKey(tag("Task"), "Status", "Todo"), null).cards.find((c) => c.title === "Alpha")!;
    expect(alpha.priority).toEqual({ title: "Urgent", key: "urgent" });
    expect(alpha.meta).toEqual([]); // Priority is shown as the priority, not again as meta
  });
});

describe("moveDescriptor", () => {
  const p = () => tag("Project");
  const status = () => choiceProp(p(), "Status");
  const owner = () => choiceProp(p(), "Owner");

  it("same cell: no write", async () => {
    const l = await project({ laneProp: owner() });
    const from = findCell(l, colKey(p(), "Status", "Doing"), colKey(p(), "Owner", "Alice"));
    expect(moveDescriptor(from.cards[0], from, from)).toEqual([]);
  });

  it("cross-column: one write of the column property with the closed value", async () => {
    const l = await project();
    const from = findCell(l, colKey(p(), "Status", "Doing"), null);
    const to = findCell(l, colKey(p(), "Status", "Done"), null);
    expect(moveDescriptor(from.cards[0], from, to)).toEqual<PropertyWrite[]>([
      { kind: "set", uuid: SITE, node: "Website relaunch", prop: { ident: status().ident, title: "Status" }, value: value(p(), "Status", "Done"), previous: value(p(), "Status", "Doing") },
    ]);
  });

  it("cross-lane in the same column: one write of the lane property", async () => {
    const l = await project({ laneProp: owner() });
    const from = findCell(l, colKey(p(), "Status", "Doing"), colKey(p(), "Owner", "Alice"));
    const to = findCell(l, colKey(p(), "Status", "Doing"), colKey(p(), "Owner", "Bob"));
    expect(moveDescriptor(from.cards[0], from, to)).toEqual([
      { kind: "set", uuid: SITE, node: "Website relaunch", prop: { ident: owner().ident, title: "Owner" }, value: value(p(), "Owner", "Bob"), previous: value(p(), "Owner", "Alice") },
    ]);
  });

  it("cross-column and cross-lane: two writes, column first", async () => {
    const l = await project({ laneProp: owner() });
    const from = findCell(l, colKey(p(), "Status", "Todo"), colKey(p(), "Owner", "Bob"));
    const to = findCell(l, colKey(p(), "Status", "Doing"), colKey(p(), "Owner", "Alice"));
    const writes = moveDescriptor(from.cards[0], from, to);
    expect(writes.map((w) => [w.kind, w.prop.title, w.kind === "set" ? w.value.title : null])).toEqual([["set", "Status", "Doing"], ["set", "Owner", "Alice"]]);
    expect(writes.every((w) => w.uuid === MOBILE)).toBe(true);
  });

  it("drop on No <prop> (column or lane): a removal", async () => {
    const l = await project({ laneProp: owner() });
    const from = findCell(l, colKey(p(), "Status", "Doing"), colKey(p(), "Owner", "Alice"));
    expect(moveDescriptor(from.cards[0], from, findCell(l, colKey(p(), "Status", "Doing"), NO_VALUE)))
      .toEqual([{ kind: "remove", uuid: SITE, node: "Website relaunch", prop: { ident: owner().ident, title: "Owner" }, previous: value(p(), "Owner", "Alice") }]);
    expect(moveDescriptor(from.cards[0], from, findCell(l, NO_VALUE, colKey(p(), "Owner", "Alice"))))
      .toEqual([{ kind: "remove", uuid: SITE, node: "Website relaunch", prop: { ident: status().ident, title: "Status" }, previous: value(p(), "Status", "Doing") }]);
  });

  it("from No <prop> to a value: a set", async () => {
    const l = await project({ laneProp: owner() });
    const from = findCell(l, colKey(p(), "Status", "Backlog"), NO_VALUE);
    const writes = moveDescriptor(from.cards[0], from, findCell(l, colKey(p(), "Status", "Backlog"), colKey(p(), "Owner", "Bob")));
    expect(writes).toEqual([{ kind: "set", uuid: ARCHIVE, node: "Archive cleanup", prop: { ident: owner().ident, title: "Owner" }, value: value(p(), "Owner", "Bob"), previous: null }]);
  });

  it("movedNode applies the writes to a copy (optimistic position)", async () => {
    const nodes = await loadNodes(dq, tags, p(), { childTags: true, zone: west5 });
    const site = nodes.find((n) => n.uuid === SITE)!;
    const moved = movedNode(site, [
      { kind: "set", uuid: SITE, node: "", prop: { ident: status().ident, title: "Status" }, value: value(p(), "Status", "Done"), previous: null },
      { kind: "remove", uuid: SITE, node: "", prop: { ident: owner().ident, title: "Owner" }, previous: null },
    ]);
    expect(moved.choices[status().ident].title).toBe("Done");
    expect(moved.choices[owner().ident]).toBeUndefined();
    expect(site.choices[status().ident].title).toBe("Doing"); // the original is untouched
  });
});

describe("writeMove (T01: full ident, closed value entity id, read back)", () => {
  const p = () => tag("Project");
  const set = (prop: string, title: string, previous: string | null = null): PropertyWrite =>
    ({ kind: "set", uuid: SITE, node: "Website relaunch", prop: { ident: choiceProp(p(), prop).ident, title: prop }, value: value(p(), prop, title), previous: previous === null ? null : value(p(), prop, previous) });
  const remove = (prop: string): PropertyWrite => ({ kind: "remove", uuid: SITE, node: "Website relaunch", prop: { ident: choiceProp(p(), prop).ident, title: prop }, previous: null });

  type Stored = { id: number; ident: string | null } | null;
  /**
   * A fake of the three SDK calls: `stored` is what the graph holds; `silent` = the call resolves and changes nothing;
   * `removed` = what a removal leaves (null = the attribute is gone, as for a user property in T01).
   */
  function deps(stored: Record<string, Stored>, silent = false, removed: Stored = null) {
    const d: KanbanWriteDeps = {
      upsertBlockProperty: vi.fn(async (_u: string, key: string, id: number) => { if (!silent) stored[`:${key}`] = { id, ident: null }; return null; }),
      removeBlockProperty: vi.fn(async (_u: string, key: string) => { if (!silent) stored[`:${key}`] = removed; return null; }),
      readChoice: vi.fn(async (_u: string, ident: string) => stored[ident] ?? null),
    };
    return d;
  }
  // Observed live on 2026-10-03 (T11 live check, not in the T01 fixtures): removeBlockProperty on built-in Status leaves
  // the attribute pointing at the entity with ident :logseq.property/empty-placeholder. Hand-built from that observed
  // shape (the one allowed exception to fixture-only data); the id is arbitrary on purpose: only the ident identifies it.
  const PLACEHOLDER = { id: 4242, ident: EMPTY_PLACEHOLDER };

  it("the key is the full ident in the form the probe's working call used (no leading colon)", () => {
    const working = writesFixture.steps.find((s) => s.label === "status by closed-value db id")!.call;
    const key = /upsertBlockProperty\("[^"]+", "([^"]+)", (\d+)\)/.exec(working)!;
    expect(writeKey(":logseq.property/status")).toBe(key[1]);
    expect(writeKey(choiceProp(p(), "Owner").ident)).toBe(writesFixture.ownerIdent.replace(/^:/, ""));
    expect(Number(key[2])).toBe(value(p(), "Status", "Doing").id); // the closed value's entity id, as in the fixture
  });

  it("set: upsertBlockProperty(uuid, full ident, closed value entity id), then a read-back", async () => {
    const d = deps({});
    await writeMove(d, [set("Status", "Done"), set("Owner", "Bob")]);
    expect(d.upsertBlockProperty).toHaveBeenNthCalledWith(1, SITE, "logseq.property/status", value(p(), "Status", "Done").id);
    expect(d.upsertBlockProperty).toHaveBeenNthCalledWith(2, SITE, writeKey(choiceProp(p(), "Owner").ident), value(p(), "Owner", "Bob").id);
    expect(d.readChoice).toHaveBeenNthCalledWith(1, SITE, ":logseq.property/status");
    expect(d.readChoice).toHaveBeenNthCalledWith(2, SITE, choiceProp(p(), "Owner").ident);
  });

  it("remove: removeBlockProperty(uuid, full ident), then a read-back of absence", async () => {
    const d = deps({ [choiceProp(p(), "Owner").ident]: { id: value(p(), "Owner", "Alice").id, ident: null } });
    await writeMove(d, [remove("Owner")]);
    expect(d.removeBlockProperty).toHaveBeenCalledWith(SITE, writeKey(choiceProp(p(), "Owner").ident));
    expect(d.readChoice).toHaveBeenCalledWith(SITE, choiceProp(p(), "Owner").ident);
  });

  it("throws a clear error when the read-back differs (the API resolves null on failure too)", async () => {
    await expect(writeMove(deps({}, true), [set("Status", "Done")])).rejects.toThrow('Status of "Website relaunch" was not saved as Done');
    const alice = { id: value(p(), "Owner", "Alice").id, ident: null };
    await expect(writeMove(deps({ [choiceProp(p(), "Owner").ident]: alice }, true), [remove("Owner")])).rejects.toThrow('Owner of "Website relaunch" was not removed');
  });

  it("stops at the first failed write", async () => {
    const d = deps({}, true);
    await expect(writeMove(d, [set("Status", "Done"), set("Owner", "Bob")])).rejects.toThrow();
    expect(d.upsertBlockProperty).toHaveBeenCalledTimes(1);
  });

  describe("partial move: the second write fails its read-back (T14)", () => {
    const status = () => choiceProp(p(), "Status").ident;
    const owner = () => choiceProp(p(), "Owner").ident;
    const ref = (prop: string, title: string) => ({ id: value(p(), prop, title).id, ident: null });
    /** Owner writes do nothing (fail their read-back); Status writes work unless `statusSilentAfter` writes happened. */
    function partial(statusSilentAfter = Infinity) {
      const stored: Record<string, { id: number; ident: string | null } | null> = { [status()]: ref("Status", "Doing"), [owner()]: ref("Owner", "Alice") };
      let statusWrites = 0;
      const d: KanbanWriteDeps = {
        upsertBlockProperty: vi.fn(async (_u: string, key: string, id: number) => {
          if (`:${key}` === status() && statusWrites++ < statusSilentAfter) stored[status()] = { id, ident: null };
          return null;
        }),
        removeBlockProperty: vi.fn(async (_u: string, key: string) => {
          if (`:${key}` === status() && statusWrites++ < statusSilentAfter) stored[status()] = null;
          return null;
        }),
        readChoice: vi.fn(async (_u: string, ident: string) => stored[ident] ?? null),
      };
      return { d, stored };
    }

    it("the first write is put back to its previous value and read back; the error says so", async () => {
      const { d, stored } = partial();
      await expect(writeMove(d, [set("Status", "Done", "Doing"), set("Owner", "Bob", "Alice")])).rejects.toThrow(
        'Owner of "Website relaunch" was not saved as Bob (read back differs). Status was put back to Doing, so the card has not moved.');
      expect(stored[status()]!.id).toBe(value(p(), "Status", "Doing").id);
      expect(d.upsertBlockProperty).toHaveBeenLastCalledWith(SITE, "logseq.property/status", value(p(), "Status", "Doing").id);
      expect(d.readChoice).toHaveBeenLastCalledWith(SITE, status());
    });

    it("a first write that set a value where there was none is removed again", async () => {
      const { d } = partial();
      await expect(writeMove(d, [set("Status", "Done"), set("Owner", "Bob", "Alice")])).rejects.toThrow(/Status was put back to no value/);
      expect(d.removeBlockProperty).toHaveBeenCalledWith(SITE, "logseq.property/status");
    });

    it("when putting the first write back fails too, the error says so", async () => {
      const { d, stored } = partial(1); // the Status rollback is dropped
      await expect(writeMove(d, [set("Status", "Done", "Doing"), set("Owner", "Bob", "Alice")])).rejects.toThrow(
        'Owner of "Website relaunch" was not saved as Bob (read back differs). Putting Status back to Doing failed too: Status of "Website relaunch" was not saved as Doing (read back differs). The board shows what the graph holds.');
      expect(stored[status()]!.id).toBe(value(p(), "Status", "Done").id);
    });
  });

  it("removal: an absent attribute and the empty placeholder both count as removed (built-in Status, seen live)", async () => {
    const status = choiceProp(p(), "Status").ident;
    const doing = { id: value(p(), "Status", "Doing").id, ident: value(p(), "Status", "Doing").ident };
    await expect(writeMove(deps({ [status]: doing }), [remove("Status")])).resolves.toBeUndefined();
    await expect(writeMove(deps({ [status]: doing }, false, PLACEHOLDER), [remove("Status")])).resolves.toBeUndefined();
    await expect(writeMove(deps({ [status]: doing }, true), [remove("Status")])).rejects.toThrow('Status of "Website relaunch" was not removed');
  });

  it("set: a read-back of the empty placeholder is a failure (a uuid or ident string as value blanks it, T01)", async () => {
    const d = deps({});
    d.readChoice = vi.fn(async () => PLACEHOLDER);
    await expect(writeMove(d, [set("Status", "Done")])).rejects.toThrow('Status of "Website relaunch" was not saved as Done');
  });

  it("a node whose value is the empty placeholder sits in No <prop> (normalised to no value)", async () => {
    const t = tag("Project");
    const status = choiceProp(t, "Status").ident;
    const pulled = (await dq(nodesQuery(tags), t.id, CLASS_EXTENDS_RULES)) as [Record<string, unknown>][];
    const rows = pulled.map(([n]) => [n.uuid === ARCHIVE ? { ...n, [status]: PLACEHOLDER } : n]);
    const nodes = await loadNodes(async (q, ...i) => (q === nodesQuery(tags) ? rows : dq(q, ...i)), tags, t, { childTags: true, zone: west5 });
    expect(nodes.find((n) => n.uuid === ARCHIVE)!.choices[status]).toBeUndefined();
    const l = await project({ items: viewItems(nodes, [], null, null, statusValues) });
    expect(cardsIn(l, NO_VALUE)).toEqual(["Archive cleanup"]);
    expect(l.columns[l.columns.length - 1].count).toBe(1);
  });
});
