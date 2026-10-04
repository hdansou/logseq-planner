import { describe, expect, it, vi } from "vitest";
import type { DateProp, DateWriteDeps, LocalDate } from "../types";
import { localDateTime } from "./normalize";
import { dateChanges, editedNode, editedSpan, epochOf, journalArg, shiftDate, writeDates, type DateChange, type SpanEdit } from "./date-edit";

const d = (day: string, time: string | null = null): LocalDate => ({ day, time });
const START: DateProp = { id: 1, ident: ":user.property/start-x", title: "Start", type: "datetime" };
const END: DateProp = { id: 2, ident: ":user.property/end-x", title: "End", type: "datetime" };
const DSTART: DateProp = { ...START, type: "date" };
const DEND: DateProp = { ...END, type: "date" };

/** US Eastern in 2026: UTC−4 until 1 Nov 06:00 UTC, then UTC−5 (fall back); UTC−5 before 8 Mar 07:00 UTC (spring forward). */
const eastern = (ms: number) => (ms >= Date.UTC(2026, 10, 1, 6) || ms < Date.UTC(2026, 2, 8, 7) ? -300 : -240);

describe("shiftDate (N06c)", () => {
  it("day tracks: a Date moves by calendar days, across a month and a year end", () => {
    expect(shiftDate(d("2026-10-30"), "date", 3, 1)).toEqual(d("2026-11-02"));
    expect(shiftDate(d("2026-03-01"), "date", -1, 1)).toEqual(d("2026-02-28"));
    expect(shiftDate(d("2026-12-31"), "date", 1, 1)).toEqual(d("2027-01-01"));
  });

  it("day tracks: a DateTime keeps its time of day, across a month end and a DST change", () => {
    expect(shiftDate(d("2026-10-31", "10:30"), "datetime", 2, 1)).toEqual(d("2026-11-02", "10:30"));
    expect(shiftDate(d("2026-03-07", "23:45"), "datetime", 1, 1)).toEqual(d("2026-03-08", "23:45"));
  });

  it("Day zoom: a DateTime moves by 15-minute steps, carrying into the next or previous day", () => {
    expect(shiftDate(d("2026-10-03", "10:00"), "datetime", 3, 96)).toEqual(d("2026-10-03", "10:45"));
    expect(shiftDate(d("2026-10-31", "23:30"), "datetime", 4, 96)).toEqual(d("2026-11-01", "00:30"));
    expect(shiftDate(d("2026-11-01", "00:10"), "datetime", -1, 96)).toEqual(d("2026-10-31", "23:55"));
  });

  it("Day zoom: a Date cannot move by minutes (fails fast)", () => {
    expect(() => shiftDate(d("2026-10-03"), "date", 1, 96)).toThrow(/Date/);
  });
});

describe("epochOf: a local date and time → epoch ms in the zone, the inverse of the read", () => {
  it("round-trips through localDateTime on both sides of a DST change", () => {
    for (const x of [d("2026-10-31", "10:30"), d("2026-11-01", "10:30"), d("2026-11-02", "00:00"), d("2026-03-08", "12:00"), d("2026-03-07", "23:45")]) {
      expect(localDateTime(epochOf(x, eastern), eastern)).toEqual(x);
    }
    expect(epochOf(d("2026-11-01", "10:30"), eastern)).toBe(Date.UTC(2026, 10, 1, 15, 30));
    expect(epochOf(d("2026-10-31", "10:30"), eastern)).toBe(Date.UTC(2026, 9, 31, 14, 30));
  });

  it("a move by a day over the fall-back night keeps 10:30 local: 25 hours later in epoch ms", () => {
    const before = epochOf(d("2026-10-31", "10:30"), eastern);
    const after = epochOf(shiftDate(d("2026-10-31", "10:30"), "datetime", 1, 1), eastern);
    expect(after - before).toBe(25 * 3_600_000);
  });

  it("a Date value has no time: fails fast", () => {
    expect(() => epochOf(d("2026-10-03"), eastern)).toThrow(/time/);
  });
});

describe("journalArg", () => {
  it("is local noon, so the host does not land on the previous day west of UTC (write probe)", () => {
    expect(journalArg("2026-12-01")).toBe("2026-12-01T12:00:00");
  });
});

const span = (start: LocalDate, end: LocalDate) => ({ start, end });
const bar = (over: Partial<SpanEdit> = {}): SpanEdit => ({ start: START, end: END, point: false, move: true, resizeStart: true, resizeEnd: true, ...over });

