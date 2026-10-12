import { describe, expect, it } from "vitest";
import { loadTagInfos } from "./schema";
import { titlesByUuid } from "./display-title";
import { viewItems } from "./layout-common";
import { NO_VALUE } from "./kanban";
import { axisBands, defaultMatrixAxes, layoutMatrix, matrixMove, MATRIX_PRESETS, type MatrixInput, type MatrixLayout } from "./matrix";
import { fixtureDq } from "../ui/test-fakes";
import type { ChoiceProp, LocalDate, PlannerNode, TagInfo } from "../types";

const dq = fixtureDq();
const tags = await loadTagInfos(dq);
const task = tags.find((t) => t.title === "Task")!;
const TODAY = "2026-10-03";
const prop = (t: TagInfo, title: string) => t.choiceProps.find((p) => p.title === title)!;
const status = prop(task, "Status");
const priority = prop(task, "Priority");
const value = (p: ChoiceProp, title: string) => p.values.find((v) => v.title === title)!;
const statusValues = status.values;
const deadline = task.dateProps.find((p) => p.title === "Deadline")!.ident;

/** Synthetic #Task nodes: [title, Status title | null, Priority title | null, deadline day | null]. */
function nodes(spec: [string, string | null, string | null, string | null][]): PlannerNode[] {
  return spec.map(([title, st, pri, day], i) => ({
    id: i + 1, uuid: `00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`, title, tagIds: [], tag: task.ident, links: [], dependsOn: [],
    dates: day ? { [deadline]: { day, time: null } as LocalDate } : {},
    choices: { ...(st ? { [status.ident]: value(status, st) } : {}), ...(pri ? { [priority.ident]: value(priority, pri) } : {}) },
  }));
}

const SPEC: [string, string | null, string | null, string | null][] = [
  ["Fix outage", "Todo", "Urgent", "2026-10-04"],
  ["Plan roadmap", "Doing", "High", "2026-10-20"],
  ["Tidy tags", "In Review", "Low", null],
  ["Write notes", "Backlog", "Medium", "2026-10-01"],
  ["Shipped", "Done", "Urgent", "2026-09-30"],
  ["No priority", "Todo", null, "2026-10-02"],
  ["Nothing set", null, null, null],
];

/** Priority down (reversed: Urgent, High first), Status across (Backlog, Todo, Doing first). */
function layout(over: Partial<MatrixInput> = {}, spec = SPEC): MatrixLayout {
  const ns = nodes(spec);
  const axes = defaultMatrixAxes([status, priority])!;
  return layoutMatrix({
    items: viewItems(ns, [], () => ({ start: null, end: deadline }), statusValues),
    x: { prop: status, reverse: axes.x.reverse, first: axes.x.first }, y: { prop: priority, reverse: axes.y.reverse, first: axes.y.first },
    mode: "quadrants", showDone: false, labels: ["", "", "", ""], today: TODAY, doneValues: {}, titles: titlesByUuid(ns), pending: new Set(), ...over,
  });
}
const titles = (l: MatrixLayout, row: number, col: number) => l.rows[row][col].cards.map((c) => c.title);

describe("default axes", () => {
  it("Priority goes down, high end first (its built-in values run Low to Urgent); the other property goes across, split in the middle", () => {
    const axes = defaultMatrixAxes([status, priority])!;
    expect(axes.y.prop).toBe(priority.ident);
    expect(axes.y.reverse).toBe(true);
    expect(axes.y.first).toEqual([value(priority, "Urgent").uuid, value(priority, "High").uuid]);
    expect(axes.x.prop).toBe(status.ident);
    expect(axes.x.reverse).toBe(false);
    expect(axes.x.first.map((u) => status.values.find((v) => v.uuid === u)!.title)).toEqual(["Backlog", "Todo", "Doing"]);
  });

  it("properties named Urgency and Importance, or Effort and Impact, take their places", () => {
    const fake = (title: string, values: string[]): ChoiceProp => ({
      id: 0, ident: `:user.property/${title.toLowerCase()}`, title,
      values: values.map((t, i) => ({ id: i + 1, uuid: `${title}-${t}`, title: t, ident: null, order: `a${i}`, checkbox: null, canceled: false })),
    });
    const a = defaultMatrixAxes([fake("Importance", ["High", "Low"]), fake("Urgency", ["Now", "Later"])])!;
    expect([a.x.prop, a.y.prop]).toEqual([":user.property/urgency", ":user.property/importance"]);
    const b = defaultMatrixAxes([fake("Effort", ["S", "M", "L"]), fake("Impact", ["High", "Medium", "Low"])])!;
    expect([b.x.prop, b.y.prop]).toEqual([":user.property/effort", ":user.property/impact"]);
    expect(b.x.first).toEqual(["Effort-S"]); // three values: one in the first band (the split is the user's to move)
  });

  it("none with fewer than two choice properties", () => {
    expect(defaultMatrixAxes([status])).toBeNull();
  });
});

describe("bands", () => {
  it("quadrants: the first band is the listed values in the axis's order, the second the rest; the drop value is each band's first", () => {
    const [first, second] = axisBands({ prop: priority, reverse: true, first: [value(priority, "Urgent").uuid, value(priority, "High").uuid] }, "quadrants");
    expect(first.values.map((v) => v.title)).toEqual(["Urgent", "High"]);
    expect(second.values.map((v) => v.title)).toEqual(["Medium", "Low"]);
    expect([first.drop?.title, second.drop?.title]).toEqual(["Urgent", "Medium"]);
  });

  it("a value added to the property later, or a gone uuid in the list, changes nothing for the others: unknown uuids are ignored, new values join the second band", () => {
    const [first, second] = axisBands({ prop: priority, reverse: true, first: ["gone-uuid", value(priority, "Urgent").uuid] }, "quadrants");
    expect(first.values.map((v) => v.title)).toEqual(["Urgent"]);
    expect(second.values.map((v) => v.title)).toEqual(["High", "Medium", "Low"]);
  });

  it("every value: one band per value in the axis's order", () => {
    const bands = axisBands({ prop: priority, reverse: true, first: [] }, "values");
    expect(bands.map((b) => b.title)).toEqual(["Urgent", "High", "Medium", "Low"]);
    expect(bands.map((b) => b.key)).toEqual(["Urgent", "High", "Medium", "Low"].map((t) => value(priority, t).uuid));
  });
});

describe("layout", () => {
  it("files each card by its two values; a card missing either is unplaced; done cards are hidden and counted", () => {
    const l = layout();
    expect(titles(l, 0, 0)).toEqual(["Fix outage", "Plan roadmap"]); // Urgent / Todo, High / Doing
    expect(titles(l, 0, 1)).toEqual([]); // "Shipped" (Urgent / Done) is done: hidden
    expect(titles(l, 1, 0)).toEqual(["Write notes"]); // Medium / Backlog
    expect(titles(l, 1, 1)).toEqual(["Tidy tags"]); // Low / In Review
    expect(l.unplaced.map((c) => c.title)).toEqual(["No priority", "Nothing set"]); // by due date, undated last
    expect(l.doneHidden).toBe(1);
  });

  it("Show done shows them", () => {
    const l = layout({ showDone: true });
    expect(titles(l, 0, 1)).toEqual(["Shipped"]);
    expect(l.doneHidden).toBe(0);
  });

  it("cards are sorted by due date, undated last, then title", () => {
    const l = layout({}, [["B", "Todo", "Urgent", null], ["A", "Todo", "Urgent", null], ["C", "Todo", "Urgent", "2026-10-09"]]);
    expect(titles(l, 0, 0)).toEqual(["C", "A", "B"]);
  });

  it("a card names its values and its date, and is late past its due date", () => {
    const c = layout().rows[0][0].cards[0];
    expect([c.x?.title, c.y?.title, c.when, c.late]).toEqual(["Todo", "Urgent", "4 Oct", false]);
    const w = layout().rows[1][0].cards[0];
    expect([w.title, w.late]).toEqual(["Write notes", true]);
    expect(w.when).toMatch(/2 days late/);
  });

  it("every value: a row per Priority value and a column per Status value", () => {
    const l = layout({ mode: "values" });
    expect(l.y.bands.map((b) => b.title)).toEqual(["Urgent", "High", "Medium", "Low"]);
    expect(l.x.bands.map((b) => b.title)).toEqual(statusValues.map((v) => v.title));
    expect(l.rows[0][1].cards.map((c) => c.title)).toEqual(["Fix outage"]); // Urgent / Todo
    expect(l.rows.every((r) => r.every((c) => c.label === null))).toBe(true);
  });

  it("a date at midnight shows without its time, as in the Agenda (N62)", () => {
    const ns = nodes([["Night", "Todo", "Urgent", null]]);
    ns[0].dates = { [deadline]: { day: "2026-10-12", time: "00:00" } as LocalDate };
    const l = layout({ items: viewItems(ns, [], () => ({ start: null, end: deadline }), statusValues), titles: titlesByUuid(ns) });
    expect(l.rows[0][0].cards[0].when).toBe("12 Oct");
  });
});

