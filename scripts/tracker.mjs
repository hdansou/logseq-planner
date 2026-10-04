// `npm run tracker`: mirror tasks.md into a Logseq DB graph (default `planner-project`).
// tasks.md is the source of truth; the graph is a copy. Running it again converges: only real
// differences are written. Options: --graph <name>, --dry-run, --revision <prefix>.
//
// CLI shapes this relies on (found by experiment, build 8ffbb22):
//   upsert block --id <dbid> --update-properties '{"Team" "Dev" "Owner" "Claude" "Milestone" 195}'
//     choice values (Team, Owner, Status) by title string; node values (Milestone, Project) by the
//     target's numeric db id (a uuid string or [:block/uuid ...] is refused or makes a text node);
//     datetime values (Start, End) as epoch milliseconds, e.g. {"Start" 1791075949000}; they read back
//     as the same plain number (pull `:user.property/start-xxxx`), like the built-in Scheduled.
//   upsert block --id <dbid> --remove-properties '["End"]'
//   upsert task --target-page <page> --content <t> --status doing --scheduled <ISO>   (create)
//   upsert task --id <dbid> --status done --scheduled <ISO> | --no-scheduled          (update)
//   upsert tag --name Task --add-properties '["Team" "Owner" "Milestone"]'             (built-in tag: allowed)
// The CLI can exit 0 and write nothing, so the loop re-reads the graph after every round and
// stops only when the plan is empty. `graph import` is used once, at creation.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDesired, genEdn, parseGitLog, parseTasks, plan } from "./tracker-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ROUNDS = 5;

