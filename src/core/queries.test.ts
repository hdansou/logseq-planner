import { describe, expect, it } from "vitest";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos } from "./schema";
import { buildTagInfos as _b, loadTagInfos } from "./schema";
import { loadNodes, loadNodesAndTasks, loadTitles, nodePropIdents, nodesQuery, notRecycled, readRaw, TASKS_QUERY, TITLES_QUERY, CLASS_EXTENDS_RULES } from "./queries";
import { fixtureDq, type Recycled } from "../ui/test-fakes";
import type { PlannerNode, PlannerTask, TagInfo } from "../types";
import type { ZoneOffset } from "./normalize";

const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
const tag = (title: string): TagInfo => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
const west5: ZoneOffset = () => -300; // the zone the fixtures were captured in (UTC-5)
const utc: ZoneOffset = () => 0;

interface Call {
  query: string;
  inputs: unknown[];
}
/** The fixture `dq` (src/ui/test-fakes.ts: answers each known query from the T01 fixtures), recording the calls. */
function fakeDq() {
  const calls: Call[] = [];
  const base = fixtureDq();
  const dq = async (query: string, ...inputs: unknown[]) => {
    calls.push({ query, inputs });
    return base(query, ...inputs);
  };
  return { dq, calls };
}
const nodeTitles = (ns: PlannerNode[]) => ns.map((n) => n.title).sort();
const byTitle = (ns: PlannerNode[], title: string) => {
  const n = ns.find((x) => x.title === title);
  if (!n) throw new Error(`no node ${title}`);
  return n;
};
const dateIdent = (t: TagInfo, title: string) => {
  const p = t.dateProps.find((x) => x.title === title);
  if (!p) throw new Error(`no date prop ${title}`);
  return p.ident;
};

