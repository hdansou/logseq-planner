// Pure logic of `npm run tracker` (scripts/tracker.mjs): tasks.md + git log + tracker-meta.json
// -> desired graph state -> a plan of `logseq` CLI calls against the graph's current state.
// No I/O here; every function is tested in tracker-lib.test.mjs.
import { createHash } from "node:crypto";

export const STATUSES = ["Backlog", "Todo", "Doing", "Done"];
export const TEAMS = ["Product", "Dev", "QA", "Security", "Docs"];
export const OWNERS = ["Danzu", "Claude"];
export const TASK_PROPS = ["Team", "Owner", "Milestone", "Start", "End"];

/** `- [x] **T13a Title** — …` lines -> {id, title, done}. */
export function parseTasks(md) {
  const out = [];
  for (const line of md.split("\n")) {
    const m = /^- \[([ xX])\] \*\*([TN]\d+[a-z]?) (.+?)\*\*/.exec(line);
    if (m) out.push({ id: m[2], title: m[3], done: m[1] !== " " });
  }
  return out;
}

/**
 * `git log --format=%aI|%s` lines -> {id: {first, last}} (ISO strings). A commit names a task as
 * `(ID` (e.g. `(N03a)`): an exact task id wins (T13a is its own task), otherwise the trailing
 * letter is dropped (N03a counts for N03). Ids not in `known` are ignored.
 */
export function parseGitLog(lines, known) {
  const set = new Set(known);
  const out = {};
  for (const line of lines) {
    const bar = line.indexOf("|");
    if (bar < 0) continue;
    const time = line.slice(0, bar);
    for (const m of line.slice(bar + 1).matchAll(/\(([TN]\d+[a-z]?)\b/g)) {
      const id = set.has(m[1]) ? m[1] : m[1].replace(/[a-z]$/, "");
      if (!set.has(id)) continue;
      const e = out[id] ?? (out[id] = { first: time, last: time });
      if (Date.parse(time) < Date.parse(e.first)) e.first = time;
      if (Date.parse(time) > Date.parse(e.last)) e.last = time;
    }
  }
  return out;
}

const ms = (iso) => Date.parse(iso); // commit time: epoch ms, the value of a :datetime property
const min = (xs) => xs.reduce((a, b) => (a === undefined || b < a ? b : a), undefined);
const max = (xs) => xs.reduce((a, b) => (a === undefined || b > a ? b : a), undefined);
const pick = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** tasks + commits + meta -> {page, project, milestones, tasks}; throws on a task in no milestone. */
export function buildDesired(tasks, commits, meta) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const milestoneOf = new Map();
  for (const m of meta.milestones) {
    for (const id of m.tasks) {
      if (!byId.has(id)) throw new Error(`tracker-meta.json: milestone "${m.title}" names ${id}, which is not in tasks.md`);
      milestoneOf.set(id, m.title);
    }
  }
  for (const t of tasks) {
    if (!milestoneOf.has(t.id)) throw new Error(`task ${t.id} is in no milestone: add it to scripts/tracker-meta.json`);
  }
  const check = (what, v, allowed, id) => {
    if (!allowed.includes(v)) throw new Error(`tracker-meta.json: ${what} "${v}" of ${id} is not one of ${allowed.join(", ")}`);
    return v;
  };
  const dTasks = tasks.map((t) => {
    const o = meta.tasks?.[t.id] ?? {};
    const c = commits[t.id];
    const status = t.done ? "Done" : check("status", o.status ?? (c ? "Doing" : "Todo"), STATUSES, t.id);
    return pick({
      id: t.id,
      title: `${t.id} ${t.title}`,
      status,
      scheduled: c ? ms(c.first) : undefined,
      start: c ? ms(c.first) : undefined,
      end: c ? ms(c.last) : undefined,
      team: check("team", o.team ?? meta.defaultTeam, TEAMS, t.id),
      owner: check("owner", o.owner ?? meta.defaultOwner, OWNERS, t.id),
      milestone: milestoneOf.get(t.id),
    });
  });
  const milestones = meta.milestones.map((m) => {
    const own = dTasks.filter((t) => m.tasks.includes(t.id));
    const cs = m.tasks.map((id) => commits[id]).filter(Boolean);
    const status = own.every((t) => t.status === "Done") ? "Done" : cs.length ? "Doing" : "Todo";
    return pick({
      key: m.key, title: m.title, status, owner: meta.defaultOwner, project: meta.project,
      start: min(cs.map((c) => ms(c.first))), end: max(cs.map((c) => ms(c.last))),
    });
  });
  const project = pick({
    title: meta.project, status: "Doing", owner: meta.projectOwner ?? meta.defaultOwner,
    start: min(milestones.map((m) => m.start).filter(Boolean)),
  });
  return { page: meta.page, project, milestones, tasks: dTasks };
}

