import { describe, expect, it } from "vitest";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos } from "./schema";
import { loadNodes, loadNodesAndTasks } from "./queries";
import { fixtureDq } from "../ui/test-fakes";
import { filterNodes, isCanceled, isDone, resolveSpan, rollup, tasksOf } from "./nodes";
import type { ClosedValue, LocalDate, PlannerNode, PlannerTask, TagInfo } from "../types";

const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
const tag = (title: string): TagInfo => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
const west5 = () => -300;
const dq = fixtureDq();
const prop = (t: TagInfo, title: string) => {
  const p = [...t.dateProps, ...t.choiceProps].find((x) => x.title === title);
  if (!p) throw new Error(`no prop ${title}`);
  return p.ident;
};
const choiceProp = (t: TagInfo, title: string) => {
  const p = t.choiceProps.find((x) => x.title === title);
  if (!p) throw new Error(`no choice prop ${title}`);
  return p;
};
const byTitle = (ns: PlannerNode[], title: string) => {
  const n = ns.find((x) => x.title === title);
  if (!n) throw new Error(`no node ${title}`);
  return n;
};
const d = (day: string, time: string | null = null): LocalDate => ({ day, time });

const project = tag("Project");
const startId = prop(project, "Start");
const endId = prop(project, "End");
const node = (dates: Record<string, LocalDate>, id = 1): PlannerNode => ({ id, uuid: `u${id}`, title: `n${id}`, tagIds: [], dates, choices: {} });
const task = (over: Partial<PlannerTask> & { nodeIds: number[] }): PlannerTask => ({
  id: 100, uuid: "t", title: "t", status: null, deadline: null, scheduled: null, ...over,
});

describe("resolveSpan", () => {
  it("uses the mapped Start and End as a span", async () => {
    const nodes = await loadNodes(dq, tags, project, { childTags: true, zone: west5 });
    const site = byTitle(nodes, "Website relaunch");
    expect(resolveSpan(site, [], startId, endId)).toEqual({ kind: "mapped", start: d("2026-09-23"), end: d("2026-10-23") });
  });

  it("takes a span from linked tasks' Scheduled and Deadline when the node has no mapped dates", () => {
    const n = node({});
    const tasks = [
      task({ nodeIds: [1], deadline: d("2026-10-05", "12:00") }),
      task({ nodeIds: [1], scheduled: d("2026-10-01", "09:00"), deadline: d("2026-10-09", "17:00") }),
      task({ nodeIds: [2], deadline: d("2027-01-01") }), // another node's task
    ];
    expect(resolveSpan(n, tasks, startId, endId)).toEqual({ kind: "derived", start: d("2026-10-01", "09:00"), end: d("2026-10-09", "17:00") });
  });

  it("derives from the fixture's linked task for Acme-like nodes without mapped dates", async () => {
    const { nodes, tasks } = await loadNodesAndTasks(dq, tags, project, { childTags: true, zone: west5 });
    const bare = { ...byTitle(nodes, "Acme rollout"), dates: {} };
    expect(resolveSpan(bare, tasks, startId, endId)).toEqual({ kind: "derived", start: d("2026-10-02", "12:00"), end: d("2026-10-02", "12:00") });
  });

  it("treats one mapped date as a point, whichever one it is", async () => {
    const nodes = await loadNodes(dq, tags, project, { childTags: true, zone: west5 });
    const mobile = byTitle(nodes, "Mobile app"); // Start only
    expect(resolveSpan(mobile, [], startId, endId)).toEqual({ kind: "point", start: mobile.dates[startId], end: mobile.dates[startId] });
    expect(resolveSpan(node({ [endId]: d("2026-11-01") }), [], startId, endId)).toMatchObject({ kind: "point", start: d("2026-11-01") });
  });

  it("a view that maps End but no Start shows End as a point", () => {
    expect(resolveSpan(node({ [endId]: d("2026-11-01") }), [], null, endId)).toEqual({ kind: "point", start: d("2026-11-01"), end: d("2026-11-01") });
  });

  it("mapped dates win over task dates", () => {
    const tasks = [task({ nodeIds: [1], deadline: d("2030-01-01") })];
    expect(resolveSpan(node({ [startId]: d("2026-10-01") }), tasks, startId, endId).kind).toBe("point");
  });

  it("is undated with no mapped dates and no dated tasks", async () => {
    const nodes = await loadNodes(dq, tags, project, { childTags: true, zone: west5 });
    const archive = byTitle(nodes, "Archive cleanup");
    expect(resolveSpan(archive, [], startId, endId)).toEqual({ kind: "undated", start: null, end: null });
    expect(resolveSpan(node({}), [task({ nodeIds: [1] })], startId, endId).kind).toBe("undated");
  });

  it("works when the view maps no End property", () => {
    expect(resolveSpan(node({ [startId]: d("2026-10-01") }), [], startId, null).kind).toBe("point");
  });
});

