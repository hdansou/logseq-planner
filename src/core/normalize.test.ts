import { beforeAll, describe, expect, it } from "vitest";
import { buildNodes, buildTasks, EMPTY_PLACEHOLDER, isEmptyPlaceholder, journalDayToIso, localDateTime, systemZone } from "./normalize";
import { buildTagInfos } from "./schema";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import tasksFixture from "./__fixtures__/tasks.json";
import { CLASS_EXTENDS_RULES, nodesQuery, tasksQuery } from "./queries";
import { fixtureDq } from "../ui/test-fakes";

describe("journalDayToIso", () => {
  it("formats a journal-day number", () => {
    expect(journalDayToIso(20261023)).toBe("2026-10-23");
    expect(journalDayToIso(20260105)).toBe("2026-01-05");
  });
});

describe("localDateTime", () => {
  it("applies the zone offset in minutes east of UTC", () => {
    const ms = Date.UTC(2026, 9, 5, 4, 45);
    expect(localDateTime(ms, () => -300)).toEqual({ day: "2026-10-04", time: "23:45" });
    expect(localDateTime(ms, () => 0)).toEqual({ day: "2026-10-05", time: "04:45" });
    expect(localDateTime(ms, () => 60)).toEqual({ day: "2026-10-05", time: "05:45" });
  });

  it("asks the zone for the offset at that instant (DST)", () => {
    const seen: number[] = [];
    localDateTime(1234567890000, (m) => (seen.push(m), 0));
    expect(seen).toEqual([1234567890000]);
  });

  it("systemZone matches Date#getTimezoneOffset with the sign flipped", () => {
    const ms = Date.UTC(2026, 6, 1);
    expect(systemZone(ms)).toBe(-new Date(ms).getTimezoneOffset());
  });
});

describe("the empty placeholder means no value (T11 live finding)", () => {
  // Observed live on 2026-10-03 (T11 live check; not in the T01 fixtures): after removeBlockProperty on built-in Status
  // the block keeps the attribute, pointing at the entity with ident :logseq.property/empty-placeholder (no title). The
  // T01 probe saw the same entity when a uuid or ident string was written. These rows are the fixture rows with that
  // observed shape put in by hand: the one allowed exception to fixture-only data. The id is arbitrary on purpose.
  const PLACEHOLDER = { id: 4242, ident: EMPTY_PLACEHOLDER };
  let pulled: [Record<string, unknown>][] = [];
  // The #Project rows as the node pull returns them (fixture rows through the fixture fake).
  beforeAll(async () => {
    pulled = (await fixtureDq()(nodesQuery(tags), [tags.find((t) => t.title === "Project")!.id], CLASS_EXTENDS_RULES)) as [Record<string, unknown>][];
  });
  const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
  const project = tags.find((t) => t.title === "Project")!;
  const status = project.choiceProps.find((p) => p.title === "Status")!.ident;
  const ARCHIVE = "6a000000-0000-4000-8000-000000000004";
  const rowsWith = (v: unknown) => pulled.map(([n]) => [n.uuid === ARCHIVE ? { ...n, [status]: v } : n]);
  const archive = (v: unknown) => buildNodes(rowsWith(v), tags, [project], true, () => -300).find((n) => n.uuid === ARCHIVE)!;

  it("a choice value that is the placeholder entity (by ident) is no value", () => {
    expect(isEmptyPlaceholder(PLACEHOLDER)).toBe(true);
    expect(isEmptyPlaceholder({ id: 78, ident: ":logseq.property/status.doing" })).toBe(false);
    expect(isEmptyPlaceholder(null)).toBe(false);
    expect(archive(PLACEHOLDER).choices[status]).toBeUndefined();
  });

  it("a ref that is none of the property's closed values is no value (live `pull [*]` returns refs as {id} only)", () => {
    expect(archive({ id: 4242 }).choices[status]).toBeUndefined();
    expect(archive({ id: 76 }).choices[status]!.title).toBe("Backlog"); // a real closed value still maps
  });

  it("a task whose Status is the placeholder has no status", () => {
    const rows = (tasksFixture.taskRefs.detail as unknown as [Record<string, unknown>][]).map(([t]) => [{ ...t, ":logseq.property/status": PLACEHOLDER }]);
    const nodes = buildNodes(pulled, tags, [project], true, () => -300);
    const tasks = buildTasks(rows, nodes, () => -300);
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) expect(t.status).toBeNull();
  });
});