describe("loadNodes", () => {
  it("sends the tag's entity id (a number, not its title) and the extends rules last (T14)", async () => {
    const { dq, calls } = fakeDq();
    await loadNodes(dq, tags, tag("Project"), { childTags: true, zone: west5 });
    expect(calls[0].inputs).toEqual([tag("Project").id, CLASS_EXTENDS_RULES]);
    expect(CLASS_EXTENDS_RULES.startsWith(" ")).toBe(true);
  });

  it("pulls only id, uuid, title, tags and the date and choice properties of every tag (T13a: no pull [*])", async () => {
    const { dq, calls } = fakeDq();
    await loadNodes(dq, tags, tag("Project"), { childTags: true, zone: west5 });
    const idents = nodePropIdents(tags);
    expect(calls[0].query).toBe(nodesQuery(tags));
    expect(calls[0].query).not.toContain("[*]");
    const dateIdents = new Set(tags.flatMap((t) => t.dateProps).filter((p) => p.type === "date").map((p) => p.ident));
    const attrs = idents.map((i) => (dateIdents.has(i) ? `{${i} [:db/id :block/journal-day]}` : i));
    expect(calls[0].query).toContain(`(pull ?b [:db/id :block/uuid :block/title :block/tags ${attrs.join(" ")}])`);
    // Project's own Start/End/Status/Owner, Meeting's Date/Type and Task's Deadline/Scheduled/Status/Priority, each once
    const project = tag("Project");
    for (const p of [...project.dateProps, ...project.choiceProps, ...tag("Meeting").dateProps, ...tag("Task").dateProps]) expect(idents).toContain(p.ident);
    expect(new Set(idents).size).toBe(idents.length);
    // never a text property (Client project's Client) or an attribute normalisation does not read
    expect(idents.some((i) => i.startsWith(":user.property/client-"))).toBe(false);
  });

  it("an ident that is not a valid keyword is never put into the pull; the tag stays usable (T14)", async () => {
    // Fixture property rows with ONLY their idents changed: Owner to one with a space, Meeting's Type to one with "]",
    // End to a valid exotic one Logseq can generate ("Done?").
    const props = (propsFixture.query.detail as [string, Record<string, unknown>][]).map(([t, p]) => [t,
      t === "Project" && p.title === "Owner" ? { ...p, ident: ":user.property/own er" }
        : t === "Meeting" && p.title === "Type" ? { ...p, ident: ":user.property/st]x" }
        : t === "Project" && p.title === "End" ? { ...p, ident: ":user.property/done?-x" } : p]);
    const odd = buildTagInfos(tagsFixture.query.detail as unknown[], props);
    const q = nodesQuery(odd);
    expect(q).not.toContain("own er");
    expect(q).not.toContain("st]x");
    expect(q).toContain("{:user.property/done?-x [:db/id :block/journal-day]}");
    expect(nodePropIdents(odd)).not.toContain(":user.property/own er");
    expect(q).toContain(":logseq.property/status"); // the other idents stay
    expect(odd.find((t) => t.title === "Project")!.choiceProps.map((p) => p.title)).toEqual(["Status", "Owner"]); // the tag is still usable
  });

  it("keeps the extends rule join of the node query", () => {
    expect(nodesQuery(tags)).toContain(":in $ ?tag %");
    expect(nodesQuery(tags)).not.toContain(":block/title ?tag-title");
    expect(nodesQuery(tags)).toContain("(or [(= ?t ?tag)] (class-extends ?tag ?t))");
  });

  it("includes nodes of extending tags when child tags are on", async () => {
    const { dq } = fakeDq();
    const nodes = await loadNodes(dq, tags, tag("Project"), { childTags: true, zone: west5 });
    expect(nodeTitles(nodes)).toEqual(["Acme rollout", "Archive cleanup", "Mobile app", "Website relaunch"]);
    expect(byTitle(nodes, "Acme rollout").tagIds).toEqual([tag("Client project").id]);
  });

  it("excludes nodes only tagged with an extending tag when child tags are off", async () => {
    const { dq } = fakeDq();
    const nodes = await loadNodes(dq, tags, tag("Project"), { childTags: false, zone: west5 });
    expect(nodeTitles(nodes)).toEqual(["Archive cleanup", "Mobile app", "Website relaunch"]);
  });

  it("maps Date values (journal page refs) to local ISO days", async () => {
    const { dq } = fakeDq();
    const project = tag("Project");
    const nodes = await loadNodes(dq, tags, project, { childTags: true, zone: west5 });
    const site = byTitle(nodes, "Website relaunch");
    expect(site.dates[dateIdent(project, "Start")]).toEqual({ day: "2026-09-23", time: null });
    expect(site.dates[dateIdent(project, "End")]).toEqual({ day: "2026-10-23", time: null });
    // inherited props map on a child-tag node
    const acme = byTitle(nodes, "Acme rollout");
    expect(acme.dates[dateIdent(project, "Start")]).toEqual({ day: "2026-09-30", time: null });
  });

  it("maps DateTime values (epoch ms) to the local day and HH:MM", async () => {
    const { dq } = fakeDq();
    const meeting = tag("Meeting");
    const nodes = await loadNodes(dq, tags, meeting, { childTags: true, zone: west5 });
    const kickoff = byTitle(nodes, "Kickoff").dates[dateIdent(meeting, "Date")];
    expect(kickoff.time).toBe("10:30"); // seeded at 10:30 local
    expect(kickoff.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("puts a DateTime near midnight on the local day, whatever the zone", async () => {
    // Late review: 23:45 local in UTC-5 is 04:45 the next day in UTC (instant 1791175500000).
    const meeting = tag("Meeting");
    const ident = dateIdent(meeting, "Date");
    const inWest = byTitle(await loadNodes(fakeDq().dq, tags, meeting, { childTags: true, zone: west5 }), "Late review");
    const inUtc = byTitle(await loadNodes(fakeDq().dq, tags, meeting, { childTags: true, zone: utc }), "Late review");
    expect(inWest.dates[ident]).toEqual({ day: "2026-10-04", time: "23:45" });
    expect(inUtc.dates[ident]).toEqual({ day: "2026-10-05", time: "04:45" });
  });

  it("gives a node with no dates an empty dates map", async () => {
    const { dq } = fakeDq();
    const nodes = await loadNodes(dq, tags, tag("Meeting"), { childTags: true, zone: west5 });
    expect(byTitle(nodes, "Untimed meeting").dates).toEqual({});
    const archive = byTitle(await loadNodes(dq, tags, tag("Project"), { childTags: true, zone: west5 }), "Archive cleanup");
    expect(archive.dates).toEqual({});
  });

  it("maps choice values to the tag's closed values", async () => {
    const { dq } = fakeDq();
    const project = tag("Project");
    const nodes = await loadNodes(dq, tags, project, { childTags: true, zone: west5 });
    const status = project.choiceProps.find((p) => p.title === "Status")!;
    const owner = project.choiceProps.find((p) => p.title === "Owner")!;
    const site = byTitle(nodes, "Website relaunch");
    expect(status.values.map((v) => v.id)).toContain(site.choices[status.ident].id);
    expect(owner.values.map((v) => v.id)).toContain(site.choices[owner.ident].id);
    expect(byTitle(nodes, "Archive cleanup").choices[owner.ident]).toBeUndefined();
  });

  it("pulls a Date value's journal day with it: one query, no journal-day lookup (T13a)", async () => {
    const start = tag("Project").dateProps.find((p) => p.title === "Start")!.ident;
    const meetingDate = tag("Meeting").dateProps.find((p) => p.title === "Date")!.ident; // DateTime: stays a plain attribute
    expect(nodesQuery(tags)).toContain(`{${start} [:db/id :block/journal-day]}`);
    expect(nodesQuery(tags)).not.toContain(`{${meetingDate} `);
    for (const title of ["Project", "Meeting"]) {
      const { dq, calls } = fakeDq();
      await loadNodes(dq, tags, tag(title), { childTags: true, zone: west5 });
      expect(calls.map((c) => c.query)).toEqual([nodesQuery(tags)]);
    }
  });

  it("fails fast when a pulled Date value has no journal day", async () => {
    const base = fixtureDq();
    const strip = (rows: unknown[]) => (rows as [Record<string, unknown>][]).map(([n]) =>
      [Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v && typeof v === "object" && "journal-day" in v ? { id: (v as unknown as { id: number }).id } : v]))]);
    const dq = async (query: string, ...inputs: unknown[]) => (query === nodesQuery(tags) ? strip(await base(query, ...inputs)) : base(query, ...inputs));
    await expect(loadNodes(dq, tags, tag("Project"), { childTags: true, zone: west5 })).rejects.toThrow(/journal day/);
  });
});