describe("dateChanges and editedSpan", () => {
  const s = span(d("2026-10-05", "09:00"), d("2026-10-09", "17:00"));

  it("move shifts both ends; resize shifts one end", () => {
    expect(dateChanges(bar(), s, "move", 2, 1)).toEqual([
      { prop: START, previous: s.start, next: d("2026-10-07", "09:00") },
      { prop: END, previous: s.end, next: d("2026-10-11", "17:00") },
    ]);
    expect(dateChanges(bar(), s, "start", -1, 1)).toEqual([{ prop: START, previous: s.start, next: d("2026-10-04", "09:00") }]);
    expect(dateChanges(bar(), s, "end", 4, 96)).toEqual([{ prop: END, previous: s.end, next: d("2026-10-09", "18:00") }]);
  });

  it("no change for a zero delta; a gesture the span does not allow fails fast", () => {
    expect(dateChanges(bar(), s, "move", 0, 1)).toEqual([]);
    expect(() => dateChanges(bar({ resizeStart: false }), s, "start", 1, 1)).toThrow(/start/);
    expect(() => dateChanges(bar({ move: false }), s, "move", 1, 1)).toThrow(/move/);
  });

  it("a point moves its one date, mapped as Start or as End; its span is that date on both ends", () => {
    const p = span(d("2026-10-05"), d("2026-10-05"));
    const viaEnd: SpanEdit = { start: null, end: DEND, point: true, move: true, resizeStart: false, resizeEnd: false };
    const changes = dateChanges(viaEnd, p, "move", 1, 1);
    expect(changes).toEqual([{ prop: DEND, previous: p.end, next: d("2026-10-06") }]);
    expect(editedSpan(viaEnd, p, changes)).toEqual(span(d("2026-10-06"), d("2026-10-06")));
    const viaStart: SpanEdit = { ...viaEnd, start: DSTART, end: null };
    expect(editedSpan(viaStart, p, dateChanges(viaStart, p, "move", -2, 1))).toEqual(span(d("2026-10-03"), d("2026-10-03")));
  });

  it("editedSpan applies a resize to its end only", () => {
    expect(editedSpan(bar(), s, dateChanges(bar(), s, "end", 1, 1))).toEqual(span(s.start, d("2026-10-10", "17:00")));
  });

  it("editedNode: the node with the new values, for the optimistic render", () => {
    const node = { id: 1, uuid: "u", title: "T", tagIds: [], tag: ":user.class/X", dates: { [START.ident]: s.start, [END.ident]: s.end }, choices: {}, dependsOn: [], links: [] };
    const moved = editedNode(node, dateChanges(bar(), s, "end", 1, 1));
    expect(moved.dates).toEqual({ [START.ident]: s.start, [END.ident]: d("2026-10-10", "17:00") });
    expect(node.dates[END.ident]).toEqual(s.end); // not mutated
  });
});

// ---------------------------------------------------------------- writes

const NODE = { uuid: "6a000000-0000-4000-8000-000000000001", title: "Website relaunch" };
const UTC = () => 0;

/** A fake graph for date writes: values by ident (epoch ms, or a journal page `{id, journalDay}`); pages by day. */
function fakeDates(opts: { failOn?: (key: string, value: number, n: number) => boolean } = {}) {
  const values = new Map<string, number | { id: number; journalDay: number }>();
  const pages = new Map<number, number>([[100, 20261005]]);
  const calls: unknown[][] = [];
  let n = 0;
  const deps: DateWriteDeps = {
    upsertBlockProperty: vi.fn(async (uuid: string, key: string, value: number) => {
      calls.push(["upsertBlockProperty", uuid, key, value]);
      n++;
      if (opts.failOn?.(key, value, n)) return null; // resolves null and writes nothing, like a failed host call
      values.set(`:${key}`, pages.has(value) ? { id: value, journalDay: pages.get(value)! } : value);
      return null;
    }),
    createJournalPage: vi.fn(async (date: string) => {
      calls.push(["createJournalPage", date]);
      const day = Number(date.slice(0, 10).replace(/-/g, ""));
      const found = [...pages].find(([, jd]) => jd === day);
      if (found) return { id: found[0] };
      const id = 100 + pages.size;
      pages.set(id, day);
      return { id };
    }),
    readDate: vi.fn(async (_uuid: string, ident: string) => values.get(ident) ?? null),
  };
  return { deps, values, calls };
}

