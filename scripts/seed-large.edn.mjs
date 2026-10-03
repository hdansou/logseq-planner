// Large deterministic seed for the load test (T13): sqlite.build EDN like scripts/seed.edn.mjs, imported by
// `npm run probe -- --seed-large [N]`. A new tag #Load item (so #Project / #Meeting counts stay as they are) on its
// own page, N nodes and linked #Task blocks. Same seed + same day + same N = same EDN (mulberry32, no Math.random).
// Dates are relative to the day the seed is built. Closed values carry explicit uuids, nodes and tasks fixed uuids.

export const LARGE_PAGE = "Planner load test";
export const LARGE_TAG = "Load item";
export const DEFAULT_N = 2000;
export const DEFAULT_SEED = 13;

const STATUSES = [
  ["backlog", 0.12], ["todo", 0.25], ["doing", 0.2], ["in-review", 0.1], ["done", 0.28], ["canceled", 0.05],
];
const LEADS = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank"];
const TEAMS = ["Design", "Platform", "Growth", "Ops"];
const ADJ = ["Quarterly", "Urgent", "Internal", "Customer", "Mobile", "Legacy", "Pilot", "Regional", "Security", "Partner"];
const NOUN = ["rollout", "migration", "audit", "launch", "review", "cleanup", "redesign", "onboarding", "report", "upgrade"];
const VERB = ["Draft", "Review", "Ship", "Test", "Plan", "Fix", "Write", "Check", "Sync", "Update"];
const WINDOW_DAYS = 274; // about 9 months

const uuid = (prefix, n) => `6a${prefix}00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const nodeUuid = (i) => uuid("1", i);
const taskUuid = (i) => uuid("2", i);
const closedUuid = (group, i) => uuid("3", group * 100 + i);

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const journalDay = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const at = (d, h, m) => { const r = new Date(d); r.setHours(h, m, 0, 0); return r.getTime(); };

/** The pure model plus its EDN: `{ nodes, tasks, edn }`. Dates are journal-day numbers (YYYYMMDD), null = no value. */
export function buildLargeSeed({ n = DEFAULT_N, today = new Date(), seed = DEFAULT_SEED, propPrefix = "" } = {}) {
  const rnd = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const status = () => {
    let r = rnd();
    for (const [name, w] of STATUSES) if ((r -= w) < 0) return name;
    return STATUSES[0][0];
  };
  const day = (offset) => journalDay(addDays(today, offset));

  const nodes = [];
  for (let i = 0; i < n; i++) {
    const kind = rnd();
    let start = null, end = null;
    if (kind < 0.7) {
      const s = int(-WINDOW_DAYS, WINDOW_DAYS);
      start = day(s);
      end = day(s + int(1, 60));
    } else if (kind < 0.775) start = day(int(-WINDOW_DAYS, WINDOW_DAYS));
    else if (kind < 0.85) end = day(int(-WINDOW_DAYS, WINDOW_DAYS));
    nodes.push({
      uuid: nodeUuid(i), title: `${pick(ADJ)} ${pick(NOUN)} ${String(i + 1).padStart(4, "0")}`, start, end, status: status(),
      // About one node in ten has no Lead / Team: the "No value" filter and the "No <prop>" Kanban column get cards.
      lead: rnd() < 0.1 ? null : pick(LEADS), team: rnd() < 0.1 ? null : pick(TEAMS),
    });
  }

  const tasks = [];
  for (const node of nodes) {
    if (rnd() >= 1 / 3) continue;
    for (let k = int(1, 5); k > 0; k--) {
      tasks.push({
        uuid: taskUuid(tasks.length), node: node.uuid, title: `${pick(VERB)} ${pick(NOUN)}`, status: status(),
        deadlineOffset: rnd() < 0.55 ? int(-60, 60) : null,
      });
    }
  }

  const title = (t) => `${propPrefix}${t}`;
  const block = (id, text, tags, props = "") =>
    `{:block/uuid #uuid "${id}" :build/keep-uuid? true :block/title ${JSON.stringify(text)} :build/tags ${tags} :build/properties {${props}}}`;
  const page = (j) => `[:build/page {:build/journal ${j}}]`;
  const closed = (group, values) => values.map((v, i) => `{:value ${JSON.stringify(v)} :uuid #uuid "${closedUuid(group, i)}"}`).join(" ");
  const nodeBlock = (x) => block(x.uuid, x.title, "[:LoadItem]", [
    x.start !== null && `:lt-start ${page(x.start)}`,
    x.end !== null && `:lt-end ${page(x.end)}`,
    `:logseq.property/status :logseq.property/status.${x.status}`,
    x.lead !== null && `:lt-lead ${JSON.stringify(x.lead)}`,
    x.team !== null && `:lt-team ${JSON.stringify(x.team)}`,
  ].filter(Boolean).join(" "));
  const taskBlock = (t) => block(t.uuid, `${t.title} [[${t.node}]]`, "[:logseq.class/Task]", [
    `:logseq.property/status :logseq.property/status.${t.status}`,
    t.deadlineOffset !== null && `:logseq.property/deadline ${at(addDays(today, t.deadlineOffset), 17, 0)}`,
  ].filter(Boolean).join(" "));

  const days = [...new Set(nodes.flatMap((x) => [x.start, x.end]).filter((j) => j !== null))].sort((a, b) => a - b);
  const edn = `{:properties
 {:lt-start {:block/title ${JSON.stringify(title("Start"))} :logseq.property/type :date}
  :lt-end {:block/title ${JSON.stringify(title("End"))} :logseq.property/type :date}
  :lt-lead {:block/title ${JSON.stringify(title("Lead"))} :logseq.property/type :default
            :build/closed-values [${closed(1, LEADS)}]}
  :lt-team {:block/title ${JSON.stringify(title("Team"))} :logseq.property/type :default
            :build/closed-values [${closed(2, TEAMS)}]}}
 :classes
 {:LoadItem {:block/title ${JSON.stringify(LARGE_TAG)} :build/class-properties [:lt-start :lt-end :logseq.property/status :lt-lead :lt-team]}}
 :pages-and-blocks
 [${days.map((j) => `{:page {:build/journal ${j}}}`).join("\n  ")}
  {:page {:block/title ${JSON.stringify(LARGE_PAGE)}}
   :blocks
   [${[...nodes.map(nodeBlock), ...tasks.map(taskBlock)].join("\n    ")}]}]}`;
  return { nodes, tasks, edn };
}

export const seedLargeEdn = (opts) => buildLargeSeed(opts).edn;
