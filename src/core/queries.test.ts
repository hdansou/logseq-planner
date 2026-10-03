import { describe, expect, it } from "vitest";
import nodesFixture from "./__fixtures__/nodes.json";
import tasksFixture from "./__fixtures__/tasks.json";
import datesFixture from "./__fixtures__/dates.json";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos } from "./schema";
import { loadNodes, loadTasks, NODES_QUERY, TASKS_QUERY, JOURNAL_DAYS_QUERY, CLASS_EXTENDS_RULES } from "./queries";
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
/** A fake `dq` that answers each known query from the T01 fixtures and records the calls. */
function fakeDq() {
  const calls: Call[] = [];
  const dq = async (query: string, ...inputs: unknown[]) => {
    calls.push({ query, inputs });
    if (query === NODES_QUERY) {
      const title = inputs[0];
      return title === "Project" ? nodesFixture.projectWithExtends.detail : title === "Meeting" ? nodesFixture.meeting.detail : [];
    }
    if (query === JOURNAL_DAYS_QUERY) return datesFixture.date.detail as unknown[];
    if (query === TASKS_QUERY) return tasksFixture.taskRefs.detail as unknown[];
    throw new Error(`unexpected query ${query}`);
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

  it("skips the date query when no node has a Date value", async () => {
    const { dq, calls } = fakeDq();
    await loadNodes(dq, tags, tag("Meeting"), { childTags: true, zone: west5 });
    expect(calls.some((c) => c.query === JOURNAL_DAYS_QUERY)).toBe(false);
  });

  it("fails fast when a Date value's journal page is unknown", async () => {
    const dq = async (query: string) => (query === JOURNAL_DAYS_QUERY ? [] : (nodesFixture.projectWithExtends.detail as unknown[]));
    await expect(loadNodes(dq, tags, tag("Project"), { childTags: true, zone: west5 })).rejects.toThrow(/journal/);
  });
});

describe("loadTasks", () => {
  const load = async () => {
    const { dq } = fakeDq();
    const nodes = await loadNodes(dq, tags, tag("Project"), { childTags: true, zone: west5 });
    return { nodes, tasks: await loadTasks(dq, nodes, west5) };
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

  it("sends no query when there are no nodes", async () => {
    const { dq, calls } = fakeDq();
    expect(await loadTasks(dq, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
