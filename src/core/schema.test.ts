import { describe, expect, it } from "vitest";
import tagsFixture from "./__fixtures__/tags.json";
import propsFixture from "./__fixtures__/class-properties.json";
import { buildTagInfos, loadTagInfos, mergeTags, tagsTitle, TAGS_QUERY, TAG_PROPERTIES_QUERY } from "./schema";
import type { TagInfo } from "../types";

const rawTags = tagsFixture.query.detail as unknown[];
const rawProps = propsFixture.query.detail as unknown[];

const tags = buildTagInfos(rawTags, rawProps);
const byTitle = (title: string): TagInfo => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
const titles = (xs: { title: string }[]) => xs.map((x) => x.title);

describe("buildTagInfos", () => {
  it("flags built-in and own tags", () => {
    expect(byTitle("Task").builtIn).toBe(true);
    expect(byTitle("Project").builtIn).toBe(false);
    expect(byTitle("Meeting").builtIn).toBe(false);
  });

  it("links parents and children by extends, without the Root Tag", () => {
    const project = byTitle("Project");
    const client = byTitle("Client project");
    expect(client.parentIds).toEqual([project.id]);
    expect(project.childIds).toEqual([client.id]);
    expect(project.parentIds).toEqual([]);
    expect(tags.some((t) => t.title === "Root Tag")).toBe(false);
  });

  it("lists own date props typed Date and DateTime", () => {
    expect(byTitle("Project").dateProps.map((p) => [p.title, p.type]).sort()).toEqual([
      ["End", "date"],
      ["Start", "date"],
    ]);
    expect(byTitle("Meeting").dateProps.map((p) => [p.title, p.type])).toEqual([["Date", "datetime"]]);
  });

  it("gives a tag without dates dateProps: []", () => {
    expect(byTitle("Query").dateProps).toEqual([]);
    expect(byTitle("Page").dateProps).toEqual([]);
  });

  it("child tag inherits parent's date and choice props and keeps its own", () => {
    const client = byTitle("Client project");
    expect(titles(client.dateProps).sort()).toEqual(["End", "Start"]);
    expect(titles(client.choiceProps).sort()).toEqual(["Owner", "Status"]);
    // Client (text) is its own property and is neither date nor choice
    expect(titles(client.choiceProps)).not.toContain("Client");
  });

  it("does not repeat a property reached twice", () => {
    for (const t of tags) {
      const idents = [...t.dateProps, ...t.choiceProps].map((p) => p.ident);
      expect(new Set(idents).size).toBe(idents.length);
    }
  });

  it("excludes created-at / updated-at", () => {
    for (const t of tags) {
      expect(titles(t.dateProps)).not.toContain("Node created at");
      expect(titles(t.dateProps)).not.toContain("Node updated at");
    }
  });

  it("includes built-in datetime props of Task (Deadline, Scheduled)", () => {
    expect(titles(byTitle("Task").dateProps).sort()).toEqual(["Deadline", "Scheduled"]);
  });

  it("lists closed values in order for a user choice", () => {
    const owner = byTitle("Project").choiceProps.find((p) => p.title === "Owner")!;
    expect(titles(owner.values)).toEqual(["Alice", "Bob"]);
    expect(owner.values.every((v) => v.checkbox === null && !v.canceled && v.ident === null)).toBe(true);
  });

  it("flags built-in Status: checkbox on Todo/Done only, Canceled by ident", () => {
    const status = byTitle("Project").choiceProps.find((p) => p.title === "Status")!;
    expect(titles(status.values)).toEqual(["Backlog", "Todo", "Doing", "In Review", "Done", "Canceled"]);
    const flags = Object.fromEntries(status.values.map((v) => [v.title, [v.checkbox, v.canceled]]));
    expect(flags).toEqual({
      Backlog: [null, false],
      Todo: [false, false],
      Doing: [null, false],
      "In Review": [null, false],
      Done: [true, false],
      Canceled: [null, true],
    });
  });

  it("does not list a text property as a choice", () => {
    expect(titles(byTitle("Task").choiceProps).sort()).toEqual(["Priority", "Status"]);
  });
});

describe("loadTagInfos", () => {
  it("runs the tag query, then the property query for the tags that own properties", async () => {
    const calls: { query: string; inputs: unknown[] }[] = [];
    const dq = async (query: string, ...inputs: unknown[]) => {
      calls.push({ query, inputs });
      return query === TAGS_QUERY ? rawTags : rawProps;
    };
    const result = await loadTagInfos(dq);
    expect(calls[0].query).toBe(TAGS_QUERY);
    expect(calls[1].query).toBe(TAG_PROPERTIES_QUERY);
    const sent = calls[1].inputs[0] as string[];
    expect(sent).toContain("Project");
    expect(sent).not.toContain("Page"); // owns no properties
    expect(result).toEqual(tags);
  });
});