function parseArgs(argv) {
  const o = { graph: "planner-project", dryRun: false, revision: "8ffbb22" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--graph") o.graph = argv[++i];
    else if (argv[i] === "--revision") o.revision = argv[++i];
    else if (argv[i] === "--dry-run") o.dryRun = true;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  if (!o.graph) throw new Error("--graph needs a name");
  return o;
}

/** Runs `logseq` without a shell. Throws on a non-zero exit or a Failure/error result. */
function logseq(args, { allowFail = false } = {}) {
  const r = spawnSync("logseq", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}`;
  const bad = r.status !== 0 || /^Failure\(/m.test(out) || /^\{"status":"error"/m.test(out);
  if (bad && !allowFail) throw new Error(`logseq ${args.join(" ")}\n${out}${r.stderr ?? ""}`.trim());
  return out;
}

function queryJson(graph, query) {
  const out = logseq(["query", "-g", graph, "-o", "json", "--query", query]);
  const line = out.split("\n").find((l) => l.startsWith('{"status"'));
  return JSON.parse(line).data.result;
}

const revision = () => /Revision:\s*(\S+)/.exec(logseq(["--version"]))?.[1];
const graphExists = (name) => logseq(["graph", "list"]).split("\n").some((l) => l.trim() === name);
const edn = (s) => JSON.stringify(s);

/** Reads the tracker page, the Task tag's properties into `plan`'s `current`. */
function readCurrent(graph, page) {
  const idents = Object.fromEntries(
    queryJson(graph, '[:find ?t ?i :where [?e :db/ident ?i] [?e :block/title ?t] [(namespace ?i) ?n] [(= ?n "user.property")]]'),
  );
  const need = ["Start", "End", "Owner", "Team", "Milestone", "Project"];
  const miss = need.filter((t) => !idents[t]);
  if (miss.length) throw new Error(`graph "${graph}" lacks the property ${miss.join(", ")}: it was not created by this script`);
  const kw = (t) => `:${idents[t]}`;
  const pull = `[:db/id :block/title {:block/tags [:block/title]} {:logseq.property/status [:block/title]} :logseq.property/scheduled ${kw("Start")} ${kw("End")} ${["Owner", "Team", "Milestone", "Project"]
    .map((t) => `{${kw(t)} [:block/title]}`).join(" ")}]`;
  const rows = queryJson(graph,
    `[:find (pull ?b ${pull}) :where [?p :block/title ${edn(page)}] [?b :block/page ?p] [(missing? $ ?b :logseq.property/deleted-at)]]`);
  const items = [];
  for (const [b] of rows) {
    const tag = (b["block/tags"] ?? []).map((t) => t["block/title"]).find((t) => ["Project", "Milestone", "Task"].includes(t));
    if (!tag) continue;
    const val = (t) => b[idents[t]]?.["block/title"];
    const time = (t) => (typeof b[idents[t]] === "number" ? b[idents[t]] : undefined); // :datetime = epoch ms
    items.push({
      id: b["db/id"], tag, title: b["block/title"],
      status: b["logseq.property/status"]?.["block/title"],
      scheduled: typeof b["logseq.property/scheduled"] === "number" ? b["logseq.property/scheduled"] : undefined,
      start: time("Start"), end: time("End"), team: val("Team"), owner: val("Owner"),
      milestone: val("Milestone"), project: val("Project"),
    });
  }
  const taskClassProps = queryJson(graph,
    "[:find ?t :where [?c :db/ident :logseq.class/Task] [?c :logseq.property.class/properties ?x] [?x :block/title ?t]]").map(([t]) => t);
  return { taskClassProps, items };
}

function stopOwnServer(graph) {
  for (const line of logseq(["server", "list"], { allowFail: true }).split("\n")) {
    const c = line.trim().split(/\s+/);
    if (c[1] === graph && c[7] === "cli") logseq(["server", "stop", "-g", graph], { allowFail: true });
  }
}

/** What the graph will hold right after the import, for a dry run on a missing graph. */
function afterImport(d) {
  const items = [{ tag: "Project", ...d.project }, ...d.milestones.map((m) => ({ tag: "Milestone", ...m }))].map((x, i) => ({ id: 1000 + i, ...x }));
  return { taskClassProps: [], items };
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const rev = revision();
  console.log(`logseq revision ${rev}`);
  if (!rev?.startsWith(opt.revision)) throw new Error(`logseq reports revision ${rev}, expected ${opt.revision}* (pass --revision to override)`);

  const tasks = parseTasks(readFileSync(join(ROOT, "tasks.md"), "utf8"));
  const meta = JSON.parse(readFileSync(join(ROOT, "scripts/tracker-meta.json"), "utf8"));
  const log = spawnSync("git", ["log", "--format=%aI|%s"], { cwd: ROOT, encoding: "utf8" });
  if (log.status !== 0) throw new Error(`git log failed: ${log.stderr}`);
  const desired = buildDesired(tasks, parseGitLog(log.stdout.split("\n"), tasks.map((t) => t.id)), meta);
  console.log(`${tasks.length} tasks, ${desired.milestones.length} milestones, project ${desired.project.title}`);

  const g = opt.graph;
  let exists = graphExists(g);
  try {
    if (!exists) {
      if (opt.dryRun) {
        console.log(`[dry-run] would create graph "${g}" and import the schema, project and milestones`);
        for (const s of plan(desired, afterImport(desired), g)) console.log(`[dry-run] ${s.why}: logseq ${s.argv.join(" ")}`);
        return;
      }
      logseq(["graph", "create", "-g", g]);
      const file = join(mkdtempSync(join(tmpdir(), "tracker-")), "tracker.edn");
      writeFileSync(file, genEdn(desired));
      logseq(["graph", "import", "-g", g, "--type", "edn", "--input", file]);
      const made = readCurrent(g, desired.page).items.filter((i) => i.tag !== "Task");
      if (made.length !== desired.milestones.length + 1) throw new Error(`import wrote ${made.length} of ${desired.milestones.length + 1} project/milestone blocks`);
      console.log(`created graph "${g}" and imported the schema, project and milestones`);
      exists = true;
    }
    for (let round = 1; round <= MAX_ROUNDS + 1; round++) {
      const steps = plan(desired, readCurrent(g, desired.page), g);
      if (steps.length === 0) { console.log(round === 1 ? "graph is up to date: nothing to do" : `converged after ${round - 1} round(s)`); return; }
      if (opt.dryRun) { for (const s of steps) console.log(`[dry-run] ${s.why}: logseq ${s.argv.join(" ")}`); return; }
      if (round > MAX_ROUNDS) throw new Error(`plan not empty after ${MAX_ROUNDS} rounds:\n${steps.map((s) => `  ${s.why}`).join("\n")}`);
      console.log(`round ${round}: ${steps.length} change(s)`);
      for (const s of steps) { console.log(`  ${s.why}`); logseq(s.argv); }
    }
  } finally {
    if (exists || !opt.dryRun) stopOwnServer(g);
  }
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }
