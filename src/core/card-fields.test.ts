// N42: the properties a Kanban card can show: what the pull asks for, how raw values are read, how they read on a card.
import { describe, expect, it, vi } from "vitest";
import { buildNodes } from "./normalize";
import { nodePull, nodesQuery, readRaw } from "./queries";
import { buildTagInfos } from "./schema";
import { cardFieldsOf, extraFieldProps, fieldTexts } from "./fields";
import { defaultViewConfig, parseViewConfig, serializeViewConfig, validateViewConfig } from "./view-config";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import type { FieldProp, PlannerNode, TagInfo } from "../types";

const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
const project = tags.find((t) => t.title === "Project")!;
const field = (title: string, type: FieldProp["type"], many = false, id = 1): FieldProp => ({ id, ident: `:user.property/${title.toLowerCase()}-X1`, title, type, many });
const NUM = field("Estimate", "number", false, 11), CHK = field("Billable", "checkbox", false, 12), URL = field("Site", "url", false, 13),
  TXT = field("Notes", "text", false, 14), PEOPLE = field("People", "node", true, 15), ONE = field("Host", "node", false, 16);
const ALL = [NUM, CHK, URL, TXT, PEOPLE, ONE];

describe("the pull", () => {
  it("is what it was without fields; dates and choices are already in it, so only the other types add an attribute", () => {
    expect(nodePull([project], null, false, [])).toBe(nodePull([project]));
    const withDates = nodePull([project], null, false, [field("Start", "date"), field("Owner", "choice")]);
    expect(withDates).toBe(nodePull([project]));
  });

  it("adds a plain attribute for number, checkbox, url and text, and the title for a node or page value", () => {
    const pull = nodePull([project], null, false, ALL);
    for (const f of [NUM, CHK, URL, TXT]) expect(pull).toContain(` ${f.ident}`);
    for (const f of [PEOPLE, ONE]) expect(pull).toContain(`{${f.ident} [:db/id :block/title]}`);
    expect(nodesQuery([project], null, false, ALL)).toContain(pull);
  });
});

describe("staleness", () => {
  it("rows read without the fields are asked again when one is chosen, and kept while the fields are the same", async () => {
    const dq = vi.fn(async (q: string) => (q.includes("pull") && !q.includes(":block/uuid :block/title") ? [] : []));
    const first = await readRaw(dq as never, tags, [project], null, undefined, []);
    const nodeCalls = () => dq.mock.calls.filter(([q]) => (q as string).includes("class-extends")).length;
    const before = nodeCalls();
    await readRaw(dq as never, tags, [project], null, first, []);
    expect(nodeCalls()).toBe(before); // nothing stale: no query
    const again = await readRaw(dq as never, tags, [project], null, first, [NUM]);
    expect(nodeCalls()).toBeGreaterThan(before);
    expect(again.fields).toEqual([NUM]);
  });
});

describe("reading the rows", () => {
  const ref = (id: number, title: string) => ({ id, title });
  const row = (extra: Record<string, unknown>) => [[{ id: 1, uuid: "u1", title: "A", tags: [{ id: project.id }], ...extra }]];
  const read = (extra: Record<string, unknown>, fields = ALL) => buildNodes(row(extra), tags, [project], false, () => 0, null, fields)[0];

  it("keeps scalars as they come and a ref's title; absent, empty and placeholder values are none", () => {
    const n = read({
      [NUM.ident]: 3.5, [CHK.ident]: true, [URL.ident]: "https://example.com/a", [TXT.ident]: "  hello  ",
      [PEOPLE.ident]: [ref(5, "Alice"), ref(6, "Bob")], [ONE.ident]: ref(7, "Carol"),
    });
    expect(n.extras).toEqual({
      [NUM.ident]: [3.5], [CHK.ident]: [true], [URL.ident]: ["https://example.com/a"], [TXT.ident]: ["hello"],
      [PEOPLE.ident]: ["Alice", "Bob"], [ONE.ident]: ["Carol"],
    });
    const empty = read({ [TXT.ident]: "  ", [PEOPLE.ident]: [{ id: 9, ident: ":logseq.property/empty-placeholder" }], [ONE.ident]: { id: 8 } });
    expect(empty.extras).toEqual({});
  });

  it("without fields a node has no extras", () => {
    expect(buildNodes(row({ [NUM.ident]: 3 }), tags, [project], false, () => 0)[0].extras).toEqual({});
  });
});

