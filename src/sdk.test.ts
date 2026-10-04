import { afterEach, describe, expect, it, vi } from "vitest";
import { appDeps, BLOCK_TAGS_QUERY, choiceReadQuery, hostWeekStart, kanbanWriteDeps, pageQuery, storageDeps } from "./sdk";

afterEach(() => vi.unstubAllGlobals());

describe("strict views page query", () => {
  it("matches title and Page tag and excludes recycled pages", () => {
    const q = pageQuery('Planner "views"');
    expect(q).toContain('[?p :block/title "Planner \\"views\\""]');
    expect(q).toContain("[?t :db/ident :logseq.class/Page]");
    expect(q).toContain("(not [?p :logseq.property/deleted-at _])");
  });

  it("findPage sends that query and returns null when nothing live matches", async () => {
    const sent: string[] = [];
    vi.stubGlobal("logseq", { DB: { datascriptQuery: async (q: string) => (sent.push(q), []) } });
    expect(await storageDeps().findPage("Planner views")).toBeNull();
    expect(sent[0]).toBe(pageQuery("Planner views"));
  });
});

describe("saved-view block tags (T14, F3)", () => {
  const UUID = "6a000000-0000-4000-8000-000000000001";
  it("pulls the block's tags by #uuid input and counts them; none = 0; a missing block fails", async () => {
    const sent: unknown[][] = [];
    let rows: unknown[] = [[{ uuid: UUID, tags: [{ id: 223 }] }]];
    vi.stubGlobal("logseq", { DB: { datascriptQuery: async (...args: unknown[]) => (sent.push(args), rows) } });
    expect(await storageDeps().blockTags(UUID)).toBe(1);
    expect(sent[0]).toEqual([BLOCK_TAGS_QUERY, `#uuid "${UUID}"`]);
    rows = [[{ uuid: UUID }]];
    expect(await storageDeps().blockTags(UUID)).toBe(0);
    rows = [];
    await expect(storageDeps().blockTags(UUID)).rejects.toThrow(/not found/);
  });
});

describe("host week start", () => {
  const configs = (preferredStartOfWeek: unknown) => vi.stubGlobal("logseq", { App: { getUserConfigs: async () => ({ preferredStartOfWeek }) } });

  it("reads preferredStartOfWeek (a number live, default 6 = Sunday) and converts it to 0 = Sunday", async () => {
    configs(6);
    expect(await hostWeekStart()).toBe(0);
    configs(0);
    expect(await hostWeekStart()).toBe(1);
  });

  it("accepts a numeric string", async () => {
    configs("0");
    expect(await hostWeekStart()).toBe(1);
  });

  it("fails fast on a missing or invalid value", async () => {
    configs(undefined);
    await expect(hostWeekStart()).rejects.toThrow(/preferredStartOfWeek/);
    configs("monday");
    await expect(hostWeekStart()).rejects.toThrow(/preferredStartOfWeek/);
  });
});

