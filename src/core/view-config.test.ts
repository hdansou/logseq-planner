import { describe, expect, it } from "vitest";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos } from "./schema";
import {
  defaultViewConfig, dependsOnOf, parseViewConfig, serializeViewConfig, TAG_KEY, toChoiceFilters, validateViewConfig, withDefaults, withKnownTags, withTags, type ViewConfig,
} from "./view-config";
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
    expect(c).toMatchObject({ kind: "timeline", tags: [p.ident], childTags: true, dates: { [p.ident]: { start: dateIdent(p, "Start"), end: dateIdent(p, "End") } }, zoom: "month", arrange: "date", doneValues: {}, filters: {} });
  });

  it("maps Scheduled/Deadline for a Task", () => {
    const t = tag("Task");
    const c = defaultViewConfig(t);
    expect(c.dates[t.ident]).toEqual({ start: dateIdent(t, "Scheduled"), end: dateIdent(t, "Deadline") });
  });

  it("takes the single Date of a Meeting as start, no end", () => {
    const m = tag("Meeting");
    const c = defaultViewConfig(m);
    expect(c.dates[m.ident]).toEqual({ start: dateIdent(m, "Date"), end: null });
  });

  it("leaves start and end empty for a tag without dates", () => {
    const c = defaultViewConfig(tag("Page"));
    expect(c.dates[tag("Page").ident]).toEqual({ start: null, end: null });
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

  it("accepts a default config and returns its tag with its properties (one tag shares all of them)", () => {
    expect(validateViewConfig(base(), tags)).toEqual({ tags: [p], choiceProps: p.choiceProps, nodeProps: p.nodeProps });
    expect(validateViewConfig(base(), tags).tags).toEqual([p]);
  });

  it("throws on an unknown tag", () => {
    expect(() => validateViewConfig({ ...base(), tags: [":user.class/Nope"], dates: { ":user.class/Nope": { start: null, end: null } } }, tags)).toThrow(/unknown tag/i);
  });

  it("throws on a start or end that is not a date property of the tag", () => {
    expect(() => validateViewConfig({ ...base(), dates: { [p.ident]: { start: ":user.property/nope", end: null } } }, tags)).toThrow(/unknown date property/i);
    expect(() => validateViewConfig({ ...base(), dates: { [p.ident]: { start: null, end: choice(p, "Status").ident } } }, tags)).toThrow(/unknown date property/i);
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
    expect(validateViewConfig(c, tags).tags).toEqual([p]);
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
    ["tags missing", { tags: undefined }, /tags must be a non-empty list of tag idents/],
    ["tags empty", { tags: [] }, /tags must be a non-empty list of tag idents/],
    ["tags with a number", { tags: [p.ident, 3] }, /tags must be a non-empty list of tag idents/],
    ["a tag twice", { tags: [p.ident, p.ident] }, /tags must not repeat a tag/],
    ["dates missing", { dates: undefined }, /dates must be an object/],
    ["a start that is a number", { dates: { [p.ident]: { start: 1, end: null } } }, /dates\[.*\]\.start must be a string or null/],
    ["an end missing", { dates: { [p.ident]: { start: null } } }, /dates\[.*\]\.end must be a string or null/],
    ["dates of a tag not in the view", { dates: { [p.ident]: { start: null, end: null }, ":user.class/Other": { start: null, end: null } } }, /dates names :user\.class\/Other/],
    ["no dates for a tag of the view", { dates: {} }, /dates has no Start \/ End for/],
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
    expect(validateViewConfig(c as never, tags).tags).toEqual([p]);
    expect(parseViewConfig(JSON.stringify({ v: 1, config: c }))).toEqual(c);
  });

  it("every Timeline zoom, Day included (N10), validates and round trips", () => {
    for (const zoom of ["day", "week", "month", "quarter"] as const) {
      const c = { ...defaultViewConfig(p, "timeline"), zoom } as ViewConfig;
      expect(validateViewConfig(c, tags).tags).toEqual([p]);
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
      const c = defaultViewConfig(t);
      expect(c).not.toHaveProperty("dependsOn"); // not chosen
      expect(dependsOnOf(c, t)).toBe(t.nodeProps[1].ident);
    }
  });

  it("defaults to null when no node property is titled like depends on, or the tag has none", () => {
    const blocked = withNodeProps("Blocked by", "Parent");
    expect(dependsOnOf(defaultViewConfig(blocked), blocked)).toBeNull();
    expect(dependsOnOf(defaultViewConfig(p), p)).toBeNull();
    for (const kind of ["calendar", "agenda", "kanban"] as const) {
      const t = withNodeProps("depends_on");
      expect(dependsOnOf(defaultViewConfig(t, kind), t)).toBe(t.nodeProps[0].ident);
    }
  });

  it("dependsOnOf: the chosen ident when the tag has it; null for None and for an ident the tag no longer has (no error)", () => {
    const t = withNodeProps("depends_on", "Blocked by");
    const c = defaultViewConfig(t);
    expect(dependsOnOf({ ...c, dependsOn: t.nodeProps[1].ident }, t)).toBe(t.nodeProps[1].ident);
    expect(dependsOnOf({ ...c, dependsOn: null }, t)).toBeNull();
    expect(dependsOnOf({ ...c, dependsOn: ":user.property/gone-x" }, t)).toBeNull();
    expect(validateViewConfig({ ...defaultViewConfig(p), dependsOn: ":user.property/gone-x" }, tags).tags).toEqual([p]);
  });

  it("a stored config without dependsOn (saved before N12) loads with the default rule applied", () => {
    const t = withNodeProps("Depends on");
    const { dependsOn: _, ...old } = defaultViewConfig(t) as unknown as Record<string, unknown>;
    const loaded = parseViewConfig(JSON.stringify({ v: 1, config: old }));
    expect(dependsOnOf(loaded, t)).toBe(t.nodeProps[0].ident);
    expect(dependsOnOf(loaded, p)).toBeNull();
    expect(validateViewConfig(loaded, tags).tags).toEqual([p]);
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

describe("views over several tags (N14)", () => {
  const p = tag("Project");
  const t = tag("Task");
  const m = tag("Meeting");
  const status = choice(p, "Status");
  const owner = choice(p, "Owner");

  it("defaultViewConfig over tags in selection order: each tag's own default dates, shared properties, nested Timeline", () => {
    const c = defaultViewConfig([p, t]);
    expect(c).toMatchObject({
      kind: "timeline", tags: [p.ident, t.ident], arrange: "nested",
      dates: { [p.ident]: { start: dateIdent(p, "Start"), end: dateIdent(p, "End") }, [t.ident]: { start: dateIdent(t, "Scheduled"), end: dateIdent(t, "Deadline") } },
    });
    expect(defaultViewConfig([p, t], "kanban")).toMatchObject({ columnProp: status.ident, laneProp: null });
    expect(defaultViewConfig([p, m], "kanban")).toMatchObject({ columnProp: null }); // nothing shared
    expect(defaultViewConfig(p)).toEqual(defaultViewConfig([p]));
  });

  it("validates against each tag's dates and the shared choice properties; returns the merged view", () => {
    const c = defaultViewConfig([p, t]);
    expect(validateViewConfig(c, tags)).toMatchObject({ tags: [p, t], choiceProps: [status] });
    expect(() => validateViewConfig({ ...c, filters: { [owner.ident]: [null] } }, tags)).toThrow(/unknown choice property .*Project \+ Task/);
    expect(() => validateViewConfig({ ...c, dates: { ...c.dates, [t.ident]: { start: dateIdent(p, "Start"), end: null } } }, tags)).toThrow(/unknown date property .* on Task/);
    expect(validateViewConfig({ ...c, filters: { [status.ident]: [status.values[0].uuid] } }, tags).tags).toEqual([p, t]);
  });

  it("the Tag filter: tag idents of the view, two or more tags only", () => {
    const c = defaultViewConfig([p, t]);
    expect(validateViewConfig({ ...c, filters: { [TAG_KEY]: [t.ident] } }, tags).tags).toEqual([p, t]);
    expect(() => validateViewConfig({ ...c, filters: { [TAG_KEY]: [m.ident] } }, tags)).toThrow(/Tag filter value .* is not one of the view's tags/);
    expect(() => validateViewConfig({ ...c, filters: { [TAG_KEY]: [null] } }, tags)).toThrow(/Tag filter value null/);
    expect(() => validateViewConfig({ ...defaultViewConfig(p), filters: { [TAG_KEY]: [p.ident] } }, tags)).toThrow(/Tag filter needs two or more tags/);
    expect(() => validateViewConfig({ ...c, doneValues: { [TAG_KEY]: [p.ident] } }, tags)).toThrow(/unknown choice property @tag/);
    expect(toChoiceFilters({ ...c, filters: { [TAG_KEY]: [t.ident], [status.ident]: [null] } }, validateViewConfig(c, tags))).toEqual({ [status.ident]: [null] });
  });

  it("Tag swimlanes: two or more tags only; never a column", () => {
    const k = defaultViewConfig([p, t], "kanban") as Extract<ViewConfig, { kind: "kanban" }>;
    expect(validateViewConfig({ ...k, laneProp: TAG_KEY }, tags).tags).toEqual([p, t]);
    expect(() => validateViewConfig({ ...(defaultViewConfig(p, "kanban") as typeof k), laneProp: TAG_KEY }, tags)).toThrow(/Tag swimlanes need two or more tags/);
    expect(() => validateViewConfig({ ...k, columnProp: TAG_KEY }, tags)).toThrow(/unknown choice property @tag/);
  });

  it("round trips a view over several tags", () => {
    const c = { ...defaultViewConfig([p, t], "kanban"), laneProp: TAG_KEY, filters: { [TAG_KEY]: [p.ident] } } as ViewConfig;
    expect(parseViewConfig(serializeViewConfig(c))).toEqual(c);
    const tl = { ...defaultViewConfig([p, t]), arrange: "tag" } as ViewConfig;
    expect(parseViewConfig(serializeViewConfig(tl))).toEqual(tl);
  });

  it("a timeline arrange that is not By date / By tag / Nested is rejected", () => {
    expect(() => parseViewConfig(JSON.stringify({ v: 1, config: { ...defaultViewConfig([p, t]), arrange: "lanes" } }))).toThrow(/timeline arrange "lanes"/);
  });

  describe("a view stored before N14 (one tag, start and end)", () => {
    const old = (kind: ViewConfig["kind"]) => {
      const { tags: _t, dates: _d, ...rest } = defaultViewConfig(p, kind) as unknown as Record<string, unknown>;
      if (kind === "timeline") delete rest.arrange;
      return { ...rest, tag: p.ident, start: dateIdent(p, "Start"), end: null };
    };

    it("loads as one tag with its dates; a Timeline arranged by date", () => {
      for (const kind of ["timeline", "calendar", "agenda", "kanban"] as const) {
        const loaded = parseViewConfig(JSON.stringify({ v: 1, config: old(kind) }));
        expect(loaded).toEqual({ ...defaultViewConfig(p, kind), dates: { [p.ident]: { start: dateIdent(p, "Start"), end: null } } });
        expect(loaded).not.toHaveProperty("tag");
        expect(loaded).not.toHaveProperty("start");
      }
      expect(parseViewConfig(JSON.stringify({ v: 1, config: old("timeline") }))).toMatchObject({ arrange: "date" });
    });

    it("an old Kanban without hiddenColumns (pre N08) still loads", () => {
      const { hiddenColumns: _, ...board } = old("kanban") as Record<string, unknown>;
      expect(parseViewConfig(JSON.stringify({ v: 1, config: board }))).toMatchObject({ tags: [p.ident], hiddenColumns: {} });
    });

    it("its shape errors are reported in the new shape", () => {
      expect(() => parseViewConfig(JSON.stringify({ v: 1, config: { ...old("calendar"), start: 3 } }))).toThrow(/dates\[.*\]\.start must be a string or null/);
      expect(() => parseViewConfig(JSON.stringify({ v: 1, config: { ...old("calendar"), tag: 3 } }))).toThrow(/tags must be a non-empty list/);
    });
  });

  describe("withTags: ticking and unticking tags", () => {
    it("a new tag gets its default dates; a kept tag keeps its mapping; the arrangement turns nested past one tag", () => {
      const one = { ...defaultViewConfig(p), dates: { [p.ident]: { start: dateIdent(p, "End"), end: null } }, zoom: "week" } as ViewConfig;
      const two = withTags(one, [p, t]);
      expect(two).toMatchObject({ tags: [p.ident, t.ident], zoom: "week", arrange: "nested" });
      expect(two.dates).toEqual({ [p.ident]: { start: dateIdent(p, "End"), end: null }, [t.ident]: { start: dateIdent(t, "Scheduled"), end: dateIdent(t, "Deadline") } });
      const tagged = withTags({ ...two, arrange: "tag" } as ViewConfig, [p, t, m]);
      expect(tagged).toMatchObject({ arrange: "tag" }); // stays several tags: kept
      expect(withTags(tagged, [t])).toMatchObject({ tags: [t.ident], arrange: "date", dates: { [t.ident]: two.dates[t.ident] } });
      expect(withTags(tagged, [t]).dates).not.toHaveProperty(p.ident);
    });

    it("keeps filters and done values the tags share, drops the rest; the Tag filter keeps the remaining tags and goes below two", () => {
      const c = { ...defaultViewConfig([p, t, m]), filters: { [TAG_KEY]: [p.ident, m.ident] } } as ViewConfig;
      const pt = withTags({ ...defaultViewConfig(p), filters: { [status.ident]: [null], [owner.ident]: [owner.values[0].uuid] }, doneValues: { [owner.ident]: [] } }, [p, t]);
      expect(pt.filters).toEqual({ [status.ident]: [null] });
      expect(pt.doneValues).toEqual({});
      expect(withTags(c, [p, t]).filters).toEqual({ [TAG_KEY]: [p.ident] });
      expect(withTags(c, [t, m]).filters).toEqual({ [TAG_KEY]: [m.ident] });
      expect(withTags(c, [p]).filters).toEqual({});
      for (const next of [withTags(c, [p, t]), withTags(c, [p])]) expect(() => validateViewConfig(next, tags)).not.toThrow();
    });

    it("Kanban: a column the tags do not share takes the default, a lane they do not share goes, Tag lanes need two tags, Priority sort needs a Priority", () => {
      const k = { ...defaultViewConfig(p, "kanban"), columnProp: owner.ident, laneProp: status.ident } as ViewConfig;
      expect(withTags(k, [p, t])).toMatchObject({ columnProp: status.ident, laneProp: null });
      const byTag = { ...defaultViewConfig([p, t], "kanban"), laneProp: TAG_KEY } as ViewConfig;
      expect(withTags(byTag, [p, t, tag("Client project")])).toMatchObject({ laneProp: TAG_KEY });
      expect(withTags(byTag, [t])).toMatchObject({ laneProp: null });
      const pri = { ...defaultViewConfig(t, "kanban"), sort: "priority" } as ViewConfig;
      expect(withTags(pri, [t, p])).toMatchObject({ sort: "due" });
      expect(withTags(pri, [t, { ...t, id: 1, ident: ":user.class/T2" }])).toMatchObject({ sort: "priority" });
    });

    it("the dependency property: a choice is kept while a tag of the view has it, else (and when absent) back to not chosen", () => {
      const n = (ident: string, title: string) => ({ id: 1, ident, title });
      const a = { ...p, nodeProps: [n(":u/dep-a", "depends_on")] };
      const b = { ...t, nodeProps: [n(":u/dep-b", "Depends on")] };
      const plain = { ...m, nodeProps: [n(":u/parent", "Parent")] };
      const chosen = { ...defaultViewConfig(a), dependsOn: ":u/dep-a" };
      expect(withTags(chosen, [a, b]).dependsOn).toBe(":u/dep-a"); // #Task's own does not replace it
      expect(withTags({ ...defaultViewConfig([a, b]), dependsOn: ":u/dep-b" }, [a])).not.toHaveProperty("dependsOn"); // gone with #Task
      expect(withTags(chosen, [plain])).not.toHaveProperty("dependsOn");
      expect(withTags({ ...defaultViewConfig(a), dependsOn: null }, [a, b]).dependsOn).toBeNull(); // None is kept
      // Not chosen stays not chosen, so the default rule follows the tags: #Milestone alone has none, + #Task it has.
      const one = withTags(defaultViewConfig(plain), [plain, b]);
      expect(one).not.toHaveProperty("dependsOn");
      expect(dependsOnOf(one, { nodeProps: [...plain.nodeProps, ...b.nodeProps] })).toBe(":u/dep-b");
    });

    it("throws on no tags", () => {
      expect(() => withTags(defaultViewConfig(p), [])).toThrow(/at least one tag/);
    });
  });

  describe("withKnownTags: a saved view naming a tag that is gone", () => {
    const c = { ...defaultViewConfig([p, t]), filters: { [TAG_KEY]: [t.ident] } } as ViewConfig;

    it("drops the gone tag and its dates (and what it alone allowed); the same object when every tag is known", () => {
      expect(withKnownTags(c, tags)).toBe(c);
      const left = withKnownTags(c, tags.filter((x) => x !== t));
      expect(left).toMatchObject({ tags: [p.ident], dates: { [p.ident]: c.dates[p.ident] }, filters: {}, arrange: "date" });
      expect(left.dates).not.toHaveProperty(t.ident);
    });

    it("throws the unknown-tag error when none is left (the caller shows the default view)", () => {
      expect(() => withKnownTags(c, [m])).toThrow(/unknown tag/);
    });
  });

  it("withDefaults fills each tag's unmapped Start from its own rule", () => {
    const c = { ...defaultViewConfig([p, t]), dates: { [p.ident]: { start: null, end: null }, [t.ident]: { start: dateIdent(t, "Deadline"), end: null } } } as ViewConfig;
    expect(withDefaults(c, validateViewConfig(c, tags)).dates).toEqual({ [p.ident]: { start: dateIdent(p, "Start"), end: dateIdent(p, "End") }, [t.ident]: { start: dateIdent(t, "Deadline"), end: null } });
    const k = { ...defaultViewConfig([p, t], "kanban"), columnProp: null } as ViewConfig;
    expect(withDefaults(k, validateViewConfig(k, tags))).toMatchObject({ columnProp: status.ident });
  });
});

describe("Kanban card fields (N38)", () => {
  const p = tag("Project");
  const board = () => defaultViewConfig(p, "kanban") as unknown as Record<string, unknown>;

  it("a new Kanban view hides no field; a stored one without hiddenFields loads the same", () => {
    expect(board()).toMatchObject({ kind: "kanban", hiddenFields: [] });
    const { hiddenFields: _, ...stored } = board();
    expect(parseViewConfig(JSON.stringify({ v: 1, config: stored }))).toEqual({ ...stored, hiddenFields: [] });
  });

  it("round-trips the hidden fields and rejects anything but a list of idents", () => {
    const c = { ...board(), hiddenFields: [":user.property/owner-x"] };
    expect(parseViewConfig(serializeViewConfig(c as never))).toEqual(c);
    for (const hiddenFields of ["owner", [1], null, {}]) {
      expect(() => parseViewConfig(JSON.stringify({ v: 1, config: { ...board(), hiddenFields } }))).toThrow(/hiddenFields must be a list of property idents/);
    }
  });
});