describe("loadNodesAndTasks", () => {
  const load = async () => {
    const { dq } = fakeDq();
    return loadNodesAndTasks(dq, tags, tag("Project"), { childTags: true, zone: west5 });
  };
  const task = (tasks: PlannerTask[], start: string) => tasks.find((t) => t.title.startsWith(start));

  it("finds tasks linked by inline ref and by node property, with their status", async () => {
    const { nodes, tasks } = await load();
    const site = byTitle(nodes, "Website relaunch");
    const mobile = byTitle(nodes, "Mobile app");
    const acme = byTitle(nodes, "Acme rollout");
    expect(task(tasks, "Draft brief")).toMatchObject({ nodeIds: [site.id], status: { title: "Todo" } });
    expect(task(tasks, "Wireframes")).toMatchObject({ nodeIds: [mobile.id], status: { title: "Doing" } });
    expect(task(tasks, "Acme contract")).toMatchObject({ nodeIds: [acme.id] });
    expect(task(tasks, "Ship homepage")?.status?.ident).toBe(":logseq.property/status.done");
    expect(task(tasks, "Survey users")?.status?.ident).toBe(":logseq.property/status.canceled");
  });

  it("carries the task's Deadline and Scheduled as local dates, null when absent", async () => {
    const { tasks } = await load();
    expect(task(tasks, "Draft brief")).toMatchObject({ deadline: { day: "2026-10-05", time: "17:00" }, scheduled: null });
    expect(task(tasks, "Acme contract")).toMatchObject({ deadline: { day: "2026-10-02", time: "12:00" }, scheduled: null });
    expect(task(tasks, "Wireframes")).toMatchObject({ deadline: null, scheduled: { day: "2026-10-09", time: "09:00" } });
  });

  it("leaves out a task with no ref to a loaded node", async () => {
    const { tasks } = await load();
    expect(task(tasks, "Loose task")).toBeUndefined();
    expect(tasks).toHaveLength(5);
  });

  it("ignores refs to property and tag entities", async () => {
    const { nodes, tasks } = await load();
    const ids = new Set(nodes.map((n) => n.id));
    for (const t of tasks) for (const id of t.nodeIds) expect(ids.has(id)).toBe(true);
  });

  it("the task query is bound to the tag's nodes (tag id + extends rules) and pulls no nested tags or ref titles (T13a)", async () => {
    const { dq, calls } = fakeDq();
    await loadNodesAndTasks(dq, tags, tag("Project"), { childTags: true, zone: west5 });
    const call = calls.find((c) => c.query === TASKS_QUERY)!;
    expect(call.inputs).toEqual([tag("Project").id, CLASS_EXTENDS_RULES]);
    expect(TASKS_QUERY).toContain(":in $ ?tag %");
    expect(TASKS_QUERY).toContain("[?n :block/tags ?t] (or [(= ?t ?tag)] (class-extends ?tag ?t))");
    expect(TASKS_QUERY).toContain("[?b :block/refs ?n] [?b :block/tags :logseq.class/Task]");
    expect(TASKS_QUERY).toContain("{:block/refs [:db/id]}");
    expect(TASKS_QUERY).not.toContain("{:block/tags");
  });

  it("asks for the tasks without waiting for the nodes (both queries in flight together)", async () => {
    const { dq, calls } = fakeDq();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = async (q: string, ...i: unknown[]) => (q === nodesQuery(tags) ? (await gate, dq(q, ...i)) : dq(q, ...i));
    const done = loadNodesAndTasks(held, tags, tag("Project"), { childTags: true, zone: west5 });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.map((c) => c.query)).toContain(TASKS_QUERY);
    release();
    expect((await done).tasks).toHaveLength(5);
  });

  it("an empty tag has no nodes and no tasks", async () => {
    const { dq } = fakeDq();
    expect(await loadNodesAndTasks(dq, tags, tag("Page"), { childTags: true, zone: west5 })).toEqual({ nodes: [], tasks: [] });
  });
});

