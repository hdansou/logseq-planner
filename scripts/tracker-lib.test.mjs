import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addWorkingHours, buildDesired, genEdn, orderTasks, parseGitLog, parseLocal, parseTasks, plan, refsRepair,
  schedule, stableUuid, toWorkingTime,
} from "./tracker-lib.mjs";

const MD = `# x
- [x] **T00 Scaffold** — standard
      continued **bold**
- [ ] **N03 Owner decisions** —
- [x] **T13a Performance** — y
- [ ] **N09 Project tracker graph** — z
- [ ] not a task **T99 Nope** —
  - [ ] **T98 Indented** — no
`;

describe("parseTasks", () => {
  it("reads id, title and done from the checkbox lines", () => {
    expect(parseTasks(MD)).toEqual([
      { id: "T00", title: "Scaffold", done: true },
      { id: "N03", title: "Owner decisions", done: false },
      { id: "T13a", title: "Performance", done: true },
      { id: "N09", title: "Project tracker graph", done: false },
    ]);
  });
});

describe("parseGitLog", () => {
  const known = ["N03", "T13", "T13a"];
  const lines = [
    "2026-10-03T09:00:00+02:00|docs: x (N03b)",
    "2026-10-01T09:00:00+02:00|feat: y (N03a)",
    "2026-10-02T09:00:00+02:00|feat: perf (T13a)",
    "2026-09-30T09:00:00+02:00|feat: live (T13)",
    "2026-09-29T09:00:00+02:00|chore: no id",
    "2026-09-28T09:00:00+02:00|feat: other (Z01)",
  ];
  it("maps a lettered sub-item to its task and keeps a real lettered task apart", () => {
    const m = parseGitLog(lines, known);
    expect(m.N03).toEqual({ first: "2026-10-01T09:00:00+02:00", last: "2026-10-03T09:00:00+02:00" });
    expect(m.T13a.first).toBe("2026-10-02T09:00:00+02:00");
    expect(m.T13.last).toBe("2026-09-30T09:00:00+02:00");
    expect(Object.keys(m).sort()).toEqual(["N03", "T13", "T13a"]);
  });
});

const META = {
  project: "Planner", page: "Planner tracker", defaultTeam: "Dev", defaultOwner: "Claude",
  scheduleStart: "2026-09-25T15:00", taskHours: 2,
  milestones: [
    { key: "a", title: "Alpha", tasks: ["T00", "T01"] },
    { key: "b", title: "Beta", tasks: ["N06", "N03"] },
  ],
  tasks: { N06: { status: "Backlog" }, N03: { team: "Product", owner: "Danzu" } },
};
const TASKS = [
  { id: "T00", title: "Scaffold", done: true },
  { id: "T01", title: "Probe", done: false },
  { id: "N03", title: "Decide", done: false },
  { id: "N06", title: "Later", done: false },
];
const COMMITS = {
  T00: { first: "2026-10-01T09:00:00+02:00", last: "2026-10-02T10:00:00+02:00" },
  T01: { first: "2026-10-02T11:00:00+02:00", last: "2026-10-04T10:00:00+02:00" },
};
// Local wall-clock time -> epoch ms; the schedule is local time, so tests state it that way in any zone.
const L = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe("working time", () => {
  const D = (...a) => new Date(...a);
  it("keeps a start inside 09:00-17:00 on a weekday", () => {
    expect(toWorkingTime(D(2026, 8, 30, 10, 30)).getTime()).toBe(L(2026, 9, 30, 10, 30));
  });
  it("moves a start before 09:00 to 09:00 the same day", () => {
    expect(toWorkingTime(D(2026, 8, 30, 7, 0)).getTime()).toBe(L(2026, 9, 30, 9));
  });
  it("moves a start at or after 17:00 to the next working day 09:00", () => {
    expect(toWorkingTime(D(2026, 8, 30, 17, 0)).getTime()).toBe(L(2026, 10, 1, 9));
    expect(toWorkingTime(D(2026, 8, 30, 20, 0)).getTime()).toBe(L(2026, 10, 1, 9));
  });
  it("never works Saturday or Sunday", () => {
    expect(toWorkingTime(D(2026, 8, 26, 12, 0)).getTime()).toBe(L(2026, 9, 28, 9)); // Saturday 26 Sep
    expect(toWorkingTime(D(2026, 8, 27, 12, 0)).getTime()).toBe(L(2026, 9, 28, 9)); // Sunday
    expect(toWorkingTime(D(2026, 8, 25, 17, 0)).getTime()).toBe(L(2026, 9, 28, 9)); // Friday 17:00
  });
  it("Friday 16:00 + 2h ends Monday 10:00; ending exactly at 17:00 stays that day", () => {
    expect(addWorkingHours(D(2026, 8, 25, 16, 0), 2).getTime()).toBe(L(2026, 9, 28, 10));
    expect(addWorkingHours(D(2026, 8, 25, 15, 0), 2).getTime()).toBe(L(2026, 9, 25, 17));
  });
  it("carries long tasks over several working days", () => {
    expect(addWorkingHours(D(2026, 8, 25, 9, 0), 12).getTime()).toBe(L(2026, 9, 28, 13));
  });
  it("parses the local anchor and rejects other shapes", () => {
    expect(parseLocal("2026-09-25T15:00").getTime()).toBe(L(2026, 9, 25, 15));
    expect(() => parseLocal("2026-09-25T15:00Z")).toThrow(/scheduleStart/);
    expect(() => parseLocal(undefined)).toThrow(/scheduleStart/);
  });
});

