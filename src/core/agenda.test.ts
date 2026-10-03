import { describe, expect, it } from "vitest";
import { loadTagInfos } from "./schema";
import { loadNodes, loadTasks } from "./queries";
import { titlesByUuid } from "./display-title";
import { viewItems } from "./layout-common";
import { HORIZON_DAYS, layoutAgenda, type AgendaInput, type AgendaLayout } from "./agenda";
import { fixtureDq } from "../ui/test-fakes";
import type { LocalDate, PlannerNode, PlannerTask, TagInfo } from "../types";

const dq = fixtureDq();
const tags = await loadTagInfos(dq);
const tag = (title: string): TagInfo => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
const west5 = () => -300;
const TODAY = "2026-10-03"; // a Saturday
const d = (day: string, time: string | null = null): LocalDate => ({ day, time });
const dateIdent = (t: TagInfo, title: string) => t.dateProps.find((p) => p.title === title)!.ident;
const choiceProp = (t: TagInfo, title: string) => t.choiceProps.find((p) => p.title === title)!;
const statusValues = tags.flatMap((t) => t.choiceProps).find((p) => p.ident === ":logseq.property/status")!.values;
const statusOf = (title: string) => choiceProp(tag("Project"), "Status").values.find((v) => v.title === title)!;
const ownerOf = (title: string) => choiceProp(tag("Project"), "Owner").values.find((v) => v.title === title)!;
const taskStatus = (title: string) => {
  const v = statusValues.find((x) => x.title === title)!;
  return { ident: v.ident!, title: v.title };
};

/** The fixture nodes of `tagTitle` with the tag's default Start/End (Meeting: Date only), laid out for today. */
async function layout(tagTitle: string, over: Partial<AgendaInput> = {}): Promise<AgendaLayout> {
  const t = tag(tagTitle);
  const nodes = await loadNodes(dq, tags, t, { childTags: true, zone: west5 });
  const tasks = await loadTasks(dq, nodes, west5);
  const start = t.dateProps.find((p) => p.title === "Start" || p.title === "Date")!.ident;
  const end = t.dateProps.find((p) => p.title === "End")?.ident ?? null;
  return layoutAgenda({
    items: viewItems(nodes, tasks, start, end, statusValues), groupBy: "date", showDone: false, today: TODAY, statusValues,
    choiceProps: t.choiceProps, doneValues: {}, titles: titlesByUuid(nodes), ...over,
  });
}

/** Synthetic Project nodes: [title, start, end|null, status?]; optional tasks. */
function synthetic(spec: [string, string | null, string | null, string?][], over: Partial<AgendaInput> = {}, tasks: PlannerTask[] = []) {
  const p = tag("Project");
  const s = dateIdent(p, "Start");
  const e = dateIdent(p, "End");
  const status = choiceProp(p, "Status");
  const nodes: PlannerNode[] = spec.map(([title, start, end, st], i) => ({
    id: i + 1, uuid: `00000000-0000-4000-8000-00000000000${i + 1}`, title, tagIds: [],
    dates: { ...(start ? { [s]: d(start) } : {}), ...(end ? { [e]: d(end) } : {}) },
    choices: st ? { [status.ident]: statusOf(st) } : {},
  }));
  return layoutAgenda({
    items: viewItems(nodes, tasks, s, e, statusValues), groupBy: "date", showDone: false, today: TODAY, statusValues,
    choiceProps: p.choiceProps, doneValues: {}, titles: titlesByUuid(nodes), ...over,
  });
}

const task = (id: number, nodeId: number, title: string, status: string | null, deadline: LocalDate | null, scheduled: LocalDate | null = null): PlannerTask => ({
  id, uuid: `t${id}`, title, status: status ? taskStatus(status) : null, nodeIds: [nodeId], deadline, scheduled,
});

const keys = (l: AgendaLayout) => l.buckets.map((b) => b.key);
const titles = (l: AgendaLayout, key: string) => l.buckets.find((b) => b.key === key)?.entries.map((e) => e.title) ?? null;
const entry = (l: AgendaLayout, key: string, title: string) => l.buckets.find((b) => b.key === key)!.entries.find((e) => e.title === title)!;