describe("Kanban writes (T11; T01 observed shapes, docs/probes.md)", () => {
  const UUID = "6a000000-0000-4000-8000-000000000001";
  const OWNER = ":user.property/owner-rDOlrnNh";

  it("passes the key and the closed value entity id through to the SDK unchanged", async () => {
    const upsertBlockProperty = vi.fn(async () => null);
    const removeBlockProperty = vi.fn(async () => undefined);
    vi.stubGlobal("logseq", { Editor: { upsertBlockProperty, removeBlockProperty } });
    await kanbanWriteDeps().upsertBlockProperty(UUID, "logseq.property/status", 78);
    await kanbanWriteDeps().removeBlockProperty(UUID, "user.property/owner-rDOlrnNh");
    expect(upsertBlockProperty).toHaveBeenCalledWith(UUID, "logseq.property/status", 78);
    expect(removeBlockProperty).toHaveBeenCalledWith(UUID, "user.property/owner-rDOlrnNh");
  });

  it("reads the property back with the probe's read-back form: a pull by uuid with a #uuid input", async () => {
    const sent: unknown[][] = [];
    let rows: unknown[] = [[{ uuid: UUID, [OWNER]: { id: 215 } }]];
    vi.stubGlobal("logseq", { DB: { datascriptQuery: async (...args: unknown[]) => (sent.push(args), rows) } });
    expect(await kanbanWriteDeps().readChoice(UUID, OWNER)).toEqual({ id: 215, ident: null }); // user values have no ident
    expect(sent[0]).toEqual([choiceReadQuery(OWNER), `#uuid "${UUID}"`]);
    expect(choiceReadQuery(OWNER)).toBe(`[:find (pull ?b [:block/uuid {${OWNER} [:db/id :db/ident]}]) :in $ ?u :where [?b :block/uuid ?u]]`);
    // the shape seen live (2026-10-03) after removing built-in Status: the attribute points at the empty placeholder
    rows = [[{ uuid: UUID, ":logseq.property/status": { id: 10, ident: ":logseq.property/empty-placeholder" } }]];
    expect(await kanbanWriteDeps().readChoice(UUID, ":logseq.property/status")).toEqual({ id: 10, ident: ":logseq.property/empty-placeholder" });
  });

  it("accepts every ident Logseq generates (logseq normalize-ident-name-part: [0-9a-zA-Z*+!_'?<>=.-]) (T14)", () => {
    for (const ident of [":user.property/done?-aB3", ":user.property/a+b-x", ":user.property/who's-x", ":user.property/*<>=!_.-"]) {
      expect(choiceReadQuery(ident)).toContain(`{${ident} [:db/id :db/ident]}`);
    }
    for (const ident of [":user.property/a b", ":user.property/x]", ":user.property/x}", ":user.property/x\"y"]) expect(() => choiceReadQuery(ident)).toThrow(/ident/);
  });

  it("an absent value reads as null; a missing block or a malformed ident fails", async () => {
    let rows: unknown[] = [[{ uuid: UUID }]];
    vi.stubGlobal("logseq", { DB: { datascriptQuery: async () => rows } });
    expect(await kanbanWriteDeps().readChoice(UUID, OWNER)).toBeNull();
    rows = [];
    await expect(kanbanWriteDeps().readChoice(UUID, OWNER)).rejects.toThrow(/not found/);
    expect(() => choiceReadQuery("user.property/owner")).toThrow(/ident/);
    await expect(kanbanWriteDeps().readChoice("not-a-uuid", OWNER)).rejects.toThrow(/uuid/);
  });
});

describe("workspace frame starts under the host header (N15)", () => {
  const TOP = "var(--ls-headbar-height, 3rem)";
  const HEIGHT = "calc(100vh - var(--ls-headbar-height, 3rem))";
  const host = (el: unknown) => {
    const setMainUIInlineStyle = vi.fn();
    vi.stubGlobal("parent", { document: { querySelector: () => el } });
    vi.stubGlobal("logseq", { baseInfo: { id: "planner" }, setMainUIInlineStyle, showMainUI: vi.fn() });
    return setMainUIInlineStyle;
  };

  it("sets top and height from the host header variable, important, on the container (same-origin)", () => {
    const setProperty = vi.fn();
    host({ dataset: {}, style: { setProperty } });
    appDeps().showMainUI();
    expect(setProperty).toHaveBeenCalledWith("top", TOP, "important");
    expect(setProperty).toHaveBeenCalledWith("height", HEIGHT, "important");
    expect(setProperty).toHaveBeenCalledWith("position", "fixed", "important");
    expect(setProperty).toHaveBeenCalledWith("width", "100vw", "important");
    expect(setProperty.mock.calls.map(([k]) => k)).not.toContain("-webkit-app-region");
  });

  it("passes the same top and height to setMainUIInlineStyle on the cross-origin fallback", () => {
    const inline = host(null);
    appDeps().showMainUI();
    expect(inline).toHaveBeenCalledWith({
      position: "fixed", zIndex: "999", top: TOP, left: "0", right: "auto", width: "100vw", height: HEIGHT,
    });
    expect(Object.keys(inline.mock.calls[0][0])).not.toContain("WebkitAppRegion");
  });

  it("no longer reports macWindowButtons", () => {
    host(null);
    expect(appDeps()).not.toHaveProperty("macWindowButtons");
  });
});