describe("orderTasks", () => {
  it("puts tasks with commits first by first commit (ties by id), then the rest T before N, numeric", () => {
    const c = {
      N02: { first: "2026-10-01T09:00:00Z" }, T10: { first: "2026-10-01T09:00:00Z" },
      T02: { first: "2026-10-01T08:00:00Z" },
    };
    expect(orderTasks(["N20", "N03", "T10", "T02", "N02", "T09", "T13a", "T13"], c))
      .toEqual(["T02", "T10", "N02", "T09", "T13", "T13a", "N03", "N20"]);
  });
});

describe("schedule", () => {
  const order = ["A", "B", "C", "D"].map((x, i) => `T0${i}`);
  const m = (extra = {}) => ({ scheduleStart: "2026-09-25T15:00", taskHours: 2, ...extra });
  it("chains tasks: each starts at the previous End, 2 hours each, anchor normalised", () => {
    const s = schedule(order, m());
    expect(s.T00).toEqual({ start: L(2026, 9, 25, 15), end: L(2026, 9, 25, 17), after: [] });
    expect(s.T01).toEqual({ start: L(2026, 9, 28, 9), end: L(2026, 9, 28, 11), after: ["T00"] });
    expect(s.T03.end).toBe(L(2026, 9, 28, 15));
    expect(schedule(order, m({ scheduleStart: "2026-09-26T10:00" })).T00.start).toBe(L(2026, 9, 28, 9));
  });
  it("starts at the latest End of explicit dependencies", () => {
    const s = schedule(order, m({ after: { T03: ["T01", "T00"] }, hours: { T02: 4 } }));
    expect(s.T02).toMatchObject({ start: L(2026, 9, 28, 11), end: L(2026, 9, 28, 15) });
    expect(s.T03).toMatchObject({ start: L(2026, 9, 28, 11), end: L(2026, 9, 28, 13), after: ["T01", "T00"] });
  });
  it("honours per-task hours across the end of the day", () => {
    const s = schedule(order, m({ hours: { T01: 8 } }));
    expect(s.T01).toMatchObject({ start: L(2026, 9, 28, 9), end: L(2026, 9, 28, 17) });
    expect(s.T02).toMatchObject({ start: L(2026, 9, 29, 9), end: L(2026, 9, 29, 11) });
  });
  it("an explicit empty list means no dependency: the task starts at the anchor and overlaps", () => {
    const s = schedule(order, m({ after: { T02: [] } }));
    expect(s.T02).toMatchObject({ start: L(2026, 9, 25, 15), end: L(2026, 9, 25, 17), after: [] });
    expect(s.T03.after).toEqual(["T02"]); // the default still follows the order
  });
  it("accepts a dependency on a task later in the order when the graph is acyclic", () => {
    const s = schedule(order, m({ after: { T01: ["T03"], T03: [] } }));
    expect(s.T03.end).toBe(L(2026, 9, 25, 17));
    expect(s.T01.start).toBe(L(2026, 9, 28, 9)); // Friday 17:00 moves to Monday 09:00
  });
  it("fails fast on an unknown dependency, a cycle or a self dependency, and on unknown ids in hours", () => {
    expect(() => schedule(order, m({ after: { T01: ["X9"] } }))).toThrow(/T01.*X9/);
    expect(() => schedule(order, m({ after: { T01: ["T03"] } }))).toThrow(/cycle.*T01.*T03/);
    expect(() => schedule(order, m({ after: { T01: ["T01"] } }))).toThrow(/T01.*T01/);
    expect(() => schedule(order, m({ after: { X9: ["T00"] } }))).toThrow(/X9/);
    expect(() => schedule(order, m({ hours: { X9: 1 } }))).toThrow(/X9/);
    expect(() => schedule(order, m({ taskHours: 0 }))).toThrow(/positive/);
  });
});

