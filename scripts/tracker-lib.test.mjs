import { describe, expect, it } from "vitest";
import {
  buildDesired, genEdn, parseGitLog, parseTasks, plan, stableUuid,
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
const T = (iso) => Date.parse(iso);

describe("buildDesired", () => {
  const d = buildDesired(TASKS, COMMITS, META);
  const task = (id) => d.tasks.find((t) => t.id === id);
  it("derives status: done, override, doing from commits, else todo", () => {
    expect(task("T00").status).toBe("Done");
    expect(task("T01").status).toBe("Doing");
    expect(task("N06").status).toBe("Backlog");
    expect(task("N03").status).toBe("Todo");
  });
  it("sets titles, exact commit times, team, owner and milestone", () => {
    expect(task("T01")).toMatchObject({
      title: "T01 Probe", scheduled: T("2026-10-02T11:00:00+02:00"), start: T("2026-10-02T11:00:00+02:00"),
      end: T("2026-10-04T10:00:00+02:00"), team: "Dev", owner: "Claude", milestone: "Alpha",
    });
    expect(task("N03")).toMatchObject({ team: "Product", owner: "Danzu", milestone: "Beta" });
    for (const k of ["scheduled", "start", "end"]) expect(task("N03")[k]).toBeUndefined();
  });
  it("derives milestone status and times, project start", () => {
    const [a, b] = d.milestones;
    expect(a).toMatchObject({ title: "Alpha", status: "Doing", start: T("2026-10-01T09:00:00+02:00"), end: T("2026-10-04T10:00:00+02:00") });
    expect(b).toMatchObject({ status: "Todo" });
    expect(b.start).toBeUndefined();
    expect(b.end).toBeUndefined();
    expect(d.project).toMatchObject({ title: "Planner", status: "Doing", start: T("2026-10-01T09:00:00+02:00") });
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
      ":build/keep-uuid? true", '"Alpha"', '"Beta"', `#uuid "${stableUuid("milestone:a")}"`, `:start ${T("2026-10-01T09:00:00+02:00")}`]) {
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
  const t = (s) => T(s);
  const full = {
    taskClassProps: ["Team", "Owner", "Milestone", "Start", "End"],
    items: [
      item({ id: 100, tag: "Project", title: "Planner", status: "Doing", start: t("2026-10-01T09:00:00+02:00"), owner: "Claude" }),
      item({ id: 101, tag: "Milestone", title: "Alpha", status: "Doing", start: t("2026-10-01T09:00:00+02:00"), end: t("2026-10-04T10:00:00+02:00"), owner: "Claude", project: "Planner" }),
      item({ id: 102, tag: "Milestone", title: "Beta", status: "Todo", owner: "Claude", project: "Planner" }),
      item({ id: 1, title: "T00 Scaffold", status: "Done", scheduled: t("2026-10-01T09:00:00+02:00"), start: t("2026-10-01T09:00:00+02:00"), end: t("2026-10-02T10:00:00+02:00"), team: "Dev", owner: "Claude", milestone: "Alpha" }),
      item({ id: 2, title: "T01 Probe", status: "Doing", scheduled: t("2026-10-02T11:00:00+02:00"), start: t("2026-10-02T11:00:00+02:00"), end: t("2026-10-04T10:00:00+02:00"), team: "Dev", owner: "Claude", milestone: "Alpha" }),
      item({ id: 3, title: "N03 Decide", status: "Todo", team: "Product", owner: "Danzu", milestone: "Beta" }),
      item({ id: 4, title: "N06 Later", status: "Backlog", team: "Dev", owner: "Claude", milestone: "Beta" }),
    ],
  };
  const p = (cur) => plan(desired, cur, "g");
  const without = (id) => ({ ...full, items: full.items.filter((i) => i.id !== id) });
  const change = (id, patch) => ({ ...full, items: full.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const base = (...r) => [r[0], r[1], "-g", "g", "-o", "json", ...r.slice(2)];

  it("plans nothing when the graph matches", () => {
    expect(p(full)).toEqual([]);
  });
  it("creates a missing task with status and the first commit time as Scheduled", () => {
    const steps = p(without(2));
    expect(steps.map((s) => s.argv)).toEqual([base("upsert", "task", "--target-page", "Planner tracker",
      "--content", "T01 Probe", "--status", "doing", "--scheduled", "2026-10-02T09:00:00.000Z")]);
  });
  it("updates only a changed status", () => {
    expect(p(change(2, { status: "Todo" })).map((s) => s.argv)).toEqual([base("upsert", "task", "--id", "2", "--status", "doing")]);
  });
  it("updates scheduled, or removes it", () => {
    expect(p(change(2, { scheduled: 5 }))[0].argv).toContain("2026-10-02T09:00:00.000Z");
    expect(p(change(3, { scheduled: 5 }))[0].argv).toContain("--no-scheduled");
  });
  it("writes team, owner and milestone by db id in one properties call", () => {
    const steps = p(change(3, { team: undefined, owner: "Claude", milestone: "Alpha" }));
    expect(steps.map((s) => s.argv)).toEqual([base("upsert", "block", "--id", "3", "--update-properties", '{"Team" "Product" "Owner" "Danzu" "Milestone" 102}')]);
  });
  it("writes a task's Start and End as epoch ms; clears them when there are no commits", () => {
    const steps = p(change(2, { start: undefined, end: 7 }));
    expect(steps[0].argv).toEqual(base("upsert", "block", "--id", "2", "--update-properties", `{"Start" ${t("2026-10-02T11:00:00+02:00")} "End" ${t("2026-10-04T10:00:00+02:00")}}`));
    expect(p(change(3, { start: 5 }))[0].argv).toEqual(base("upsert", "block", "--id", "3", "--remove-properties", '["Start"]'));
  });
  it("waits a round when the milestone block does not exist yet", () => {
    const steps = p({ ...without(102), items: without(102).items.map((i) => (i.id === 3 ? { ...i, milestone: undefined } : i)) });
    expect(steps.map((s) => s.argv)).toEqual([base("upsert", "block", "--target-page", "Planner tracker", "--content", "Beta", "--update-tags", '["Milestone"]')]);
  });
  it("writes a milestone's status and End by epoch ms", () => {
    const steps = p(change(101, { end: 1, status: "Todo" }));
    expect(steps[0].argv).toEqual(base("upsert", "block", "--id", "101", "--update-properties", `{"Status" "Doing" "End" ${t("2026-10-04T10:00:00+02:00")}}`));
  });
  it("sets a milestone's Project by the project's db id", () => {
    expect(p(change(102, { project: undefined }))[0].argv).toContain('{"Project" 100}');
  });
  it("adds missing Task tag properties", () => {
    expect(p({ ...full, taskClassProps: ["Team"] })[0].argv).toEqual(base("upsert", "tag", "--name", "Task", "--add-properties", '["Owner" "Milestone" "Start" "End"]'));
  });
});