/** A deterministic v4-shaped uuid for a key, so reruns and imports agree on identities. */
export function stableUuid(key) {
  const h = createHash("sha1").update(`planner-tracker:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const edn = (s) => JSON.stringify(s);
const statusKw = (s) => `:logseq.property/status.${s.toLowerCase()}`;
const closed = (prefix, values) =>
  `[${values.map((v) => `{:value ${edn(v)} :uuid #uuid "${stableUuid(`${prefix}:${v}`)}"}`).join(" ")}]`;
/** sqlite.build EDN for a new graph: schema, the page, the project block and the milestone blocks. */
export function genEdn(d) {
  const projectUuid = stableUuid("project");
  const block = (uuid, x, tag, extra = "") =>
    `{:block/uuid #uuid "${uuid}" :build/keep-uuid? true :block/title ${edn(x.title)} :build/tags [${tag}]
     :build/properties {${[
       x.start ? `:start ${x.start}` : "", x.end ? `:end ${x.end}` : "",
       `:logseq.property/status ${statusKw(x.status)}`, `:owner ${edn(x.owner)}`, extra,
     ].filter(Boolean).join(" ")}}}`;
  return `{:properties
 {:start {:block/title "Start" :logseq.property/type :datetime}
  :end {:block/title "End" :logseq.property/type :datetime}
  :owner {:block/title "Owner" :logseq.property/type :default :build/closed-values ${closed("owner", OWNERS)}}
  :team {:block/title "Team" :logseq.property/type :default :build/closed-values ${closed("team", TEAMS)}}
  :milestone {:block/title "Milestone" :logseq.property/type :node}
  :project {:block/title "Project" :logseq.property/type :node}}
 :classes
 {:Project {:block/title "Project" :build/class-properties [:start :end :logseq.property/status :owner]}
  :Milestone {:block/title "Milestone" :build/class-properties [:start :end :logseq.property/status :owner :project]}}
 :pages-and-blocks
 [{:page {:block/title ${edn(d.page)}}
   :blocks
   [${block(projectUuid, d.project, ":Project")}
    ${d.milestones.map((m) => block(stableUuid(`milestone:${m.key}`), m, ":Milestone", `:project [:block/uuid #uuid "${projectUuid}"]`)).join("\n    ")}]}]}
`;
}

const iso = (n) => new Date(n).toISOString();
const argvOf = (graph, ...rest) => [...rest.slice(0, 2), "-g", graph, "-o", "json", ...rest.slice(2)];

/**
 * (desired, current, graph) -> [{argv, why}]. `current` = {taskClassProps: [title], items: [{id,
 * tag, title, status, scheduled, start, end (epoch ms), team, owner, milestone, project}]}
 * (milestone / project = the referenced block's title). A write that needs the id of a block that
 * does not exist yet (a milestone, the project) is left for the next round: the runner executes,
 * re-reads and plans again until the plan is empty.
 */
export function plan(desired, current, graph) {
  const A = (...r) => argvOf(graph, ...r);
  const steps = [];
  const add = (argv, why) => steps.push({ argv, why });
  const find = (tag, pred) => current.items.find((i) => i.tag === tag && pred(i));

  const missingProps = TASK_PROPS.filter((p) => !current.taskClassProps.includes(p));
  if (missingProps.length) add(A("upsert", "tag", "--name", "Task", "--add-properties", `[${missingProps.map(edn).join(" ")}]`), `add ${missingProps.join(", ")} to the Task tag`);

  const project = find("Project", (i) => i.title === desired.project.title);
  const refId = (tag, title) => find(tag, (i) => i.title === title)?.id;
  // [CLI property name, desired value, current value, EDN of the value to write]; writes the differences
  const writeProps = (have, want, label, fields) => {
    const set = [], clear = [];
    for (const [name, key, value] of fields) {
      if (have[key] === want[key]) continue;
      if (want[key] === undefined) clear.push(name);
      else if (value !== undefined) set.push([name, value]);
    }
    if (clear.length) add(A("upsert", "block", "--id", String(have.id), "--remove-properties", `[${clear.map(edn).join(" ")}]`), `clear ${clear.join(", ")} of ${label}`);
    if (set.length) add(A("upsert", "block", "--id", String(have.id), "--update-properties", `{${set.map(([k, v]) => `${edn(k)} ${v}`).join(" ")}}`), `set ${set.map(([k]) => k).join(", ")} of ${label}`);
  };
  const str = (v) => (v === undefined ? undefined : edn(v));
  const num = (v) => (v === undefined ? undefined : String(v));

  const container = (want, tag, have, extra) => {
    if (!have) {
      add(A("upsert", "block", "--target-page", desired.page, "--content", want.title, "--update-tags", `["${tag}"]`), `create ${tag} ${want.title}`);
      return;
    }
    writeProps(have, want, want.title, [
      ["Status", "status", str(want.status)], ["Start", "start", num(want.start)], ["End", "end", num(want.end)],
      ["Owner", "owner", str(want.owner)], ...extra,
    ]);
  };
  container(desired.project, "Project", project, []);
  for (const m of desired.milestones) {
    const pid = project?.id;
    container(m, "Milestone", find("Milestone", (i) => i.title === m.title), [["Project", "project", pid === undefined ? undefined : String(pid)]]);
  }

  for (const t of desired.tasks) {
    const have = find("Task", (i) => i.title.startsWith(`${t.id} `));
    if (!have) {
      add(A("upsert", "task", "--target-page", desired.page, "--content", t.title, "--status", t.status.toLowerCase(), ...(t.scheduled === undefined ? [] : ["--scheduled", iso(t.scheduled)])), `create ${t.id}`);
      continue;
    }
    const upd = [];
    if (have.title !== t.title) upd.push("--content", t.title);
    if (have.status !== t.status) upd.push("--status", t.status.toLowerCase());
    if (have.scheduled !== t.scheduled) upd.push(...(t.scheduled === undefined ? ["--no-scheduled"] : ["--scheduled", iso(t.scheduled)]));
    if (upd.length) add(A("upsert", "task", "--id", String(have.id), ...upd), `update ${t.id}`);
    const mid = refId("Milestone", t.milestone);
    writeProps(have, t, t.id, [
      ["Team", "team", str(t.team)], ["Owner", "owner", str(t.owner)],
      ["Milestone", "milestone", mid === undefined ? undefined : String(mid)],
      ["Start", "start", num(t.start)], ["End", "end", num(t.end)],
    ]);
  }
  return steps;
}

/**
 * References check. Planner finds a milestone's tasks with `[?task :block/refs ?milestone]`, but a
 * block written through a CLI-owned db-worker (`logseq server list` -> owner-source cli) gets no
 * `:block/refs` at all. Verified 2026-10-03, CLI revision 8ffbb22-dirty: EDN import fills refs; with
 * an app holding the graph (owner-source electron) any CLI write to a block, even the same value,
 * rebuilds that block's refs (11 for a task); with a CLI-owned worker the same write leaves them empty.
 * So: `missing` = blocks (tasks: Milestone not in refs, milestones: Project not in refs) with
 * {id, tag, title, team | owner}; electron -> same-value rewrite of Team (task) / Owner (milestone);
 * otherwise no repair, only a notice. -> {steps, notice}.
 */
export function refsRepair(missing, ownerSource, graph) {
  if (missing.length === 0) return { steps: [], notice: undefined };
  if (ownerSource !== "electron") {
    return {
      steps: [],
      notice: `${missing.length} block(s) have no references yet (the CLI's own worker does not write them): open ${graph} in Logseq-DB and run "npm run tracker" again`,
    };
  }
  const steps = missing.map((b) => {
    const [name, value] = b.tag === "Task" ? ["Team", b.team] : ["Owner", b.owner];
    return { argv: argvOf(graph, "upsert", "block", "--id", String(b.id), "--update-properties", `{${edn(name)} ${edn(value)}}`), why: `rebuild references of ${b.title}` };
  });
  return { steps, notice: undefined };
}