describe("rollup", () => {
  const status = tag("Task").choiceProps.find((p) => p.title === "Status")!.values;
  const t = (title: string) => {
    const v = status.find((x) => x.title === title)!;
    return task({ nodeIds: [1], status: { ident: v.ident!, title: v.title } });
  };

  it("counts done over all tasks minus canceled", async () => {
    const { nodes, tasks: all } = await loadNodesAndTasks(dq, tags, project, { childTags: true, zone: west5 });
    const tasks = tasksOf(byTitle(nodes, "Website relaunch"), all);
    expect(tasks).toHaveLength(3); // Todo, Done, Canceled
    expect(rollup(tasks, status)).toEqual({ done: 1, total: 2 });
  });

  it("excludes canceled from the total and never counts it as done", () => {
    expect(rollup([t("Done"), t("Canceled"), t("Canceled")], status)).toEqual({ done: 1, total: 1 });
    expect(rollup([t("Canceled")], status)).toEqual({ done: 0, total: 0 });
  });

  it("counts a task without a status as open", () => {
    expect(rollup([task({ nodeIds: [1] }), t("Done")], status)).toEqual({ done: 1, total: 2 });
  });

  it("is 0 of 0 for no tasks", () => {
    expect(rollup([], status)).toEqual({ done: 0, total: 0 });
  });
});

describe("done values", () => {
  const user = (title: string): ClosedValue => ({ id: 1, uuid: "u", title, ident: null, order: "a", checkbox: null, canceled: false });
  const builtin = (title: string, checkbox: boolean | null, canceled = false): ClosedValue => ({
    id: 2, uuid: "b", title, ident: `:logseq.property/status.${title.toLowerCase()}`, order: "a", checkbox, canceled,
  });
  const status = tag("Task").choiceProps.find((p) => p.title === "Status")!.values;

  it("uses the built-in flags for Status", () => {
    const get = (title: string) => status.find((v) => v.title === title)!;
    expect(isDone(get("Done"))).toBe(true);
    expect(isDone(get("Todo"))).toBe(false);
    expect(isDone(get("Doing"))).toBe(false);
    expect(isCanceled(get("Canceled"))).toBe(true);
    expect(isCanceled(get("Done"))).toBe(false);
  });

  it("does not guess by name for a built-in value", () => {
    expect(isDone(builtin("Closed", null))).toBe(false);
    expect(isCanceled(builtin("Cancelled", null))).toBe(false);
  });

  it("guesses user values by name, case-insensitively", () => {
    for (const n of ["Done", "completed", "CANCELED", "Cancelled", "closed"]) expect(isDone(user(n))).toBe(true);
    for (const n of ["Open", "In progress", "Donee"]) expect(isDone(user(n))).toBe(false);
    expect(isCanceled(user("Canceled"))).toBe(true);
    expect(isCanceled(user("cancelled"))).toBe(true);
    expect(isCanceled(user("Closed"))).toBe(false);
  });

  it("lets an explicit list of closed-value uuids win over the guess", () => {
    const shipped = { ...user("Shipped"), uuid: "uuid-shipped" };
    const done = { ...user("Done"), uuid: "uuid-done" };
    expect(isDone(shipped, ["uuid-shipped"])).toBe(true);
    expect(isDone(done, ["uuid-shipped"])).toBe(false);
    expect(isDone(done, [])).toBe(false);
  });

  it("keeps matching after a rename because the override is by uuid, not title", () => {
    const renamed = { ...user("Released"), uuid: "uuid-shipped" };
    expect(isDone(renamed, ["uuid-shipped"])).toBe(true);
    expect(isDone({ ...user("Shipped"), uuid: "other" }, ["uuid-shipped"])).toBe(false);
  });
});

describe("filterNodes", () => {
  it("keeps nodes whose choice value is one of the selected, ANDed across properties", async () => {
    const nodes = await loadNodes(dq, tags, project, { childTags: true, zone: west5 });
    const owner = choiceProp(project, "Owner");
    const status = choiceProp(project, "Status");
    const alice = owner.values.find((v) => v.title === "Alice")!;
    const bob = owner.values.find((v) => v.title === "Bob")!;
    const ownerOf = (n: PlannerNode) => n.choices[owner.ident]?.title;
    const byAlice = filterNodes(nodes, { [owner.ident]: [alice.id] });
    expect(byAlice.length).toBeGreaterThan(0);
    expect(byAlice.every((n) => ownerOf(n) === "Alice")).toBe(true);
    const either = filterNodes(nodes, { [owner.ident]: [alice.id, bob.id] });
    expect(either.every((n) => ownerOf(n) !== undefined)).toBe(true);
    const site = byTitle(nodes, "Website relaunch");
    const both = filterNodes(nodes, { [owner.ident]: [alice.id, bob.id], [status.ident]: [site.choices[status.ident].id] });
    expect(both.map((n) => n.id)).toContain(site.id);
    expect(both.every((n) => n.choices[status.ident]?.id === site.choices[status.ident].id)).toBe(true);
  });

  it("matches nodes with no value through null", async () => {
    const nodes = await loadNodes(dq, tags, project, { childTags: true, zone: west5 });
    const owner = choiceProp(project, "Owner");
    const none = filterNodes(nodes, { [owner.ident]: [null] });
    expect(none.map((n) => n.title)).toContain("Archive cleanup");
    expect(none.every((n) => n.choices[owner.ident] === undefined)).toBe(true);
  });

  it("does not filter on an empty selection or no filters", async () => {
    const nodes = await loadNodes(dq, tags, project, { childTags: true, zone: west5 });
    const owner = choiceProp(project, "Owner");
    expect(filterNodes(nodes, {})).toEqual(nodes);
    expect(filterNodes(nodes, { [owner.ident]: [] })).toEqual(nodes);
  });
});