describe("buckets around today (Saturday 2026-10-03)", () => {
  it("files an open node by its end: yesterday overdue, today, +1, +14 inside the horizon, +15 later", () => {
    expect(HORIZON_DAYS).toBe(14);
    const l = synthetic([
      ["Yesterday", "2026-10-02", "2026-10-02", "Doing"], ["Today", "2026-10-03", "2026-10-03", "Doing"],
      ["Plus1", "2026-10-04", "2026-10-04", "Doing"], ["Plus14", "2026-10-17", "2026-10-17", "Doing"],
      ["Plus15", "2026-10-18", "2026-10-18", "Doing"],
    ]);
    expect(keys(l)).toEqual(["overdue", "today", "2026-10-04", "2026-10-17", "later"]);
    expect(titles(l, "overdue")).toEqual(["Yesterday"]);
    expect(titles(l, "today")).toEqual(["Today"]);
    expect(titles(l, "2026-10-04")).toEqual(["Plus1"]);
    expect(titles(l, "2026-10-17")).toEqual(["Plus14"]);
    expect(titles(l, "later")).toEqual(["Plus15"]);
  });

  it("labels the buckets: Overdue, Today with the date, Tomorrow, weekday dates, Later than 14 days", () => {
    const l = synthetic([
      ["a", "2026-10-02", "2026-10-02", "Doing"], ["b", "2026-10-03", "2026-10-03", "Doing"], ["c", "2026-10-04", "2026-10-04", "Doing"],
      ["d", "2026-10-05", "2026-10-05", "Doing"], ["e", "2026-10-30", "2026-10-30", "Doing"], ["f", null, null, "Doing"],
    ]);
    expect(l.buckets.map((b) => b.label)).toEqual([
      "Overdue", "Today · Sat 3 Oct", "Tomorrow · Sun 4 Oct", "Mon 5 Oct", "Later than 14 days", "No date",
    ]);
  });

  it("a span that covers today is filed under Today, one that ended is overdue, one that starts later waits for its start", () => {
    const l = synthetic([
      ["Running", "2026-09-23", "2026-10-23", "Doing"], ["Ended", "2026-09-20", "2026-10-02", "Doing"],
      ["Starts soon", "2026-10-08", "2026-10-30", "Todo"],
    ]);
    expect(titles(l, "today")).toEqual(["Running"]);
    expect(titles(l, "overdue")).toEqual(["Ended"]);
    expect(titles(l, "2026-10-08")).toEqual(["Starts soon"]);
  });

  it("a node with no date at all is listed under No date; empty buckets are not rendered", () => {
    const l = synthetic([["Undated", null, null, "Doing"]]);
    expect(keys(l)).toEqual(["none"]);
    expect(l.buckets[0]).toMatchObject({ label: "No date", collapsed: true });
  });

  it("orders the buckets overdue, today, the days, later, no date, earlier; Later, No date and Earlier start collapsed", () => {
    const l = synthetic([
      ["m", "2026-09-25", "2026-09-25", "Done"], ["n", null, null, "Todo"], ["o", "2026-12-01", "2026-12-01", "Todo"],
      ["p", "2026-10-06", "2026-10-06", "Todo"], ["q", "2026-10-03", "2026-10-03", "Todo"], ["r", "2026-09-30", "2026-09-30", "Todo"],
    ], { showDone: true });
    expect(keys(l)).toEqual(["overdue", "today", "2026-10-06", "later", "none", "earlier"]);
    expect(l.buckets.map((b) => b.collapsed)).toEqual([false, false, false, true, true, true]);
  });
});

describe("what an entry is filed under", () => {
  it("a task by its deadline, else its scheduled day; both dates make it a span that runs from scheduled to deadline", () => {
    const tasks = [
      task(1, 1, "Deadline only", "Todo", d("2026-10-05", "17:00")), task(2, 1, "Scheduled only", "Todo", null, d("2026-10-09", "09:00")),
      task(3, 1, "Running", "Doing", d("2026-10-06"), d("2026-10-01")), task(4, 1, "Dateless", "Todo", null),
    ];
    const l = synthetic([["P", "2026-09-01", "2026-12-01", "Doing"]], {}, tasks);
    expect(titles(l, "2026-10-05")).toEqual(["Deadline only"]);
    expect(titles(l, "2026-10-09")).toEqual(["Scheduled only"]);
    expect(titles(l, "today")).toContain("Running");
    expect(titles(l, "none")).toEqual(["Dateless"]);
  });

  it("a node with no Start or End but dated tasks is derived: its tasks are listed, the node itself is not", () => {
    const l = synthetic([["Derived", null, null, "Doing"]], {}, [task(1, 1, "Only task", "Todo", d("2026-10-06"))]);
    expect(keys(l)).toEqual(["2026-10-06"]);
    expect(titles(l, "2026-10-06")).toEqual(["Only task"]);
  });

  it("a task linked to two nodes appears once, under the first", () => {
    const t = { ...task(1, 1, "Shared", "Todo", d("2026-10-06")), nodeIds: [1, 2] };
    const l = synthetic([["A", "2026-10-06", "2026-10-06", "Doing"], ["B", "2026-10-06", "2026-10-06", "Doing"]], {}, [t]);
    expect(l.buckets[0].entries.filter((e) => e.title === "Shared")).toHaveLength(1);
    expect(entry(l, "2026-10-06", "Shared").node).toBe("A");
  });

  it("resolves inline [[uuid]] refs in task titles to the node's title", () => {
    const l = synthetic([["Site", "2026-10-06", "2026-10-06", "Doing"]], {}, [task(1, 1, "Draft [[00000000-0000-4000-8000-000000000001]]", "Todo", d("2026-10-06"))]);
    expect(titles(l, "2026-10-06")).toEqual(["Draft Site", "Site"]);
  });
});