describe("how a value reads on a card", () => {
  const node = (over: Partial<PlannerNode> = {}): PlannerNode => ({
    id: 1, uuid: "u", title: "A", tagIds: [], tag: project.ident, dates: {}, choices: {}, dependsOn: [], links: [], extras: {}, ...over,
  });
  const owner = project.choiceProps.find((p) => p.title === "Owner")!;
  const start = field("Start", "date");

  it("choice: its title; date and datetime: the card's date format", () => {
    expect(fieldTexts({ ...field("Owner", "choice"), ident: owner.ident }, node({ choices: { [owner.ident]: owner.values[0] } }))).toEqual([owner.values[0].title]);
    expect(fieldTexts(start, node({ dates: { [start.ident]: { day: "2026-10-06", time: "09:00" } } }))).toEqual(["6 Oct 09:00"]);
    expect(fieldTexts(start, node())).toEqual([]);
  });

  it("number as written, checkbox as the property's name when ticked (nothing when not), url as its host, text as is, nodes by title", () => {
    expect(fieldTexts(NUM, node({ extras: { [NUM.ident]: [3.5] } }))).toEqual(["3.5"]);
    expect(fieldTexts(CHK, node({ extras: { [CHK.ident]: [true] } }))).toEqual(["Billable"]);
    expect(fieldTexts(CHK, node({ extras: { [CHK.ident]: [false] } }))).toEqual([]);
    expect(fieldTexts(URL, node({ extras: { [URL.ident]: ["https://www.example.com/a/b?q=1"] } }))).toEqual(["example.com"]);
    expect(fieldTexts(URL, node({ extras: { [URL.ident]: ["not a url"] } }))).toEqual(["not a url"]);
    expect(fieldTexts(TXT, node({ extras: { [TXT.ident]: ["hello"] } }))).toEqual(["hello"]);
    expect(fieldTexts(PEOPLE, node({ extras: { [PEOPLE.ident]: ["Alice", "Bob"] } }))).toEqual(["Alice", "Bob"]);
  });
});

describe("which fields a card shows", () => {
  const view = validateViewConfig(defaultViewConfig(project, "kanban"), tags);
  const kanban = (over: object = {}) => ({ ...defaultViewConfig(project, "kanban"), ...over }) as Extract<ReturnType<typeof defaultViewConfig>, { kind: "kanban" }>;
  const titles = (fs: FieldProp[]) => fs.map((f) => f.title);

  it("by default: the choice properties the tags share, less the column, the lane, Priority and the hidden ones", () => {
    expect(titles(cardFieldsOf(kanban(), project, view))).toEqual(["Owner"]);
    const owner = project.choiceProps.find((p) => p.title === "Owner")!;
    expect(cardFieldsOf(kanban({ hiddenFields: [owner.ident] }), project, view)).toEqual([]);
  });

  it("a tag with its own list shows exactly that, in that order, skipping what is gone or is the column", () => {
    const own = [...project.fieldProps].map((f) => f.ident);
    const status = project.fieldProps.find((f) => f.title === "Status")!;
    const c = kanban({ cardFields: { [project.ident]: [own[3], ":user.property/gone-0", status.ident, own[1]] } });
    expect(titles(cardFieldsOf(c, project, view))).toEqual([project.fieldProps[3].title, project.fieldProps[1].title]);
  });
});

describe("what the pull must carry", () => {
  const view = validateViewConfig(defaultViewConfig(project, "kanban"), tags);
  it("only the chosen properties that need their own attribute", () => {
    const own = project.fieldProps.map((f) => f.ident);
    const c = { ...defaultViewConfig(project, "kanban"), cardFields: { [project.ident]: own } } as never;
    expect(extraFieldProps(c, view).map((f) => f.type).sort()).toEqual(project.fieldProps.filter((f) => ["text", "number", "checkbox", "url", "node"].includes(f.type)).map((f) => f.type).sort());
    expect(extraFieldProps(defaultViewConfig(project, "kanban"), view)).toEqual([]);
    expect(extraFieldProps(defaultViewConfig(project, "timeline"), view)).toEqual([]);
  });
});

describe("the view config", () => {
  const board = () => defaultViewConfig(project, "kanban") as unknown as Record<string, unknown>;
  it("a new Kanban view has no card fields of its own; an older stored one loads the same", () => {
    expect(board()).toMatchObject({ cardFields: {} });
    const { cardFields: _, ...stored } = board();
    expect(parseViewConfig(JSON.stringify({ v: 1, config: stored }))).toEqual({ ...stored, cardFields: {} });
  });
  it("round-trips, and rejects anything but lists of idents by tag", () => {
    const c = { ...board(), cardFields: { [project.ident]: [":user.property/x"] } };
    expect(parseViewConfig(serializeViewConfig(c as never))).toEqual(c);
    for (const cardFields of [[], null, { [project.ident]: "x" }, { [project.ident]: [1] }]) {
      expect(() => parseViewConfig(JSON.stringify({ v: 1, config: { ...board(), cardFields } }))).toThrow(/cardFields must be an object of lists of property idents/);
    }
  });
});