describe("loadTitles (titles of linked nodes that are not loaded)", () => {
  const SITE = "6a000000-0000-4000-8000-000000000001";

  it("sends no query when nothing is missing", async () => {
    const sent: unknown[] = [];
    expect(await loadTitles(async (...a) => (sent.push(a), []), [])).toEqual(new Map());
    expect(sent).toEqual([]);
  });

  it("one query: uuids as a collection of plain strings, compared with (str ?u); rows [uuid-string title]", async () => {
    const sent: unknown[][] = [];
    const titles = await loadTitles(async (...a) => (sent.push(a), [[SITE, "Website relaunch"]]), [SITE, "6a000000-0000-4000-8000-0000000000ff"]);
    expect(sent).toEqual([[TITLES_QUERY, [SITE, "6a000000-0000-4000-8000-0000000000ff"]]]);
    expect(TITLES_QUERY).toContain(":in $ [?s ...]");
    expect(TITLES_QUERY).toContain("[?b :block/uuid ?u] [(str ?u) ?s]");
    expect(titles).toEqual(new Map([[SITE, "Website relaunch"]]));
  });
});

describe("tag by entity id, not title (T14, F2)", () => {
  // The host EDN-reads a top-level string input: "2026 goals" arrives as 2026, "true" as a boolean, ":kw" as a keyword
  // (src/ui/test-fakes.ts `hostReadInput`), so a title input never matched these tags. Fixture tags renamed, nothing else.
  for (const title of ["2026 goals", "true", ":kw"]) {
    it(`a tag titled "${title}" loads its nodes and tasks`, async () => {
      const dq = fixtureDq({ retitle: { Project: title } });
      const renamed = await loadTagInfos(dq);
      const t = renamed.find((x) => x.title === title)!;
      const { nodes, tasks } = await loadNodesAndTasks(dq, renamed, t, { childTags: true, zone: west5 });
      expect(nodeTitles(nodes)).toEqual(["Acme rollout", "Archive cleanup", "Mobile app", "Website relaunch"]);
      expect(tasks).toHaveLength(5);
    });
  }

  it("two tags with the same title do not merge: each loads only its own nodes", async () => {
    const dq = fixtureDq({ retitle: { Meeting: "Project" } });
    const twins = await loadTagInfos(dq);
    const [project, meeting] = [tag("Project").id, tag("Meeting").id].map((id) => twins.find((x) => x.id === id)!);
    expect(meeting.title).toBe("Project");
    expect(nodeTitles((await loadNodesAndTasks(dq, twins, project, { childTags: true, zone: west5 })).nodes)).toEqual(["Acme rollout", "Archive cleanup", "Mobile app", "Website relaunch"]);
    expect(nodeTitles((await loadNodesAndTasks(dq, twins, meeting, { childTags: true, zone: west5 })).nodes)).toEqual(["Kickoff", "Late review", "Untimed meeting"]);
  });

  it("staleness is keyed on the tag id: a renamed tag re-asks neither query", async () => {
    const { dq, calls } = fakeDq();
    const prev = await readRaw(dq, tags, tag("Project"));
    const renamed = _b(
      (tagsFixture.query.detail as unknown as [Record<string, unknown>][]).map(([t]) => [t.title === "Project" ? { ...t, title: "Projects" } : t]),
      propsFixture.query.detail as unknown[],
    );
    calls.length = 0;
    const next = await readRaw(dq, renamed, renamed.find((t) => t.id === tag("Project").id)!, prev);
    expect(calls).toEqual([]);
    expect(next.nodes).toBe(prev.nodes);
    expect(next.tasks).toBe(prev.tasks);
  });
});

