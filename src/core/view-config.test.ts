import { describe, expect, it } from "vitest";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos } from "./schema";
import { defaultViewConfig, parseViewConfig, serializeViewConfig, toChoiceFilters, validateViewConfig } from "./view-config";
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
    expect(k).toMatchObject({ kind: "kanban", columnProp: choice(p, "Status").ident, laneProp: null, sort: "due" });
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