// The real ids on 2026-10-03 and the dependency map of scripts/tracker-meta.json (N11 itself is open and
// has no `after` entry: it takes the default, the previous task in the order).
const REAL_COMMITTED = ["T00", "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T11", "T12", "T13", "T14", "N03", "N02", "N01", "N08", "N09", "N10"];
const REAL_OPEN = ["N04", "N05", "N06", "N07", "N11", "N12"];
const REAL_AFTER = {"T00": [], "T01": ["T00"], "T02": ["T00"], "T03": ["T01"], "T04": ["T03"], "T05": ["T04"], "T06": ["T05"], "T07": ["T02", "T06"], "T08": ["T07"], "T09": ["T07"], "T10": ["T07"], "T11": ["T07"], "T12": ["T08", "T09", "T10", "T11"], "T13": ["T12"], "T14": ["T13"], "N02": ["T14"], "N01": ["N02"], "N03": ["T14"], "N08": ["T11"], "N09": ["T14"], "N10": ["T08"], "N04": ["N01"], "N05": ["N01", "N03", "N04"], "N06": ["N05"], "N07": ["N06"], "N11": ["N09"], "N12": ["N10", "N11"]};
describe("the real schedule (anchor 2026-09-29T15:00)", () => {
  const ids = [...REAL_OPEN, ...[...REAL_COMMITTED].reverse()]; // scrambled input order
  const commits = Object.fromEntries(REAL_COMMITTED.map((id, i) => [id, { first: new Date(Date.UTC(2026, 9, 3, 12, i)).toISOString() }]));
  const meta = JSON.parse(readFileSync(new URL("./tracker-meta.json", import.meta.url), "utf8"));
  const s = schedule(orderTasks(ids, commits), { ...meta, after: REAL_AFTER });
  it("ships the same map in tracker-meta.json", () => {
    expect(meta.after).toEqual(REAL_AFTER);
    expect(meta.scheduleStart).toBe("2026-09-29T15:00");
  });
  it("ends the committed tasks by Fri 2 Oct 17:00", () => {
    expect(Math.max(...REAL_COMMITTED.map((id) => s[id].end))).toBe(L(2026, 10, 2, 17));
    expect(s.N01.end).toBe(L(2026, 10, 2, 17));
  });
  it("lets independent tasks overlap", () => {
    expect(s.T00.start).toBe(L(2026, 9, 29, 15));
    expect(s.T01.start).toBe(s.T02.start); // both after T00
    expect(s.T08.start).toBe(s.T09.start);
    expect(s.T12.start).toBe(Math.max(s.T08.end, s.T09.end, s.T10.end, s.T11.end));
  });
  it("starts N04 (after N01) Mon 5 Oct 09:00 and N05 after its latest dependency", () => {
    expect(s.N04.start).toBe(L(2026, 10, 5, 9));
    expect(s.N05.start).toBe(L(2026, 10, 5, 11));
  });
});