describe("writeDates (N06c)", () => {
  const s = span(d("2026-10-05", "09:00"), d("2026-10-09", "17:00"));

  it("DateTime: upsertBlockProperty with the full ident without its colon and epoch ms, then reads it back", async () => {
    const g = fakeDates();
    await writeDates(g.deps, NODE, dateChanges(bar(), s, "move", 1, 1), UTC);
    expect(g.calls).toEqual([
      ["upsertBlockProperty", NODE.uuid, "user.property/start-x", Date.UTC(2026, 9, 6, 9)],
      ["upsertBlockProperty", NODE.uuid, "user.property/end-x", Date.UTC(2026, 9, 10, 17)],
    ]);
    expect(g.deps.readDate).toHaveBeenCalledWith(NODE.uuid, START.ident, "datetime");
    expect(g.values.get(END.ident)).toBe(Date.UTC(2026, 9, 10, 17));
  });

  it("Date: the day's journal page at local noon, then its db id as the value; read back by page and day", async () => {
    const g = fakeDates();
    const ds = span(d("2026-10-05"), d("2026-11-30"));
    await writeDates(g.deps, NODE, dateChanges(bar({ start: DSTART, end: DEND }), ds, "end", 1, 1), UTC);
    expect(g.calls).toEqual([["createJournalPage", "2026-12-01T12:00:00"], ["upsertBlockProperty", NODE.uuid, "user.property/end-x", 101]]);
    expect(g.deps.readDate).toHaveBeenCalledWith(NODE.uuid, DEND.ident, "date");
    expect(g.values.get(DEND.ident)).toEqual({ id: 101, journalDay: 20261201 });
  });

  it("a read-back that differs throws, saying the timeline shows the graph", async () => {
    const g = fakeDates({ failOn: () => true });
    await expect(writeDates(g.deps, NODE, dateChanges(bar(), s, "start", 1, 1), UTC))
      .rejects.toThrow('Start of "Website relaunch" was not saved as 6 Oct 09:00 (read back differs). The timeline shows what the graph holds.');
  });

  it("a Date read back on another journal day throws (the host's previous-day page west of UTC)", async () => {
    const g = fakeDates();
    g.deps.readDate = vi.fn(async () => ({ id: 101, journalDay: 20261130 }));
    const ds = span(d("2026-10-05"), d("2026-11-30"));
    await expect(writeDates(g.deps, NODE, dateChanges(bar({ start: DSTART, end: DEND }), ds, "end", 1, 1), UTC)).rejects.toThrow(/End .* not saved as 1 Dec/);
  });

  it("no journal page from the host throws", async () => {
    const g = fakeDates();
    g.deps.createJournalPage = vi.fn(async () => null);
    await expect(writeDates(g.deps, NODE, dateChanges(bar({ start: DSTART, end: DEND }), span(d("2026-10-05"), d("2026-10-06")), "end", 1, 1), UTC))
      .rejects.toThrow(/journal page for 7 Oct 2026/);
  });

  it("the second write failing puts the first back to its previous value, and says so", async () => {
    const g = fakeDates({ failOn: (key, _v, n) => key === "user.property/end-x" && n === 2 });
    await expect(writeDates(g.deps, NODE, dateChanges(bar(), s, "move", 1, 1), UTC))
      .rejects.toThrow('End of "Website relaunch" was not saved as 10 Oct 17:00 (read back differs). Start was put back to 5 Oct 09:00, so the bar has not moved.');
    expect(g.values.get(START.ident)).toBe(Date.UTC(2026, 9, 5, 9));
  });

  it("when putting the first back fails too, the error says so", async () => {
    const g = fakeDates({ failOn: (_k, _v, n) => n >= 2 });
    await expect(writeDates(g.deps, NODE, dateChanges(bar(), s, "move", 1, 1), UTC))
      .rejects.toThrow(/^End of "Website relaunch" was not saved as 10 Oct 17:00 \(read back differs\)\. Putting Start back to 5 Oct 09:00 failed too: Start .* The timeline shows what the graph holds\.$/);
  });

  it("nothing to write: no call", async () => {
    const g = fakeDates();
    await writeDates(g.deps, NODE, [] as DateChange[], UTC);
    expect(g.calls).toEqual([]);
  });
});