describe("done and canceled", () => {
  const withTasks = (showDone: boolean) => synthetic(
    [["Open", "2026-10-06", "2026-10-06", "Doing"], ["Closed", "2026-10-06", "2026-10-06", "Done"], ["Dropped", "2026-10-06", "2026-10-06", "Canceled"]],
    { showDone },
    [task(1, 1, "Done task", "Done", d("2026-10-07")), task(2, 1, "Canceled task", "Canceled", d("2026-10-07")), task(3, 1, "Open task", "Todo", d("2026-10-07"))],
  );

  it("hides done and canceled nodes and tasks by default", () => {
    const l = withTasks(false);
    expect(titles(l, "2026-10-06")).toEqual(["Open"]);
    expect(titles(l, "2026-10-07")).toEqual(["Open task"]);
  });

  it("Show done reveals them, flagged done, in their own buckets", () => {
    const l = withTasks(true);
    expect(titles(l, "2026-10-06")).toEqual(["Closed", "Dropped", "Open"]);
    expect(entry(l, "2026-10-06", "Closed").done).toBe(true);
    expect(entry(l, "2026-10-06", "Open").done).toBe(false);
    expect(titles(l, "2026-10-07")).toEqual(["Canceled task", "Done task", "Open task"]);
    expect(entry(l, "2026-10-07", "Canceled task")).toMatchObject({ done: true, status: "canceled" });
    expect(entry(l, "2026-10-07", "Done task")).toMatchObject({ done: true, status: "done" });
  });

  it("a done entry is never overdue: past ones go to Earlier (14 days back at most), undated ones to No date", () => {
    const l = synthetic(
      [["Old", "2026-10-01", "2026-10-01", "Done"], ["Ancient", "2026-08-01", "2026-08-01", "Done"], ["Undated done", null, null, "Done"], ["Late", "2026-10-01", "2026-10-01", "Doing"]],
      { showDone: true },
    );
    expect(titles(l, "overdue")).toEqual(["Late"]);
    expect(titles(l, "earlier")).toEqual(["Old"]);
    expect(titles(l, "none")).toEqual(["Undated done"]);
  });

  it("a done entry beyond the 14-day horizon stays out of Later", () => {
    const l = synthetic([["Far done", "2026-11-20", "2026-11-20", "Done"], ["Far open", "2026-11-20", "2026-11-20", "Todo"]], { showDone: true });
    expect(titles(l, "later")).toEqual(["Far open"]);
  });

  it("a user choice property's done override (a uuid list) decides which nodes are done", () => {
    // Owner has no done notion by default; saying Alice counts as done hides both of Alice's projects (Website relaunch, Acme rollout).
    const owner = choiceProp(tag("Project"), "Owner");
    return layout("Project", { doneValues: { [owner.ident]: [ownerOf("Alice").uuid] } }).then(async (l) => {
      const all = l.buckets.flatMap((b) => b.entries).filter((e) => e.kind === "node").map((e) => e.title);
      expect(all).toEqual(["Mobile app", "Archive cleanup"]);
      const shown = await layout("Project", { doneValues: { [owner.ident]: [ownerOf("Alice").uuid] }, showDone: true });
      expect(entry(shown, "today", "Website relaunch").done).toBe(true);
    });
  });

  it("an override that no longer lists Done makes Done nodes open again", () => {
    const status = choiceProp(tag("Project"), "Status");
    const l = synthetic([["Closed", "2026-10-06", "2026-10-06", "Done"]], { doneValues: { [status.ident]: [] } });
    expect(titles(l, "2026-10-06")).toEqual(["Closed"]);
  });
});