describe("buildDesired", () => {
  const d = buildDesired(TASKS, COMMITS, META);
  const task = (id) => d.tasks.find((t) => t.id === id);
  it("derives status: done, override, doing from commits, else todo", () => {
    expect(task("T00").status).toBe("Done");
    expect(task("T01").status).toBe("Doing");
    expect(task("N06").status).toBe("Backlog");
    expect(task("N03").status).toBe("Todo");
  });
  it("sets titles, planned Start / End / Scheduled, dependency, team, owner and milestone", () => {
    expect(task("T01")).toMatchObject({
      title: "T01 Probe", scheduled: L(2026, 9, 28, 9), start: L(2026, 9, 28, 9), end: L(2026, 9, 28, 11),
      dependsOn: ["T00 Scaffold"], team: "Dev", owner: "Claude", milestone: "Alpha",
    });
    expect(task("T00").dependsOn).toEqual([]);
    expect(task("N03")).toMatchObject({ team: "Product", owner: "Danzu", milestone: "Beta", start: L(2026, 9, 28, 11), dependsOn: ["T01 Probe"] });
    expect(task("N06")).toMatchObject({ start: L(2026, 9, 28, 13), end: L(2026, 9, 28, 15), scheduled: L(2026, 9, 28, 13) });
  });
  it("ignores commit times for the dates, only for the order", () => {
    const swapped = { T00: COMMITS.T01, T01: COMMITS.T00 };
    const e = buildDesired(TASKS, swapped, META);
    expect(e.tasks.find((t) => t.id === "T01").start).toBe(L(2026, 9, 25, 15));
    expect(e.tasks.find((t) => t.id === "T00").dependsOn).toEqual(["T01 Probe"]);
  });
  it("lists explicit dependencies by title, sorted", () => {
    const e = buildDesired(TASKS, COMMITS, { ...META, after: { N06: ["N03", "T00"] } });
    expect(e.tasks.find((t) => t.id === "N06").dependsOn).toEqual(["N03 Decide", "T00 Scaffold"]);
  });
  it("derives milestone status and ranges, project start", () => {
    const [a, b] = d.milestones;
    expect(a).toMatchObject({ title: "Alpha", status: "Doing", start: L(2026, 9, 25, 15), end: L(2026, 9, 28, 11) });
    expect(b).toMatchObject({ status: "Todo", start: L(2026, 9, 28, 11), end: L(2026, 9, 28, 15) });
    expect(d.project).toMatchObject({ title: "Planner", status: "Doing", start: L(2026, 9, 25, 15) });
    expect(d.project.end).toBeUndefined();
  });
  it("is Done when every task is done", () => {
    const m = { ...META, milestones: [{ key: "a", title: "A", tasks: ["T00"] }, { key: "b", title: "B", tasks: ["T01", "N03", "N06"] }] };
    expect(buildDesired(TASKS, COMMITS, m).milestones[0].status).toBe("Done");
  });
  it("fails fast on a task in no milestone", () => {
    expect(() => buildDesired([...TASKS, { id: "N77", title: "x", done: false }], COMMITS, META)).toThrow(/N77/);
  });
  it("fails on a milestone naming an unknown task", () => {
    const m = { ...META, milestones: [{ key: "a", title: "A", tasks: ["T00", "T01", "N03", "N06", "Q1"] }] };
    expect(() => buildDesired(TASKS, COMMITS, m)).toThrow(/Q1/);
  });
  it("fails on a bad dependency", () => {
    expect(() => buildDesired(TASKS, COMMITS, { ...META, after: { T00: ["N06"] } })).toThrow(/T00.*N06/);
  });
});

