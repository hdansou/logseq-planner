import { describe, expect, it } from "vitest";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos } from "./schema";
import { defaultViewConfig, dependsOnOf, parseViewConfig, serializeViewConfig, toChoiceFilters, validateViewConfig, type ViewConfig } from "./view-config";
import type { TagInfo } from "../types";

const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
const tag = (title: string): TagInfo => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
const dateIdent = (t: TagInfo, title: string) => t.dateProps.find((p) => p.title === title)!.ident;
const choice = (t: TagInfo, title: string) => t.choiceProps.find((p) => p.title === title)!;

describe("defaultViewConfig", () => {
  it("maps Start/End for a Project", () => {
    const p = tag("Project");
    const c = defaultViewConfig(p);
    expect(c).toMatchObject({ kind: "timeline", tag: p.ident, childTags: true, start: dateIdent(p, "Start"), end: dateIdent(p, "End"), zoom: "month", doneValues: {}, filters: {} });
  });

  it("maps Scheduled/Deadline for a Task", () => {
    const t = tag("Task");
    const c = defaultViewConfig(t);
    expect(c.start).toBe(dateIdent(t, "Scheduled"));
    expect(c.end).toBe(dateIdent(t, "Deadline"));
  });

  it("takes the single Date of a Meeting as start, no end", () => {
    const m = tag("Meeting");
    const c = defaultViewConfig(m);
    expect(c.start).toBe(dateIdent(m, "Date"));
    expect(c.end).toBeNull();
  });

  it("leaves start and end empty for a tag without dates", () => {
    const c = defaultViewConfig(tag("Page"));
    expect(c.start).toBeNull();
    expect(c.end).toBeNull();
  });

  it("carries the per-view defaults", () => {
    const p = tag("Project");
    expect(defaultViewConfig(p, "calendar")).toMatchObject({ kind: "calendar", layout: "month" });
    expect(defaultViewConfig(p, "agenda")).toMatchObject({ kind: "agenda", groupBy: "node", showDone: false });
    const k = defaultViewConfig(p, "kanban");
    expect(k).toMatchObject({ kind: "kanban", columnProp: choice(p, "Status").ident, laneProp: null, sort: "due", hiddenColumns: {} });
  });

  it("kanban falls back to the first choice property, or none", () => {
    const m = tag("Meeting");
    expect(defaultViewConfig(m, "kanban")).toMatchObject({ columnProp: choice(m, "Type").ident });
    expect(defaultViewConfig(tag("Page"), "kanban")).toMatchObject({ columnProp: null });
  });
});

describe("validateViewConfig", () => {
  const p = tag("Project");
  const base = () => defaultViewConfig(p);

  it("accepts a default config and returns its tag", () => {
    expect(validateViewConfig(base(), tags)).toBe(p);
  });

  it("throws on an unknown tag", () => {
    expect(() => validateViewConfig({ ...base(), tag: ":user.class/Nope" }, tags)).toThrow(/unknown tag/i);
  });

  it("throws on a start or end that is not a date property of the tag", () => {
    expect(() => validateViewConfig({ ...base(), start: ":user.property/nope" }, tags)).toThrow(/unknown date property/i);
    expect(() => validateViewConfig({ ...base(), end: choice(p, "Status").ident }, tags)).toThrow(/unknown date property/i);
  });

  it("throws on unknown kanban properties", () => {
    const k = defaultViewConfig(p, "kanban");
    expect(() => validateViewConfig({ ...k, laneProp: dateIdent(p, "Start") } as typeof k, tags)).toThrow(/unknown choice property/i);
    expect(() => validateViewConfig({ ...k, columnProp: ":x/y" } as typeof k, tags)).toThrow(/unknown choice property/i);
  });

  it("throws on unknown filter or done-value identifiers", () => {
    const owner = choice(p, "Owner");
    expect(() => validateViewConfig({ ...base(), filters: { ":x/y": [null] } }, tags)).toThrow(/unknown choice property/i);
    expect(() => validateViewConfig({ ...base(), filters: { [owner.ident]: ["no-such-uuid"] } }, tags)).toThrow(/unknown value/i);
    expect(() => validateViewConfig({ ...base(), doneValues: { [owner.ident]: ["no-such-uuid"] } }, tags)).toThrow(/unknown value/i);
    expect(() => validateViewConfig({ ...base(), doneValues: { ":x/y": [] } }, tags)).toThrow(/unknown choice property/i);
  });

  it("accepts real value uuids and null (no value) in filters", () => {
    const owner = choice(p, "Owner");
    const c = { ...base(), filters: { [owner.ident]: [owner.values[0].uuid, null] }, doneValues: { [owner.ident]: [owner.values[1].uuid] } };
    expect(validateViewConfig(c, tags)).toBe(p);
  });

  it("throws on an unknown kind or option", () => {
    expect(() => validateViewConfig({ ...base(), kind: "gantt" } as never, tags)).toThrow(/unknown view kind/i);
    expect(() => validateViewConfig({ ...base(), zoom: "decade" } as never, tags)).toThrow(/zoom/i);
  });
});