describe("overdue and late", () => {
  it("an open node or task whose end passed is overdue and late, with how long", () => {
    const l = synthetic([["Ended", "2026-09-20", "2026-09-30", "Doing"]], {}, [task(1, 1, "Contract", "Todo", d("2026-10-02", "12:00"))]);
    expect(entry(l, "overdue", "Contract")).toMatchObject({ late: true, kind: "task" });
    expect(entry(l, "overdue", "Contract").when).toBe("due 2 Oct 12:00, 1 day late");
    expect(entry(l, "overdue", "Ended")).toMatchObject({ late: true, kind: "node" });
    expect(entry(l, "overdue", "Ended").when).toBe("20 Sep – 30 Sep, 3 days late");
  });

  it("an open entry that is not past is not late", () => {
    const l = synthetic([["P", "2026-10-06", "2026-10-06", "Doing"]], {}, [task(1, 1, "Soon", "Todo", d("2026-10-05", "17:00"))]);
    expect(entry(l, "2026-10-05", "Soon").late).toBe(false);
    expect(entry(l, "2026-10-05", "Soon").when).toBe("due 5 Oct 17:00");
  });

  it("a node of a tag with no done notion (meetings) is never overdue: past ones are filed under Earlier", () => {
    const type = tag("Meeting").choiceProps.find((p) => p.title === "Type")!;
    const dateIdentM = dateIdent(tag("Meeting"), "Date");
    const nodes: PlannerNode[] = [{ id: 1, uuid: "m1", title: "Retro", tagIds: [], dates: { [dateIdentM]: d("2026-10-01", "10:00") }, choices: { [type.ident]: type.values[0] } }];
    const l = layoutAgenda({
      items: viewItems(nodes, [], dateIdentM, null, statusValues), groupBy: "date", showDone: false, today: TODAY, statusValues,
      choiceProps: tag("Meeting").choiceProps, doneValues: {}, titles: titlesByUuid(nodes),
    });
    expect(keys(l)).toEqual(["earlier"]);
    expect(l.buckets[0].entries[0]).toMatchObject({ late: false, when: "1 Oct 10:00" });
  });
});

describe("order within a bucket", () => {
  it("sorts by date, then time (untimed first), then title", () => {
    const tasks = [
      task(1, 1, "Late afternoon", "Todo", d("2026-10-06", "17:00")), task(2, 1, "Morning", "Todo", d("2026-10-06", "09:00")),
      task(3, 1, "Untimed B", "Todo", d("2026-10-06")), task(4, 1, "Untimed A", "Todo", d("2026-10-06")),
      task(5, 1, "Yesterday", "Todo", d("2026-10-02", "08:00")), task(6, 1, "Two days ago", "Todo", d("2026-10-01", "18:00")),
    ];
    const l = synthetic([["P", "2026-09-01", "2026-12-01", "Doing"]], {}, tasks);
    expect(titles(l, "2026-10-06")).toEqual(["Untimed A", "Untimed B", "Morning", "Late afternoon"]);
    expect(titles(l, "overdue")).toEqual(["Two days ago", "Yesterday"]);
  });

  it("in Today untimed entries (a running span, a date) come before timed ones", () => {
    const l = synthetic([["Running", "2026-09-23", "2026-10-23", "Doing"], ["Standup", "2026-10-03", "2026-10-03", "Doing"]],
      {}, [task(1, 2, "Call", "Todo", d("2026-10-03", "09:00"))]);
    expect(titles(l, "today")).toEqual(["Running", "Standup", "Call"]);
  });
});

describe("empty", () => {
  it("is true with no entries at all, and says so for both groupings", () => {
    expect(synthetic([]).empty).toBe(true);
    expect(synthetic([], { groupBy: "node" }).empty).toBe(true);
    expect(synthetic([["Closed", "2026-10-06", "2026-10-06", "Done"]]).empty).toBe(true);
    expect(synthetic([["Closed", "2026-10-06", "2026-10-06", "Done"]], { showDone: true }).empty).toBe(false);
  });
});

