// npm run probe -- [--seed] [--writes] [--other-window]
//
// Live probe (T01). Drives the web app already open in a playwright-cli session (run from the
// session's directory, or set PLANNER_PW_CWD to it) and the Planner dev build registered there.
// Reads go through the plugin's dev-only hook (src/dev-probe.ts), so every fixture is what the
// plugin itself receives over the SDK bridge. Raw results land in src/core/__fixtures__/*.json.
//
//   --seed          import the seed (scripts/seed.edn.mjs) into the current graph first
//   --writes        also run the closed-value write + Undo probe (changes the seed's data)
//   --other-window  also open a second tab on the same graph and edit there while listening
//
// Only runs on the graphs `plugin-test` or the in-memory `Demo` (refuses anything else).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedEdn, SEED_PAGE, U } from "./seed.edn.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "src/core/__fixtures__");
const PW_CWD = process.env.PLANNER_PW_CWD ?? process.cwd();
const PLUGIN_URL = "http://localhost:8293";
const ALLOWED_GRAPHS = new Set(["logseq_db_plugin-test", "logseq_db_Demo"]);
const flags = new Set(process.argv.slice(2));

// ---------- playwright-cli plumbing ----------

function pw(...args) {
  const r = spawnSync("playwright-cli", args, { cwd: PW_CWD, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`playwright-cli ${args[0]} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Evaluates a JS expression in the host page (awaits promises) and JSON-parses its string result. */
function host(expr) {
  const out = pw("eval", `Promise.resolve(${expr}).then(function (v) { return JSON.stringify(v === undefined ? null : v) })`);
  const m = /### Result\n([\s\S]*?)\n### Ran Playwright code/.exec(out);
  if (!m) throw new Error(`unexpected playwright-cli output:\n${out.slice(0, 2000)}`);
  if (/^Error|^TypeError/.test(m[1])) throw new Error(m[1]);
  return JSON.parse(JSON.parse(m[1]));
}

const js = (v) => JSON.stringify(v);

/** Installs a host-side request/reply helper for the plugin's probe hook (idempotent). */
function installBridge() {
  host(`(window.__plannerProbe || (window.__plannerProbe = (function () {
    var seq = 0, waiting = {};
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (d && typeof d.plannerProbeReply === "number" && waiting[d.plannerProbeReply]) {
        waiting[d.plannerProbeReply](d); delete waiting[d.plannerProbeReply];
      }
    });
    return function (msg) {
      var frame = document.querySelector('iframe[src^="${PLUGIN_URL}"]');
      if (!frame) return Promise.reject(new Error("Planner iframe not found: register the dev plugin first"));
      var id = ++seq;
      return new Promise(function (resolve, reject) {
        waiting[id] = resolve;
        setTimeout(function () { if (waiting[id]) { delete waiting[id]; reject(new Error("probe hook timeout: " + JSON.stringify(msg))); } }, 15000);
        frame.contentWindow.postMessage(Object.assign({ plannerProbe: id }, msg), "*");
      });
    };
  })())) && true`);
}

/** Calls `logseq.<ns>.<fn>(...args)` inside the plugin iframe; returns { ok, detail }. */
function sdk(ns, fn, ...args) {
  const r = host(`window.__plannerProbe(${js({ op: "call", ns, fn, args })})`);
  return { call: `logseq.${ns}.${fn}(${args.map((a) => js(a)).join(", ")})`, ok: r.ok, detail: r.detail };
}
const dq = (query, ...inputs) => sdk("DB", "datascriptQuery", query, ...inputs);
const listen = () => host(`window.__plannerProbe({ op: "listen" })`);
const events = () => host(`window.__plannerProbe({ op: "events" })`).detail;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function save(name, data) {
  mkdirSync(FIXTURES, { recursive: true });
  const file = join(FIXTURES, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  console.log("wrote", file);
}

const meta = (graph) => ({
  capturedAt: new Date().toISOString(),
  graph,
  host: "Logseq web app dev build (pnpm watch) at http://localhost:3001",
  via: "plugin SDK through src/dev-probe.ts (scripts/probe.mjs)",
});

// ---------- queries (EDN strings, run through logseq.DB.datascriptQuery) ----------

let PROJECT = { uuid: null, ident: null };

const RULES = ` [[(class-extends ?p ?c) [?c :logseq.property.class/extends ?p]]
  [(class-extends ?p ?c) [?t :logseq.property.class/extends ?p] (class-extends ?t ?c)]]`;

const Q = {
  tags: `[:find (pull ?t [:db/id :db/ident :block/uuid :block/title :logseq.property/built-in?
                        {:logseq.property.class/extends [:db/id :db/ident :block/title]}
                        {:logseq.property.class/properties [:db/id :db/ident :block/title]}])
          :where [?t :block/tags :logseq.class/Tag]]`,
  classProperties: `[:find ?tag-title (pull ?p [:db/id :db/ident :block/uuid :block/title :logseq.property/type
                        :db/cardinality :logseq.property/built-in? :logseq.property/hide? :logseq.property/public?
                        {:logseq.property/default-value [:db/ident :block/title]}
                        {:logseq.property/classes [:db/ident :block/title]}
                        {:block/_closed-value-property [:db/id :db/ident :block/uuid :block/title :block/order
                          :logseq.property/choice-checkbox-state :logseq.property/icon
                          {:logseq.property/choice-classes [:db/ident :block/title]}]}])
          :in $ [?tag-title ...]
          :where [?t :block/tags :logseq.class/Tag] [?t :block/title ?tag-title]
                 [?t :logseq.property.class/properties ?p]]`,
  nodesOfTagWithExtends: `[:find (pull ?b [*])
          :in $ ?tag-title %
          :where [?tag :block/tags :logseq.class/Tag] [?tag :block/title ?tag-title]
                 [?b :block/tags ?t] (or [(= ?t ?tag)] (class-extends ?tag ?t))]`,
  taskRefs: `[:find (pull ?b [:db/id :block/uuid :block/title
                        {:block/tags [:db/ident :block/title]}
                        {:logseq.property/status [:db/ident :block/title]}
                        :logseq.property/deadline :logseq.property/scheduled
                        {:block/refs [:db/id :db/ident :block/uuid :block/title {:block/tags [:db/ident]}]}])
          :where [?b :block/tags :logseq.class/Task] [?b :block/page ?pg] [?pg :block/title "${SEED_PAGE}"]]`,
  tasksOfNodes: `[:find ?node-title ?task-title
          :in $ ?tag-title %
          :where [?tag :block/tags :logseq.class/Tag] [?tag :block/title ?tag-title]
                 [?n :block/tags ?t] (or [(= ?t ?tag)] (class-extends ?tag ?t))
                 [?task :block/tags :logseq.class/Task] [?task :block/refs ?n]
                 [?n :block/title ?node-title] [?task :block/title ?task-title]]`,
  // Date values are refs to journal pages; DateTime values are stored as epoch ms.
  dateValues: `[:find ?title ?prop-title ?raw ?journal-day
          :keys title property raw journal-day
          :where [?b :block/page ?pg] [?pg :block/title "${SEED_PAGE}"] [?b :block/title ?title]
                 [?p :logseq.property/type :date] [?p :db/ident ?pi] [?p :block/title ?prop-title]
                 [?b ?pi ?raw] [?raw :block/journal-day ?journal-day]]`,
  datetimeValues: `[:find ?title ?prop-title ?raw
          :keys title property raw
          :where [?b :block/page ?pg] [?pg :block/title "${SEED_PAGE}"] [?b :block/title ?title]
                 [?p :logseq.property/type :datetime] [?p :db/ident ?pi] [?p :block/title ?prop-title]
                 [?b ?pi ?raw]]`,
  journalPage: `[:find (pull ?j [*]) :in $ ?u :where [?b :block/uuid ?u] [?b :block/page ?pg] [?pg :block/title "${SEED_PAGE}"]
          [?p :logseq.property/type :date] [?p :db/ident ?pi] [?b ?pi ?j]]`,
  statusOf: `[:find (pull ?b [:block/uuid :block/title {:logseq.property/status [:db/ident :block/title]}]) :in $ ?u
          :where [?b :block/uuid ?u]]`,
};

// ---------- probes ----------

function graphGuard() {
  const g = host(`logseq.api.get_current_graph()`);
  if (!g || !ALLOWED_GRAPHS.has(g.name)) throw new Error(`refusing to probe graph ${g && g.name}: only plugin-test or Demo`);
  return g;
}

function seed() {
  const exists = host(`logseq.api.get_page(${js(SEED_PAGE)})`);
  if (exists) throw new Error(`${SEED_PAGE} already exists on this graph; seed only once per graph`);
  host(`logseq.api.import_edn(logseq.db.write_transit_str(cljs.reader.read_string(${js(seedEdn(new Date()))})))`);
  console.log("seeded", SEED_PAGE);
}

function readProbes(graph) {
  const m = meta(graph.name);
  // The Project tag's uuid and ident are generated on import; look them up to try both forms.
  PROJECT = dq(`[:find (pull ?t [:block/uuid :db/ident]) . :where [?t :block/tags :logseq.class/Tag] [?t :block/title "Project"]]`).detail;
  const userTags = ["Project", "Client project", "Meeting", "Task"];
  save("tags", {
    ...m,
    getAllTags: sdk("Editor", "getAllTags"),
    getTagProject: sdk("Editor", "getTag", "Project"),
    getTagClientProject: sdk("Editor", "getTag", "Client project"),
    getTagMeeting: sdk("Editor", "getTag", "Meeting"),
    getTagLowercase: sdk("Editor", "getTag", "project"),
    getTagTask: sdk("Editor", "getTag", "Task"),
    getTagsByNameProject: sdk("Editor", "getTagsByName", "Project"),
    getTagByUuid: sdk("Editor", "getTag", PROJECT.uuid),
    getTagByIdent: sdk("Editor", "getTag", PROJECT.ident),
    query: { query: Q.tags, ...dq(Q.tags) },
  });
  save("class-properties", { ...m, query: { query: Q.classProperties, inputs: [userTags], ...dq(Q.classProperties, userTags) } });
  save("nodes", {
    ...m,
    projectWithExtends: { query: Q.nodesOfTagWithExtends, inputs: ["Project", "<rules>"], ...dq(Q.nodesOfTagWithExtends, "Project", RULES) },
    meeting: { query: Q.nodesOfTagWithExtends, inputs: ["Meeting", "<rules>"], ...dq(Q.nodesOfTagWithExtends, "Meeting", RULES) },
    getTagObjectsProject: sdk("Editor", "getTagObjects", "Project"),
    getTagObjectsClientProject: sdk("Editor", "getTagObjects", "Client project"),
    getTagObjectsMeeting: sdk("Editor", "getTagObjects", "Meeting"),
    getTagObjectsByUuid: sdk("Editor", "getTagObjects", PROJECT.uuid),
    getTagObjectsByIdent: sdk("Editor", "getTagObjects", PROJECT.ident),
  });
  save("tasks", {
    ...m,
    taskRefs: { query: Q.taskRefs, ...dq(Q.taskRefs) },
    tasksOfProject: { query: Q.tasksOfNodes, inputs: ["Project", "<rules>"], ...dq(Q.tasksOfNodes, "Project", RULES) },
  });
  save("dates", {
    ...m,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    date: { query: Q.dateValues, ...dq(Q.dateValues) },
    datetime: { query: Q.datetimeValues, ...dq(Q.datetimeValues) },
    journalPageOfStart: { query: Q.journalPage, inputs: [`#uuid "${U.mobileApp}"`], ...dq(Q.journalPage, `#uuid "${U.mobileApp}"`) },
  });
  save("sdk-blocks", {
    ...m,
    project: sdk("Editor", "getBlock", U.website),
    projectProperties: sdk("Editor", "getBlockProperties", U.website),
    clientProject: sdk("Editor", "getBlock", U.acme),
    meeting: sdk("Editor", "getBlock", U.kickoff),
    task: sdk("Editor", "getBlock", U.draftBrief),
    taskByNodeProperty: sdk("Editor", "getBlock", U.wireframes),
  });
}