describe("labels", () => {
  it("custom labels win; an empty one takes the default, which names the two bands", () => {
    const l = layout({ labels: ["Now", "", "", ""] });
    expect(l.rows[0][0].label).toBe("Now");
    expect(l.rows[0][1].label).toBe("Urgent, High · In Review, Done, Canceled");
  });

  it("a preset's labels when the axes are named for it", () => {
    expect(MATRIX_PRESETS.eisenhower.labels).toEqual(["Do first", "Schedule", "Delegate", "Eliminate"]);
    expect(MATRIX_PRESETS.impactEffort.labels).toEqual(["Quick wins", "Big bets", "Fill-ins", "Money pits"]);
  });
});

describe("moves", () => {
  const card = (l: MatrixLayout, title: string) => [...l.rows.flat().flatMap((c) => c.cards), ...l.unplaced].find((c) => c.title === title)!;

  it("to another quadrant: each axis whose band changes gets its band's first value; the old value is kept for a roll-back", () => {
    const l = layout();
    const writes = matrixMove(l, card(l, "Tidy tags").uuid, "first", "first");
    expect(writes.map((w) => [w.prop.title, w.kind, w.kind === "set" ? w.value.title : null, w.previous?.title])).toEqual([
      ["Status", "set", "Backlog", "In Review"],
      ["Priority", "set", "Urgent", "Low"],
    ]);
  });

  it("within the same band nothing is written: the card keeps its own value", () => {
    const l = layout();
    expect(matrixMove(l, card(l, "Fix outage").uuid, "first", "first")).toEqual([]);
  });

  it("to Unplaced removes the values the card has", () => {
    const l = layout();
    const writes = matrixMove(l, card(l, "No priority").uuid, NO_VALUE, NO_VALUE);
    expect(writes.map((w) => [w.prop.title, w.kind])).toEqual([["Status", "remove"]]);
  });

  it("from Unplaced, a card with one value set gets only the other one when that band holds it", () => {
    const l = layout();
    const writes = matrixMove(l, card(l, "No priority").uuid, "first", "second");
    expect(writes.map((w) => [w.prop.title, w.kind === "set" ? w.value.title : w.kind])).toEqual([["Priority", "Medium"]]);
  });

  it("every value: the cell's own values are written", () => {
    const l = layout({ mode: "values" });
    const writes = matrixMove(l, card(l, "Tidy tags").uuid, value(status, "Doing").uuid, value(priority, "High").uuid);
    expect(writes.map((w) => (w.kind === "set" ? w.value.title : w.kind))).toEqual(["Doing", "High"]);
  });

  it("a band with no values cannot take a card", () => {
    const l = layout({ y: { prop: priority, reverse: true, first: priority.values.map((v) => v.uuid) } });
    expect(() => matrixMove(l, card(l, "Tidy tags").uuid, "first", "second")).toThrow(/no values/);
  });
});
