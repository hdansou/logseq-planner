import { describe, expect, it } from "vitest";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos } from "./schema";
import { loadNodes, loadNodesAndTasks, loadTitles, nodePropIdents, nodesQuery, TASKS_QUERY, TITLES_QUERY, CLASS_EXTENDS_RULES } from "./queries";
import { fixtureDq } from "../ui/test-fakes";
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
  it("sends the tag title and the extends rules last", async () => {
    const { dq, calls } = fakeDq();
    await loadNodes(dq, tags, tag("Project"), { childTags: true, zone: west5 });
    expect(calls[0].inputs).toEqual(["Project", CLASS_EXTENDS_RULES]);
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

  it("keeps the extends rule join of the node query", () => {
    expect(nodesQuery(tags)).toContain(":in $ ?tag-title %");
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

  it("the task query is bound to the tag's nodes (tag title + extends rules) and pulls no nested tags or ref titles (T13a)", async () => {
    const { dq, calls } = fakeDq();
    await loadNodesAndTasks(dq, tags, tag("Project"), { childTags: true, zone: west5 });
    const call = calls.find((c) => c.query === TASKS_QUERY)!;
    expect(call.inputs).toEqual(["Project", CLASS_EXTENDS_RULES]);
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
