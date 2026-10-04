// Pure logic of `npm run tracker` (scripts/tracker.mjs): tasks.md + git log + tracker-meta.json
// -> desired graph state -> a plan of `logseq` CLI calls against the graph's current state.
// No I/O here; every function is tested in tracker-lib.test.mjs.
import { createHash } from "node:crypto";

export const STATUSES = ["Backlog", "Todo", "Doing", "Done"];
export const TEAMS = ["Product", "Dev", "QA", "Security", "Docs"];
export const OWNERS = ["Danzu", "Claude"];
export const TASK_PROPS = ["Team", "Owner", "Milestone", "Start", "End", "depends_on"];

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

const ms = (iso) => Date.parse(iso); // commit time: epoch ms, only used to order tasks
const min = (xs) => xs.reduce((a, b) => (a === undefined || b < a ? b : a), undefined);
const max = (xs) => xs.reduce((a, b) => (a === undefined || b > a ? b : a), undefined);
const pick = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// ---- planned schedule (N11) -------------------------------------------------------------------
// Working time is weekdays 09:00-17:00 in the machine's local zone. Dates are built from local
// components, so the rules hold in any zone.
const DAY_START = 9 * 60;
const DAY_END = 17 * 60;
const at = (d, minutes) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes);
const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();

/** The first working moment at or after `d`: a time before 09:00 -> 09:00, at or after 17:00 or on a weekend -> next working day 09:00. */
export function toWorkingTime(d) {
  let cur = d;
  for (;;) {
    const weekend = cur.getDay() === 0 || cur.getDay() === 6;
    const m = minutesOf(cur);
    if (!weekend && m < DAY_END) return m < DAY_START ? at(cur, DAY_START) : cur;
    cur = at(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1), DAY_START);
  }
}

/** `hours` working hours after `start` (already working time); a task past 17:00 goes on the next working day at 09:00. */
export function addWorkingHours(start, hours) {
  let left = Math.round(hours * 60);
  let cur = start;
  for (;;) {
    const room = DAY_END - minutesOf(cur);
    if (left <= room) return at(cur, minutesOf(cur) + left);
    left -= room;
    cur = toWorkingTime(at(cur, DAY_END));
  }
}

/** "2026-09-25T15:00" (no zone) -> a local Date. */
export function parseLocal(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text ?? "");
  if (!m) throw new Error(`tracker-meta.json: scheduleStart "${text}" must look like 2026-09-25T15:00 (local time, no zone)`);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

const idKey = (id) => {
  const m = /^([TN])(\d+)([a-z]?)$/.exec(id);
  return [m[1] === "T" ? 0 : 1, Number(m[2]), m[3]];
};
const byId = (a, b) => {
  const [x, y] = [idKey(a), idKey(b)];
  return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
};

/** Task ids: those with commits by first commit (ties by id), then the rest by id (T before N, numeric). */
export function orderTasks(ids, commits) {
  const withC = ids.filter((id) => commits[id]).sort((a, b) => ms(commits[a].first) - ms(commits[b].first) || byId(a, b));
  const without = ids.filter((id) => !commits[id]).sort(byId);
  return [...withC, ...without];
}

/**
 * order + meta -> {id: {start, end, after}} (epoch ms; `after` = dependency ids). A task depends on the
 * previous one in `order` unless meta.after has an entry for it; `"after": {"X": []}` means no dependency
 * (X starts at meta.scheduleStart). A task starts at the latest End of its dependencies, moved into working
 * time, and lasts meta.taskHours (per task: meta.hours). Dependencies only set the earliest start: tasks
 * with no dependency between them overlap. Throws on an unknown id in `after` / `hours` or a dependency cycle.
 */