describe("recycled content is not loaded (T14, F4)", () => {
  // Shape observed live 2026-10-03: a page in Recycle has :logseq.property/deleted-at; its blocks have none and keep
  // :block/page → that page. Fixture rows (all seeded nodes are on page 226) plus a deleted-at on a page or a block.
  const PAGE = 226;
  const load = (recycled: Recycled, title = "Project") =>
    loadNodesAndTasks(fixtureDq({ recycled }), tags, tag(title), { childTags: true, zone: west5 });
  const byName = (title: string, rows: { title: string; id: number }[]) => rows.find((x) => x.title.startsWith(title))!.id;
  const fixtureNode = async (title: string) => byName(title, (await load({})).nodes);
  const fixtureTask = async (title: string) => byName(title, (await load({})).tasks);

  it("both queries carry the Recycle clauses: the node, the node a task links, and the task", () => {
    expect(nodesQuery(tags)).toContain(notRecycled("?b"));
    expect(TASKS_QUERY).toContain(notRecycled("?n"));
    expect(TASKS_QUERY).toContain(notRecycled("?b"));
  });

  it("a node on a recycled page is not loaded, nor are the tasks that link only such nodes", async () => {
    expect(await load({ pages: [PAGE] })).toEqual({ nodes: [], tasks: [] });
    expect((await load({ pages: [PAGE] }, "Meeting")).nodes).toEqual([]);
  });

  it("a node with deleted-at is not loaded; a task's ref to it does not count", async () => {
    const { nodes, tasks } = await load({ blocks: [await fixtureNode("Website relaunch")] });
    expect(nodeTitles(nodes)).toEqual(["Acme rollout", "Archive cleanup", "Mobile app"]);
    expect(tasks.map((t) => t.title).sort()).toEqual(["Acme contract", "Wireframes"]);
  });

  it("a task with deleted-at is not loaded", async () => {
    const { tasks } = await load({ blocks: [await fixtureTask("Wireframes")] });
    expect(tasks.map((t) => t.title.split(" [[")[0]).sort()).toEqual(["Acme contract", "Draft brief", "Ship homepage", "Survey users"]);
  });
});