describe("serialisation", () => {
  it("round trips every kind with its version", () => {
    const p = tag("Project");
    for (const kind of ["timeline", "calendar", "agenda", "kanban"] as const) {
      const c = defaultViewConfig(p, kind);
      const text = serializeViewConfig(c);
      expect(JSON.parse(text).v).toBe(1);
      expect(parseViewConfig(text)).toEqual(c);
    }
  });

  it("throws on bad JSON, a wrong version and a missing config", () => {
    expect(() => parseViewConfig("{nope")).toThrow(/invalid/i);
    expect(() => parseViewConfig(JSON.stringify({ v: 2, config: {} }))).toThrow(/version/i);
    expect(() => parseViewConfig(JSON.stringify({ v: 1 }))).toThrow(/config/i);
  });
});

describe("toChoiceFilters", () => {
  it("turns saved value uuids into the closed-value ids filterNodes takes; null stays", () => {
    const p = tag("Project");
    const owner = choice(p, "Owner");
    const c = { ...defaultViewConfig(p), filters: { [owner.ident]: [owner.values[1].uuid, null] } };
    expect(toChoiceFilters(c, p)).toEqual({ [owner.ident]: [owner.values[1].id, null] });
  });
});

describe("strict shapes (T14 review)", () => {
  const p = tag("Project");
  const status = choice(p, "Status");
  const base = () => defaultViewConfig(p) as unknown as Record<string, unknown>;
  const bad: [string, Record<string, unknown>, RegExp][] = [
    ["a filter that is a string, not a list", { filters: { [status.ident]: "" } }, /filters\[.*\] must be a list/],
    ["filters that are a list", { filters: [] }, /filters must be an object/],
    ["filters that are null", { filters: null }, /filters must be an object/],
    ["a filter entry that is a number", { filters: { [status.ident]: [1] } }, /filters\[.*\] must hold value uuids or null/],
    ["a done value that is null", { doneValues: { [status.ident]: [null] } }, /doneValues\[.*\] must hold value uuids/],
    ["done values that are a string", { doneValues: "x" }, /doneValues must be an object/],
    ["childTags as a string", { childTags: "true" }, /childTags must be true or false/],
    ["tag missing", { tag: undefined }, /tag must be a string/],
    ["start as a number", { start: 1 }, /start must be a string or null/],
    ["end missing", { end: undefined }, /end must be a string or null/],
  ];
  for (const [what, patch, msg] of bad) {
    it(`rejects ${what}, in parse and in validate`, () => {
      const c = { ...base(), ...patch };
      expect(() => parseViewConfig(JSON.stringify({ v: 1, config: c }))).toThrow(msg);
      expect(() => validateViewConfig(c as never, tags)).toThrow(msg);
    });
  }

  it("rejects showDone that is not a boolean and kanban props that are not strings or null", () => {
    const agenda = { ...(defaultViewConfig(p, "agenda") as object), showDone: "yes" };
    expect(() => parseViewConfig(JSON.stringify({ v: 1, config: agenda }))).toThrow(/showDone must be true or false/);
    const board = { ...(defaultViewConfig(p, "kanban") as object), laneProp: 3 };
    expect(() => parseViewConfig(JSON.stringify({ v: 1, config: board }))).toThrow(/laneProp must be a string or null/);
  });

  it("rejects hiddenColumns that are not an object of string lists (N08)", () => {
    const board = defaultViewConfig(p, "kanban") as unknown as Record<string, unknown>;
    const cases: [unknown, RegExp][] = [
      [[], /hiddenColumns must be an object/],
      [null, /hiddenColumns must be an object/],
      [{ [status.ident]: "none" }, /hiddenColumns\[.*\] must be a list/],
      [{ [status.ident]: [null] }, /hiddenColumns\[.*\] must hold/],
      [{ [status.ident]: [1] }, /hiddenColumns\[.*\] must hold/],
    ];
    for (const [hiddenColumns, msg] of cases) {
      const c = { ...board, hiddenColumns };
      expect(() => parseViewConfig(JSON.stringify({ v: 1, config: c }))).toThrow(msg);
      expect(() => validateViewConfig(c as never, tags)).toThrow(msg);
    }
  });

  it("a kanban config held in memory must have hiddenColumns (only stored configs may lack it)", () => {
    const { hiddenColumns: _, ...board } = defaultViewConfig(p, "kanban") as unknown as Record<string, unknown>;
    expect(() => validateViewConfig(board as never, tags)).toThrow(/hiddenColumns must be an object/);
  });

  it("a stored kanban config without hiddenColumns (saved before N08) loads with nothing hidden", () => {
    const { hiddenColumns: _, ...board } = defaultViewConfig(p, "kanban") as unknown as Record<string, unknown>;
    expect(parseViewConfig(JSON.stringify({ v: 1, config: board }))).toEqual({ ...board, hiddenColumns: {} });
  });

  it("hidden columns: \"none\" and uuids that match no current value are valid (ignored when the board is drawn)", () => {
    const c = { ...(defaultViewConfig(p, "kanban") as object), hiddenColumns: { [status.ident]: ["none", "no-such-uuid"], ":x/gone": ["none"] } };
    expect(validateViewConfig(c as never, tags)).toBe(p);
    expect(parseViewConfig(JSON.stringify({ v: 1, config: c }))).toEqual(c);
  });

  it("every Timeline zoom, Day included (N10), validates and round trips", () => {
    for (const zoom of ["day", "week", "month", "quarter"] as const) {
      const c = { ...defaultViewConfig(p, "timeline"), zoom } as ViewConfig;
      expect(validateViewConfig(c, tags)).toBe(p);
      expect(parseViewConfig(serializeViewConfig(c))).toEqual(c);
    }
  });

  it("rejects an unknown kind or option at parse time", () => {
    expect(() => parseViewConfig(JSON.stringify({ v: 1, config: { ...base(), kind: "gantt" } }))).toThrow(/unknown view kind "gantt"/);
    expect(() => parseViewConfig(JSON.stringify({ v: 1, config: { ...base(), zoom: "year" } }))).toThrow(/timeline zoom "year"/);
  });

  it("still parses every default config", () => {
    for (const kind of ["timeline", "calendar", "agenda", "kanban"] as const) {
      const c = defaultViewConfig(p, kind);
      expect(parseViewConfig(serializeViewConfig(c))).toEqual(c);
    }
  });
});

