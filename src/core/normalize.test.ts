import { beforeAll, describe, expect, it } from "vitest";
import { buildNodes, buildTasks, EMPTY_PLACEHOLDER, isEmptyPlaceholder, journalDayToIso, localDateTime, systemZone } from "./normalize";
import { buildTagInfos } from "./schema";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import tasksFixture from "./__fixtures__/tasks.json";
import { CLASS_EXTENDS_RULES, nodesQuery } from "./queries";
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
    pulled = (await fixtureDq()(nodesQuery(tags), tags.find((t) => t.title === "Project")!.id, CLASS_EXTENDS_RULES)) as [Record<string, unknown>][];
  });
  const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
  const project = tags.find((t) => t.title === "Project")!;
  const status = project.choiceProps.find((p) => p.title === "Status")!.ident;
  const ARCHIVE = "6a000000-0000-4000-8000-000000000004";
  const rowsWith = (v: unknown) => pulled.map(([n]) => [n.uuid === ARCHIVE ? { ...n, [status]: v } : n]);
  const archive = (v: unknown) => buildNodes(rowsWith(v), tags, project, true, () => -300).find((n) => n.uuid === ARCHIVE)!;

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
    const nodes = buildNodes(pulled, tags, project, true, () => -300);
    const tasks = buildTasks(rows, nodes, () => -300);
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) expect(t.status).toBeNull();
  });
});