describe("stableUuid", () => {
  it("is deterministic and v4-shaped", () => {
    expect(stableUuid("m:a")).toBe(stableUuid("m:a"));
    expect(stableUuid("m:a")).not.toBe(stableUuid("m:b"));
    expect(stableUuid("m:a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("genEdn", () => {
  const edn = genEdn(buildDesired(TASKS, COMMITS, META));
  it("has datetime Start/End, the schema, project and milestones with fixed uuids, no tasks", () => {
    for (const s of [':start {:block/title "Start" :logseq.property/type :datetime}', ':end {:block/title "End" :logseq.property/type :datetime}',
      ":owner", ":team", ":milestone", ":project", ":Project", ":Milestone", '"Planner tracker"',
      ":build/keep-uuid? true", '"Alpha"', '"Beta"', `#uuid "${stableUuid("milestone:a")}"`, `:start ${L(2026, 9, 25, 15)}`,
      ':depends-on {:block/title "depends_on" :logseq.property/type :node :db/cardinality :db.cardinality/many}']) {
      expect(edn).toContain(s);
    }
    expect(edn).not.toContain("T01 Probe");
  });
  it("is balanced", () => {
    let depth = 0, inStr = false;
    for (let i = 0; i < edn.length; i++) {
      const c = edn[i];
      if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});

describe("plan", () => {
  const desired = buildDesired(TASKS, COMMITS, META);
  const item = (o) => ({ id: 1, title: "", tag: "Task", status: "Todo", ...o });
  const full = {
    taskClassProps: ["Team", "Owner", "Milestone", "Start", "End", "depends_on"],
    items: [
      item({ id: 100, tag: "Project", title: "Planner", status: "Doing", start: L(2026, 9, 25, 15), owner: "Claude" }),
      item({ id: 101, tag: "Milestone", title: "Alpha", status: "Doing", start: L(2026, 9, 25, 15), end: L(2026, 9, 28, 11), owner: "Claude", project: "Planner" }),
      item({ id: 102, tag: "Milestone", title: "Beta", status: "Todo", start: L(2026, 9, 28, 11), end: L(2026, 9, 28, 15), owner: "Claude", project: "Planner" }),
      item({ id: 1, title: "T00 Scaffold", status: "Done", scheduled: L(2026, 9, 25, 15), start: L(2026, 9, 25, 15), end: L(2026, 9, 25, 17), team: "Dev", owner: "Claude", milestone: "Alpha", dependsOn: [] }),
      item({ id: 2, title: "T01 Probe", status: "Doing", scheduled: L(2026, 9, 28, 9), start: L(2026, 9, 28, 9), end: L(2026, 9, 28, 11), team: "Dev", owner: "Claude", milestone: "Alpha", dependsOn: ["T00 Scaffold"] }),
      item({ id: 3, title: "N03 Decide", status: "Todo", scheduled: L(2026, 9, 28, 11), start: L(2026, 9, 28, 11), end: L(2026, 9, 28, 13), team: "Product", owner: "Danzu", milestone: "Beta", dependsOn: ["T01 Probe"] }),
      item({ id: 4, title: "N06 Later", status: "Backlog", scheduled: L(2026, 9, 28, 13), start: L(2026, 9, 28, 13), end: L(2026, 9, 28, 15), team: "Dev", owner: "Claude", milestone: "Beta", dependsOn: ["N03 Decide"] }),
    ],
  };
  const p = (cur) => plan(desired, cur, "g");
  const without = (id) => ({ ...full, items: full.items.filter((i) => i.id !== id) });
  const change = (id, patch) => ({ ...full, items: full.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const base = (...r) => [r[0], r[1], "-g", "g", "-o", "json", ...r.slice(2)];

  it("plans nothing when the graph matches", () => {
    expect(p(full)).toEqual([]);
  });
  it("treats a task without a depends_on read-back as an empty list", () => {
    expect(p(change(1, { dependsOn: undefined }))).toEqual([]);
  });
  it("creates a missing task with status and its planned start as Scheduled", () => {
    const steps = p(without(2));
    expect(steps.map((s) => s.argv)).toEqual([base("upsert", "task", "--target-page", "Planner tracker",
      "--content", "T01 Probe", "--status", "doing", "--scheduled", new Date(L(2026, 9, 28, 9)).toISOString())]);
  });
  it("updates only a changed status", () => {
    expect(p(change(2, { status: "Todo" })).map((s) => s.argv)).toEqual([base("upsert", "task", "--id", "2", "--status", "doing")]);
  });
  it("updates scheduled", () => {
    expect(p(change(2, { scheduled: 5 }))[0].argv).toContain(new Date(L(2026, 9, 28, 9)).toISOString());
  });
  it("writes team, owner and milestone by db id in one properties call", () => {
    const steps = p(change(3, { team: undefined, owner: "Claude", milestone: "Alpha" }));
    expect(steps.map((s) => s.argv)).toEqual([base("upsert", "block", "--id", "3", "--update-properties", '{"Team" "Product" "Owner" "Danzu" "Milestone" 102}')]);
  });
  it("writes a task's Start and End as epoch ms", () => {
    const steps = p(change(2, { start: undefined, end: 7 }));
    expect(steps[0].argv).toEqual(base("upsert", "block", "--id", "2", "--update-properties", `{"Start" ${L(2026, 9, 28, 9)} "End" ${L(2026, 9, 28, 11)}}`));
  });
  it("writes depends_on as a vector of db ids", () => {
    expect(p(change(2, { dependsOn: [] }))[0].argv).toEqual(base("upsert", "block", "--id", "2", "--update-properties", '{"depends_on" [1]}'));
    expect(p(change(2, { dependsOn: ["N03 Decide"] }))[0].argv).toContain('{"depends_on" [1]}');
  });
  it("writes several dependencies in one value, and clears depends_on of a task without any", () => {
    const d2 = buildDesired(TASKS, COMMITS, { ...META, after: { N06: ["N03", "T00"] } });
    expect(plan(d2, change(4, { dependsOn: ["N03 Decide"] }), "g")[0].argv).toEqual(base("upsert", "block", "--id", "4", "--update-properties", '{"depends_on" [3 1]}'));
    expect(p(change(1, { dependsOn: ["T01 Probe"] }))[0].argv).toEqual(base("upsert", "block", "--id", "1", "--remove-properties", '["depends_on"]'));
  });
  it("waits a round when a dependency block does not exist yet", () => {
    const cur = { ...without(1), items: without(1).items.map((i) => (i.id === 2 ? { ...i, dependsOn: [] } : i)) };
    expect(p(cur).map((s) => s.argv)).toEqual([base("upsert", "task", "--target-page", "Planner tracker",
      "--content", "T00 Scaffold", "--status", "done", "--scheduled", new Date(L(2026, 9, 25, 15)).toISOString())]);
  });
  it("waits a round when the milestone block does not exist yet", () => {
    const steps = p({ ...without(102), items: without(102).items.map((i) => (i.id === 3 ? { ...i, milestone: undefined } : i)) });
    expect(steps.map((s) => s.argv)).toEqual([base("upsert", "block", "--target-page", "Planner tracker", "--content", "Beta", "--update-tags", '["Milestone"]')]);
  });
  it("writes a milestone's status and End by epoch ms", () => {
    const steps = p(change(101, { end: 1, status: "Todo" }));
    expect(steps[0].argv).toEqual(base("upsert", "block", "--id", "101", "--update-properties", `{"Status" "Doing" "End" ${L(2026, 9, 28, 11)}}`));
  });
  it("sets a milestone's Project by the project's db id", () => {
    expect(p(change(102, { project: undefined }))[0].argv).toContain('{"Project" 100}');
  });
  it("adds missing Task tag properties", () => {
    expect(p({ ...full, taskClassProps: ["Team"] })[0].argv).toEqual(base("upsert", "tag", "--name", "Task", "--add-properties", '["Owner" "Milestone" "Start" "End" "depends_on"]'));
  });
});

describe("refsRepair", () => {
  const missing = [
    { id: 7, tag: "Task", title: "T01 A", team: "Dev" },
    { id: 8, tag: "Milestone", title: "Alpha", owner: "Claude" },
  ];
  it("says nothing when no block lacks references", () => {
    expect(refsRepair([], "electron", "g")).toEqual({ steps: [], notice: undefined });
    expect(refsRepair([], "cli", "g")).toEqual({ steps: [], notice: undefined });
  });
  it("re-writes a task's Team and a milestone's Owner (same value) when an app owns the graph", () => {
    const { steps, notice } = refsRepair(missing, "electron", "g");
    expect(notice).toBeUndefined();
    expect(steps.map((s) => s.argv)).toEqual([
      ["upsert", "block", "-g", "g", "-o", "json", "--id", "7", "--update-properties", '{"Team" "Dev"}'],
      ["upsert", "block", "-g", "g", "-o", "json", "--id", "8", "--update-properties", '{"Owner" "Claude"}'],
    ]);
  });
  it("does not repair with a CLI-owned or absent server: one notice with the count", () => {
    for (const owner of ["cli", undefined]) {
      const r = refsRepair(missing, owner, "g");
      expect(r.steps).toEqual([]);
      expect(r.notice).toBe('2 block(s) have no references yet (the CLI\'s own worker does not write them): open g in Logseq-DB and run "npm run tracker" again');
    }
  });
});