describe("Depends on (N12)", () => {
  const p = tag("Project");
  const prop = (title: string, id = 9901) => ({ id, ident: `:user.property/${title.toLowerCase().replace(/[^a-z0-9]/g, "")}-${id}`, title });
  const withNodeProps = (...titles: string[]): TagInfo => ({ ...p, nodeProps: titles.map((t, i) => prop(t, 9901 + i)) });

  it("defaults to the node property titled like depends on: depends_on, Depends on, depends-on", () => {
    for (const title of ["depends_on", "Depends on", "depends-on", "DependsOn"]) {
      const t = withNodeProps("Owner page", title);
      expect(defaultViewConfig(t).dependsOn).toBe(t.nodeProps[1].ident);
    }
  });

  it("defaults to null when no node property is titled like depends on, or the tag has none", () => {
    expect(defaultViewConfig(withNodeProps("Blocked by", "Parent")).dependsOn).toBeNull();
    expect(defaultViewConfig(p).dependsOn).toBeNull();
    for (const kind of ["calendar", "agenda", "kanban"] as const) expect(defaultViewConfig(withNodeProps("depends_on"), kind).dependsOn).toBe(withNodeProps("depends_on").nodeProps[0].ident);
  });

  it("dependsOnOf: the chosen ident when the tag has it; null for None and for an ident the tag no longer has (no error)", () => {
    const t = withNodeProps("depends_on", "Blocked by");
    const c = defaultViewConfig(t);
    expect(dependsOnOf({ ...c, dependsOn: t.nodeProps[1].ident }, t)).toBe(t.nodeProps[1].ident);
    expect(dependsOnOf({ ...c, dependsOn: null }, t)).toBeNull();
    expect(dependsOnOf({ ...c, dependsOn: ":user.property/gone-x" }, t)).toBeNull();
    expect(validateViewConfig({ ...defaultViewConfig(p), dependsOn: ":user.property/gone-x" }, tags)).toBe(p);
  });

  it("a stored config without dependsOn (saved before N12) loads with the default rule applied", () => {
    const t = withNodeProps("Depends on");
    const { dependsOn: _, ...old } = defaultViewConfig(t) as unknown as Record<string, unknown>;
    const loaded = parseViewConfig(JSON.stringify({ v: 1, config: old }));
    expect(dependsOnOf(loaded, t)).toBe(t.nodeProps[0].ident);
    expect(dependsOnOf(loaded, p)).toBeNull();
    expect(validateViewConfig(loaded, tags)).toBe(p);
  });

  it("validation: dependsOn is a string or null", () => {
    const c = defaultViewConfig(p) as unknown as Record<string, unknown>;
    for (const dependsOn of [1, true, [], {}]) {
      expect(() => parseViewConfig(JSON.stringify({ v: 1, config: { ...c, dependsOn } }))).toThrow(/dependsOn must be a string or null/);
      expect(() => validateViewConfig({ ...c, dependsOn } as never, tags)).toThrow(/dependsOn must be a string or null/);
    }
  });

  it("round trips a chosen property and None", () => {
    const t = withNodeProps("depends_on");
    for (const dependsOn of [t.nodeProps[0].ident, null]) {
      const c = { ...defaultViewConfig(t), dependsOn };
      expect(parseViewConfig(serializeViewConfig(c))).toEqual(c);
    }
  });
});