describe("the T01 seed, #Project, group by date", () => {
  it("Show done off: the open entries in their buckets", async () => {
    const l = await layout("Project");
    expect(keys(l)).toEqual(["overdue", "today", "2026-10-05", "2026-10-08", "2026-10-09", "none"]);
    expect(titles(l, "overdue")).toEqual(["Acme contract"]);
    expect(titles(l, "today")).toEqual(["Acme rollout", "Website relaunch"]);
    expect(titles(l, "2026-10-05")).toEqual(["Draft brief Website relaunch"]);
    expect(titles(l, "2026-10-08")).toEqual(["Mobile app"]);
    expect(titles(l, "2026-10-09")).toEqual(["Wireframes"]);
    expect(titles(l, "none")).toEqual(["Archive cleanup"]);
    expect(entry(l, "overdue", "Acme contract")).toMatchObject({ late: true, node: "Acme rollout", status: "todo" });
  });

  it("Show done on: the done and canceled tasks join No date", async () => {
    const l = await layout("Project", { showDone: true });
    expect(titles(l, "none")).toEqual(["Archive cleanup", "Ship homepage Website relaunch", "Survey users Website relaunch"]);
    expect(entry(l, "none", "Ship homepage Website relaunch")).toMatchObject({ done: true, status: "done" });
    expect(entry(l, "none", "Survey users Website relaunch")).toMatchObject({ done: true, status: "canceled" });
    expect(keys(l)).toEqual(["overdue", "today", "2026-10-05", "2026-10-08", "2026-10-09", "none"]);
  });
});

describe("the T01 seed, #Meeting", () => {
  it("files Kickoff under Today with its time, Late review tomorrow, the untimed one under No date", async () => {
    const l = await layout("Meeting");
    expect(keys(l)).toEqual(["today", "2026-10-04", "none"]);
    expect(entry(l, "today", "Kickoff").when).toBe("3 Oct 10:30");
    expect(titles(l, "2026-10-04")).toEqual(["Late review"]);
    expect(entry(l, "2026-10-04", "Late review").when).toBe("4 Oct 23:45");
    expect(titles(l, "none")).toEqual(["Untimed meeting"]);
  });
});

describe("group by node", () => {
  it("one group per node, its own dated line and its tasks underneath; overdue groups first, undated last", async () => {
    const l = await layout("Project", { groupBy: "node" });
    expect(l.groups.map((g) => g.node.title)).toEqual(["Acme rollout", "Website relaunch", "Mobile app", "Archive cleanup"]);
    const site = l.groups.find((g) => g.node.title === "Website relaunch")!;
    expect(site.node.when).toBe("23 Sep – 23 Oct");
    expect(site.tasks.map((t) => t.title)).toEqual(["Draft brief Website relaunch"]);
    expect(site.progress).toEqual({ done: 1, total: 2 });
    expect(site.open).toBe(1);
    expect(l.groups[0].tasks.map((t) => [t.title, t.bucket, t.late])).toEqual([["Acme contract", "overdue", true]]);
    expect(l.groups[3]).toMatchObject({ tasks: [] });
    expect(l.groups[3].node.bucket).toBe("none");
    expect(l.empty).toBe(false);
  });

  it("carries the node's choice values for the header (Status, Owner)", async () => {
    const l = await layout("Project", { groupBy: "node" });
    expect(l.groups.find((g) => g.node.title === "Website relaunch")!.meta).toEqual(["Doing", "Alice"]);
  });

  it("hides a done node with no visible task, until Show done", () => {
    const spec: [string, string | null, string | null, string?][] = [["Closed", "2026-10-06", "2026-10-06", "Done"], ["Open", null, null, "Doing"]];
    expect(synthetic(spec, { groupBy: "node" }).groups.map((g) => g.node.title)).toEqual(["Open"]);
    expect(synthetic(spec, { groupBy: "node", showDone: true }).groups.map((g) => g.node.title)).toEqual(["Closed", "Open"]);
  });

  it("Show done adds the done and canceled tasks to their node", async () => {
    const on = await layout("Project", { groupBy: "node", showDone: true });
    const site = on.groups.find((g) => g.node.title === "Website relaunch")!;
    expect(site.tasks.map((t) => t.title)).toEqual(["Draft brief Website relaunch", "Ship homepage Website relaunch", "Survey users Website relaunch"]);
  });

  it("a done node that still has an open task keeps its group, flagged done (the task is not hidden with it)", async () => {
    const owner = choiceProp(tag("Project"), "Owner");
    const l = await layout("Project", { groupBy: "node", doneValues: { [owner.ident]: [ownerOf("Alice").uuid] } });
    expect(l.groups.map((g) => g.node.title)).toEqual(["Acme rollout", "Website relaunch", "Mobile app", "Archive cleanup"]);
    expect(l.groups[0].node.done).toBe(true);
    expect(l.groups[2].node.done).toBe(false);
  });
});