describe("multi-value choice properties (T14 review)", () => {
  it("are not offered: a choice property whose cardinality is many is left out", () => {
    // The fixture's Owner row with ONLY its cardinality changed to many (no live graph had one when the fixture was taken).
    const many = (rawProps as [string, Record<string, unknown>][]).map(([t, p]) => [t, p.title === "Owner" ? { ...p, cardinality: ":db.cardinality/many" } : p]);
    const project = buildTagInfos(rawTags, many).find((t) => t.title === "Project")!;
    expect(titles(project.choiceProps)).toEqual(["Status"]);
    expect(titles(byTitle("Project").choiceProps)).toEqual(["Status", "Owner"]);
  });
});

describe("node properties (N12)", () => {
  // The T01 fixtures have no node-typed property: these rows are the fixture rows plus one hand-written node property
  // on Project (many-valued, like `depends_on` on #Task in planner-project) and one on Meeting (cardinality one), each
  // listed in its tag's class properties. Shapes as the probe saw them (`:logseq.property/type` "node", bare cardinality key).
  const DEPENDS = { id: 9901, ident: ":user.property/depends_on-Ab12Cd34", title: "depends_on", ":logseq.property/type": "node", cardinality: ":db.cardinality/many" };
  const HOST = { id: 9902, ident: ":user.property/host-Ef56Gh78", title: "Host", ":logseq.property/type": "node", cardinality: ":db.cardinality/one" };
  const withNodeProps = () => {
    const rows = (rawTags as [Record<string, unknown>][]).map(([t]) => {
      const extra = t.title === "Project" ? [DEPENDS] : t.title === "Meeting" ? [HOST] : [];
      const own = (t[":logseq.property.class/properties"] as unknown[] | undefined) ?? [];
      return [extra.length ? { ...t, ":logseq.property.class/properties": [...own, ...extra.map((p) => ({ id: p.id, ident: p.ident, title: p.title }))] } : t];
    });
    const props = [...(rawProps as unknown[]), ["Project", DEPENDS], ["Meeting", HOST]];
    return buildTagInfos(rows, props);
  };
  const of = (infos: TagInfo[], title: string) => infos.find((t) => t.title === title)!;

  it("lists a tag's node-typed properties, any cardinality, with id, ident and title", () => {
    const infos = withNodeProps();
    expect(of(infos, "Project").nodeProps).toEqual([{ id: DEPENDS.id, ident: DEPENDS.ident, title: "depends_on" }]);
    expect(of(infos, "Meeting").nodeProps).toEqual([{ id: HOST.id, ident: HOST.ident, title: "Host" }]);
  });

  it("a child tag inherits its parent's node properties", () => {
    expect(titles(of(withNodeProps(), "Client project").nodeProps)).toEqual(["depends_on"]);
  });

  it("a node property is neither a date nor a choice property, and a tag without one has nodeProps: []", () => {
    const infos = withNodeProps();
    expect(titles(of(infos, "Project").dateProps)).not.toContain("depends_on");
    expect(titles(of(infos, "Project").choiceProps)).not.toContain("depends_on");
    expect(of(infos, "Task").nodeProps).toEqual([]);
    expect(byTitle("Project").nodeProps).toEqual([]); // the plain fixture has none
  });
});

describe("mergeTags: the properties a view over several tags shares (N14)", () => {
  const idents = (xs: { ident: string }[]) => xs.map((x) => x.ident);

  it("one tag shares all of its own and inherited properties", () => {
    const client = byTitle("Client project");
    expect(mergeTags([client])).toEqual({ tags: [client], choiceProps: client.choiceProps, nodeProps: client.nodeProps });
  });

  it("several tags share the properties every one of them has, by ident (built-in Status on #Project and #Task)", () => {
    const view = mergeTags([byTitle("Project"), byTitle("Task")]);
    expect(idents(view.choiceProps)).toEqual([":logseq.property/status"]);
    expect(view.choiceProps[0]).toBe(byTitle("Project").choiceProps.find((p) => p.ident === ":logseq.property/status"));
    expect(mergeTags([byTitle("Project"), byTitle("Meeting")]).choiceProps).toEqual([]);
  });

  it("keeps the first tag's property order", () => {
    const a = byTitle("Project");
    const reversed = { ...a, id: 1, ident: ":user.class/Rev", choiceProps: [...a.choiceProps].reverse() };
    expect(idents(mergeTags([a, reversed]).choiceProps)).toEqual(idents(a.choiceProps));
    expect(idents(mergeTags([reversed, a]).choiceProps)).toEqual(idents(reversed.choiceProps));
  });

  it("matches node properties the same way", () => {
    const n = (ident: string) => ({ id: 1, ident, title: ident });
    const a = { ...byTitle("Project"), nodeProps: [n(":u/dep"), n(":u/parent")] };
    const b = { ...byTitle("Task"), nodeProps: [n(":u/parent"), n(":u/dep")] };
    expect(idents(mergeTags([a, b]).nodeProps)).toEqual([":u/dep", ":u/parent"]);
    expect(mergeTags([a, { ...b, nodeProps: [] }]).nodeProps).toEqual([]);
  });

  it("throws on an empty list", () => {
    expect(() => mergeTags([])).toThrow(/at least one tag/);
  });

  it("tagsTitle joins the titles: #Project + #Task", () => {
    expect(tagsTitle([byTitle("Project"), byTitle("Task")])).toBe("#Project + #Task");
    expect(tagsTitle([byTitle("Meeting")])).toBe("#Meeting");
  });
});