describe("dependency values (N12)", () => {
  // Hand-written minimal rows (the T01 fixtures have no node property): the shapes a plain pull of a ref attribute gives,
  // `[{id}]` for a many-valued property and `{id}` for a cardinality-one property.
  const D = ":user.property/depends_on-x";
  const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
  const project = tags.find((t) => t.title === "Project")!;
  const row = (id: number, extra: Record<string, unknown> = {}) => [{ id, uuid: `u${id}`, title: `N${id}`, tags: [{ id: project.id }], ...extra }];
  const nodes = buildNodes([row(1), row(2, { [D]: [{ id: 1 }] }), row(3, { [D]: { id: 2 } }), row(4, { [D]: [{ id: 1 }, { id: 2 }] })], tags, [project], true, () => 0, D);
  const task = (id: number, refs: number[], extra: Record<string, unknown> = {}) => [{ id, uuid: `t${id}`, title: `T${id}`, refs: refs.map((r) => ({ id: r })), ...extra }];

  it("reads many-valued ([{id}]) and single ({id}) values as node ids; no value = []", () => {
    expect(nodes.map((n) => n.dependsOn)).toEqual([[], [1], [2], [1, 2]]);
  });

  it("without a dependency property every node has dependsOn []", () => {
    const plain = buildNodes([row(2, { [D]: [{ id: 1 }] })], tags, [project], true, () => 0);
    expect(plain[0].dependsOn).toEqual([]);
  });

  it("a task does not link the nodes it depends on through the property; its other refs still link", () => {
    const tasks = buildTasks([task(10, [1, 2], { [D]: [{ id: 1 }] }), task(11, [1]), task(12, [1], { [D]: [{ id: 1 }] })], nodes, () => 0, D);
    expect(tasks.map((t) => [t.id, t.nodeIds])).toEqual([[10, [2]], [11, [1]]]);
  });

  it("with the property null (or absent on the task entity) every ref links, as before", () => {
    const rows = [task(10, [1, 2], { [D]: [{ id: 1 }] }), task(11, [1])];
    expect(buildTasks(rows, nodes, () => 0).map((t) => t.nodeIds)).toEqual([[1, 2], [1]]);
    expect(buildTasks([task(11, [1])], nodes, () => 0, D).map((t) => t.nodeIds)).toEqual([[1]]);
  });
});

describe("created day (N73)", () => {
  const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
  const project = tags.find((t) => t.title === "Project")!;
  const SITE = "6a000000-0000-4000-8000-000000000001";
  const BRIEF = "6a000000-0000-4000-8000-000000000021";

  it("a node's :block/created-at (epoch ms) is its local created day; the zone decides the day", async () => {
    // Website relaunch was created 2026-10-03T18:17Z (fixture): 13:17 in UTC-5, 00:17 the next day in UTC+6.
    const rows = (await fixtureDq()(nodesQuery(tags), [project.id], CLASS_EXTENDS_RULES)) as unknown[];
    const site = (zone: number) => buildNodes(rows, tags, [project], true, () => zone).find((n) => n.uuid === SITE)!;
    expect(site(-300).created).toBe("2026-10-03");
    expect(site(360).created).toBe("2026-10-04");
  });

  it("a task's created day comes from its own :block/created-at; a row without one has none", async () => {
    const at = Date.UTC(2026, 9, 12, 15);
    const dq = fixtureDq({ edits: new Map([[BRIEF, { "created-at": { raw: at } }]]) });
    const nodes = buildNodes((await dq(nodesQuery(tags), [project.id], CLASS_EXTENDS_RULES)) as unknown[], tags, [project], true, () => -300);
    const tasks = buildTasks((await dq(tasksQuery(null), [project.id], CLASS_EXTENDS_RULES)) as unknown[], nodes, () => -300);
    expect(tasks.find((t) => t.uuid === BRIEF)!.created).toBe("2026-10-12");
    expect(tasks.filter((t) => t.uuid !== BRIEF).every((t) => t.created === undefined)).toBe(true);
  });
});