export function schedule(order, meta) {
  const known = new Set(order);
  for (const id of Object.keys(meta.hours ?? {})) {
    if (!known.has(id)) throw new Error(`tracker-meta.json: hours names ${id}, which is not a task`);
  }
  for (const [id, deps] of Object.entries(meta.after ?? {})) {
    if (!known.has(id)) throw new Error(`tracker-meta.json: after names ${id}, which is not a task`);
    for (const d of deps) if (!known.has(d)) throw new Error(`tracker-meta.json: ${id} runs after ${d}, which is not a task`);
  }
  const anchor = parseLocal(meta.scheduleStart);
  const afterOf = (id) => meta.after?.[id] ?? (order[0] === id ? [] : [order[order.indexOf(id) - 1]]);
  const out = {};
  const visiting = [];
  const place = (id) => {
    if (out[id]) return out[id];
    if (visiting.includes(id)) throw new Error(`tracker-meta.json: dependency cycle ${[...visiting.slice(visiting.indexOf(id)), id].join(" -> ")}`);
    visiting.push(id);
    const after = afterOf(id);
    const hours = meta.hours?.[id] ?? meta.taskHours;
    if (!(hours > 0)) throw new Error(`tracker-meta.json: taskHours / hours of ${id} must be a positive number`);
    const from = after.length ? new Date(Math.max(...after.map((d) => place(d).end))) : anchor;
    const start = toWorkingTime(from);
    visiting.pop();
    return (out[id] = { start: start.getTime(), end: addWorkingHours(start, hours).getTime(), after });
  };
  order.forEach(place);
  return out;
}

/** tasks + commits + meta -> {page, project, milestones, tasks}; throws on a task in no milestone. */
export function buildDesired(tasks, commits, meta) {
  const byTaskId = new Map(tasks.map((t) => [t.id, t]));
  const milestoneOf = new Map();
  for (const m of meta.milestones) {
    for (const id of m.tasks) {
      if (!byTaskId.has(id)) throw new Error(`tracker-meta.json: milestone "${m.title}" names ${id}, which is not in tasks.md`);
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
  const order = orderTasks(tasks.map((t) => t.id), commits);
  const plan_ = schedule(order, meta);
  const titleOf = (id) => `${id} ${byTaskId.get(id).title}`;
  const dTasks = tasks.map((t) => {
    const o = meta.tasks?.[t.id] ?? {};
    const c = commits[t.id];
    const status = t.done ? "Done" : check("status", o.status ?? (c ? "Doing" : "Todo"), STATUSES, t.id);
    const s = plan_[t.id];
    return {
      id: t.id,
      title: titleOf(t.id),
      status,
      scheduled: s.start,
      start: s.start,
      end: s.end,
      dependsOn: s.after.map(titleOf).sort(),
      team: check("team", o.team ?? meta.defaultTeam, TEAMS, t.id),
      owner: check("owner", o.owner ?? meta.defaultOwner, OWNERS, t.id),
      milestone: milestoneOf.get(t.id),
    };
  });
  const milestones = meta.milestones.map((m) => {
    const own = dTasks.filter((t) => m.tasks.includes(t.id));
    const status = own.every((t) => t.status === "Done") ? "Done" : m.tasks.some((id) => commits[id]) ? "Doing" : "Todo";
    return pick({
      key: m.key, title: m.title, status, owner: meta.defaultOwner, project: meta.project,
      start: min(own.map((t) => t.start)), end: max(own.map((t) => t.end)),
    });
  });
  const project = pick({
    title: meta.project, status: "Doing", owner: meta.projectOwner ?? meta.defaultOwner,
    start: min(dTasks.map((t) => t.start)),
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
  :project {:block/title "Project" :logseq.property/type :node}
  :depends-on {:block/title "depends_on" :logseq.property/type :node :db/cardinality :db.cardinality/many}}
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
      const same = Array.isArray(want[key]) ? JSON.stringify(have[key] ?? []) === JSON.stringify(want[key]) : have[key] === want[key];
      if (same) continue;
      if (want[key] === undefined || (Array.isArray(want[key]) && want[key].length === 0)) clear.push(name);
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

  // depends_on: a vector of the dependency blocks' db ids; undefined until every one exists (next round)
  const depIds = (t) => {
    const ids = t.dependsOn.map((title) => find("Task", (i) => i.title === title)?.id);
    return ids.length && ids.every((x) => x !== undefined) ? `[${ids.join(" ")}]` : undefined;
  };
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
      ["depends_on", "dependsOn", depIds(t)],
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