/** A user edit typed into the editor, collected as DB.onChanged payloads. */
async function localEdit(graph) {
  host(`logseq.api.push_state("page", { name: ${js(SEED_PAGE)} })`);
  host(`logseq.api.update_block(${js(U.looseTask)}, "Loose task")`);
  await sleep(1500);
  listen();
  host(`logseq.api.edit_block(${js(U.looseTask)}, { pos: "max" })`);
  await sleep(500);
  pw("press", "End");
  pw("type", " (edited)");
  pw("press", "Escape");
  await sleep(1500);
  save("onchanged-local-edit", { ...meta(graph.name), action: "typed ' (edited)' at the end of 'Loose task' in the editor, then Escape", events: events() });
}

/** Closed-value writes from the plugin, read back, Undo/Redo (host shortcuts), removal, restore. */
async function writes(graph) {
  const statusIdent = "logseq.property/status";
  const owner = host(`logseq.api.datascript_query(${js(`[:find ?i . :where [?p :block/title "Owner"] [?p :logseq.property/type :default] [?p :db/ident ?i]]`)})`);
  const closed = (propIdent) => dq(`[:find ?v ?uuid ?title :keys id uuid title :where [?p :db/ident ${propIdent}] [?v :block/closed-value-property ?p] [?v :block/uuid ?uuid] [?v :block/title ?title]]`).detail;
  const ownerValues = closed(`:${String(owner).replace(/^:/, "")}`);
  const statusValues = closed(`:${statusIdent}`);
  const byTitle = (vals, t) => vals.find((v) => v.title === t);
  const readStatus = (u) => dq(Q.statusOf, `#uuid "${u}"`).detail;
  const readOwner = (u) => dq(`[:find (pull ?b [:block/title {${owner} [:db/ident :block/uuid :block/title]}]) :in $ ?u :where [?b :block/uuid ?u]]`, `#uuid "${u}"`).detail;

  const steps = [];
  async function attempt(label, target, read, ...args) {
    listen();
    const r = sdk("Editor", "upsertBlockProperty", target, ...args);
    await sleep(800);
    steps.push({ label, ...r, readBack: read(target), events: events() });
  }
  const statusAttempts = [
    ["status by closed-value db id", "Doing", (v) => v.id],
    ["status by closed-value uuid", "In Review", (v) => v.uuid],
    ["status by title", "Done", (v) => v.title],
    ["status by ident keyword string", "Canceled", () => ":logseq.property/status.canceled"],
  ];
  // Undo / redo of the last plugin write, via the host's shortcuts (Escape first: not editing).
  async function undoRedo(label, target, read) {
    const before = read(target);
    listen();
    pw("press", "Escape");
    pw("press", "Meta+z");
    await sleep(1200);
    const afterUndo = read(target);
    const undoEvents = events();
    pw("press", "Meta+Shift+z");
    await sleep(1200);
    return { label, keys: "Escape, Meta+z, then Meta+Shift+z", before, afterUndo, afterRedo: read(target), undoEvents };
  }
  const undo = [];

  const [first, ...rest] = statusAttempts;
  await attempt(first[0], U.draftBrief, readStatus, statusIdent, first[2](byTitle(statusValues, first[1])));
  undo.push(await undoRedo("undo of 'status by closed-value db id'", U.draftBrief, readStatus));
  for (const [label, t, pick] of rest) await attempt(label, U.draftBrief, readStatus, statusIdent, pick(byTitle(statusValues, t)));
  await attempt("status by unqualified name 'status' (plugin namespace)", U.mobileApp, readStatus, "status", byTitle(statusValues, "Doing").id);

  const ownerKey = String(owner).replace(/^:/, "");
  const ownerAttempts = [
    ["owner by closed-value db id", "Bob", (v) => v.id],
    ["owner by closed-value uuid", "Alice", (v) => v.uuid],
    ["owner by title", "Bob", (v) => v.title],
  ];
  for (const [label, t, pick] of ownerAttempts) await attempt(label, U.website, readOwner, ownerKey, pick(byTitle(ownerValues, t)));
  undo.push(await undoRedo("undo of 'owner by title'", U.website, readOwner));

  // Removal, as a Kanban drop on "No <prop>" would do.
  listen();
  const removal = { ...sdk("Editor", "removeBlockProperty", U.website, ownerKey) };
  await sleep(800);
  Object.assign(removal, { readBack: readOwner(U.website), events: events() });

  // Restore the seed values and delete the plugin property the unqualified write created.
  const cleanup = {
    status: sdk("Editor", "upsertBlockProperty", U.draftBrief, statusIdent, byTitle(statusValues, "Todo").id),
    owner: sdk("Editor", "upsertBlockProperty", U.website, ownerKey, byTitle(ownerValues, "Alice").id),
    removePluginProperty: sdk("Editor", "removeProperty", "status"),
  };
  await sleep(800);
  cleanup.pluginIdentsLeft = dq(`[:find [?i ...] :where [?p :db/ident ?i]]`).detail.filter((i) => String(i).includes("plugin."));
  cleanup.readBack = { draftBrief: readStatus(U.draftBrief), mobileApp: readStatus(U.mobileApp), website: readOwner(U.website) };

  save("writes", { ...meta(graph.name), statusIdent, ownerIdent: owner, statusValues, ownerValues, steps, undo, removal, cleanup });
}

async function otherWindow(graph) {
  listen();
  pw("tab-new");
  pw("goto", "http://localhost:3001/");
  await sleep(10000);
  const second = host(`logseq.api.get_current_graph()`);
  let edited = null;
  if (second && second.name === graph.name) {
    edited = host(`logseq.api.update_block(${js(U.looseTask)}, "Loose task (edited in tab 2)").then(function () { return "update_block sent from tab 2" })`);
    await sleep(1500);
  }
  pw("tab-close", "1");
  pw("tab-select", "0");
  await sleep(1000);
  save("onchanged-other-window", { ...meta(graph.name), secondTabGraph: second, edited, events: events() });
  host(`logseq.api.update_block(${js(U.looseTask)}, "Loose task")`);
}

/** The hook answers only once the iframe has loaded and the SDK handshake is done. */
async function waitForHook() {
  for (let i = 0; ; i++) {
    try { return sdk("App", "getCurrentGraph"); } catch (e) { if (i >= 4) throw e; await sleep(2000); }
  }
}

async function main() {
  const graph = graphGuard();
  installBridge();
  await waitForHook();
  if (flags.has("--seed")) seed();
  await sleep(500);
  readProbes(graph);
  await localEdit(graph);
  if (flags.has("--writes")) await writes(graph);
  if (flags.has("--other-window")) await otherWindow(graph);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
