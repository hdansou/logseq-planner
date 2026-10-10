import { afterEach, describe, expect, it, vi } from "vitest";
import { appDeps, BLOCK_TAGS_QUERY, choiceReadQuery, clampDockWidth, dateReadQuery, dateWriteDeps, defaultDockWidth, dockFrame, dockHostStyle, DOCK_MIN_PX, DOCK_PAGE_MIN_PX, HEADBAR, hostWeekStart, journalDayOfArg, journalPageQuery, kanbanWriteDeps, pageQuery, storageDeps, WORKSPACE_FRAME } from "./sdk";

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
    appDeps().setFrame(WORKSPACE_FRAME);
    expect(setProperty).toHaveBeenCalledWith("top", TOP, "important");
    expect(setProperty).toHaveBeenCalledWith("height", HEIGHT, "important");
    expect(setProperty).toHaveBeenCalledWith("position", "fixed", "important");
    expect(setProperty).toHaveBeenCalledWith("width", "100vw", "important");
    expect(setProperty.mock.calls.map(([k]) => k)).not.toContain("-webkit-app-region");
  });

  it("passes the same top and height to setMainUIInlineStyle on the cross-origin fallback", () => {
    const inline = host(null);
    appDeps().setFrame(WORKSPACE_FRAME);
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

describe("sidebar surface beside the host's sidebar (N40)", () => {
  it("the docked frame sits on the right edge, under the header, as fixed px", () => {
    expect(dockFrame(600, HEADBAR)).toEqual({
      position: "fixed", zIndex: "999", top: "var(--ls-headbar-height, 3rem)", height: "calc(100vh - var(--ls-headbar-height, 3rem))",
      right: "0", left: "auto", width: "600px",
    });
  });

  it("the width starts at 40% of the window and stays between a usable minimum and the window less room for the page", () => {
    expect(defaultDockWidth(1500)).toBe(600);
    expect(defaultDockWidth(1777)).toBe(711);
    expect(clampDockWidth(100, 1500)).toBe(DOCK_MIN_PX);
    expect(clampDockWidth(5000, 1500)).toBe(1500 - DOCK_PAGE_MIN_PX);
    expect(clampDockWidth(512.4, 1500)).toBe(512);
    expect(clampDockWidth(400, 500)).toBe(DOCK_MIN_PX); // a window too small for both: the minimum wins
  });

  it("the host rule reserves the strip on the app wrapper only while Planner's container is visible, and does not touch the host's toggle", () => {
    const css = dockHostStyle("planner", 600, true);
    expect(css).toContain(':root body:has(.lsp-iframe')
    expect(css).toContain('body:has(.lsp-iframe-sandbox-container.visible[data-pid="planner"]) #app-container-wrapper');
    expect(css).toContain("margin-right: 600px !important");
    expect(css).toContain("transition: margin-right 0.2s ease");
    expect(css).not.toContain("Toggle right sidebar");
    expect(dockHostStyle("planner", 612, false)).toContain("transition: none");
  });

  it("N44: beside another docked plugin the frame is offset and the strip is both widths, with a rule that outranks the neighbour's", () => {
    expect(dockFrame(500, HEADBAR, 300).right).toBe("300px");
    expect(dockFrame(500, HEADBAR).right).toBe("0");
    const css = dockHostStyle("planner", 500, true, 300);
    expect(css).toContain("margin-right: 800px !important");
    expect(css.startsWith(":root body:has(")).toBe(true);
    // one more `:root` per frame docked before this one, so the innermost plugin's rule (the widest strip) outranks the others'
    expect(dockHostStyle("planner", 500, true, 300, 2).startsWith(":root:root:root body:has(")).toBe(true);
  });

  it("the docked frame goes on the container, important, like the workspace frame", () => {
    const setProperty = vi.fn();
    vi.stubGlobal("parent", { document: { querySelector: () => ({ dataset: {}, style: { setProperty } }) } });
    vi.stubGlobal("logseq", { baseInfo: { id: "planner" }, setMainUIInlineStyle: vi.fn() });
    appDeps().setFrame(dockFrame(600, HEADBAR));
    expect(setProperty).toHaveBeenCalledWith("right", "0", "important");
    expect(setProperty).toHaveBeenCalledWith("width", "600px", "important");
    expect(setProperty).toHaveBeenCalledWith("left", "auto", "important");
    expect(setProperty).toHaveBeenCalledWith("z-index", "999", "important");
  });

  it("showMainUI only shows: the frame is the app's choice (setFrame)", () => {
    const setProperty = vi.fn();
    const showMainUI = vi.fn();
    vi.stubGlobal("parent", { document: { querySelector: () => ({ dataset: {}, style: { setProperty } }) } });
    vi.stubGlobal("logseq", { baseInfo: { id: "planner" }, setMainUIInlineStyle: vi.fn(), showMainUI });
    appDeps().showMainUI();
    expect(showMainUI).toHaveBeenCalledWith({ autoFocus: true });
    expect(setProperty).not.toHaveBeenCalled();
  });

  it("the width is kept in the plugin's settings, per device: read tolerantly, written as a number", () => {
    const updateSettings = vi.fn();
    vi.stubGlobal("logseq", { baseInfo: { id: "planner" }, settings: { dockWidth: 480 }, updateSettings });
    const d = appDeps();
    expect(d.dockWidth.read()).toBe(480);
    d.dockWidth.write(512);
    expect(updateSettings).toHaveBeenCalledWith({ dockWidth: 512 });
    vi.stubGlobal("logseq", { baseInfo: { id: "planner" }, settings: { dockWidth: "wide" } });
    expect(appDeps().dockWidth.read()).toBeNull();
    vi.stubGlobal("logseq", { baseInfo: { id: "planner" } });
    expect(appDeps().dockWidth.read()).toBeNull();
    expect(appDeps().pluginId()).toBe("planner");
  });
});

describe("date writes (N06c; write probe 2026-10-04)", () => {
  const UUID = "6a000000-0000-4000-8000-000000000001";
  const START = ":user.property/start-Sd0PMVjj";

  it("passes the key and the value of a property write through unchanged", async () => {
    const upsertBlockProperty = vi.fn(async () => null);
    vi.stubGlobal("logseq", { Editor: { upsertBlockProperty } });
    await dateWriteDeps().upsertBlockProperty(UUID, "user.property/start-Sd0PMVjj", 1791041400000);
    expect(upsertBlockProperty).toHaveBeenCalledWith(UUID, "user.property/start-Sd0PMVjj", 1791041400000);
  });

  describe("the day's journal page (N19: looked up by journal day, createJournalPage's return value is not used)", () => {
    const QUERY = "[:find ?p :where [?p :block/journal-day 20261201]]";
    /** A fake host: `pages` are the journal page ids the query finds; `create` is what createJournalPage does. */
    const host = (pages: number[], create: () => unknown = () => null) => {
      const state = { pages, queries: [] as string[] };
      const createJournalPage = vi.fn(async (date: string) => (void date, create()));
      vi.stubGlobal("logseq", { Editor: { createJournalPage }, DB: { datascriptQuery: async (q: string) => (state.queries.push(q), state.pages.map((id) => [id])) } });
      return { state, createJournalPage };
    };

    it("an existing page is found by its day and nothing is created", async () => {
      const h = host([412]);
      expect(await dateWriteDeps().createJournalPage("2026-12-01T12:00:00")).toEqual({ id: 412 });
      expect(h.state.queries).toEqual([QUERY]);
      expect(h.createJournalPage).not.toHaveBeenCalled();
    });

    it("a missing page is created with the argument as given, then found, although the host returned null (stable app b09316a)", async () => {
      const h = host([]);
      h.createJournalPage.mockImplementation(async () => (h.state.pages = [512], null));
      expect(await dateWriteDeps().createJournalPage("2026-12-01T12:00:00")).toEqual({ id: 512 });
      expect(h.createJournalPage).toHaveBeenCalledWith("2026-12-01T12:00:00");
    });

    it("waits for a page that shows up a little later, and gives null when it never does", async () => {
      vi.useFakeTimers();
      try {
        const late = host([]);
        const found = dateWriteDeps().createJournalPage("2026-12-01T12:00:00");
        await vi.advanceTimersByTimeAsync(250);
        late.state.pages = [7];
        await vi.advanceTimersByTimeAsync(200);
        expect(await found).toEqual({ id: 7 });

        host([]);
        const never = dateWriteDeps().createJournalPage("2026-12-01T12:00:00");
        await vi.advanceTimersByTimeAsync(2000);
        expect(await never).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("two pages of one day: the older one (lower id)", async () => {
      host([900, 412]);
      expect(await dateWriteDeps().createJournalPage("2026-12-01T12:00:00")).toEqual({ id: 412 });
    });

    it("builds the query from a checked day and rejects anything else", () => {
      expect(journalDayOfArg("2026-12-01T12:00:00")).toBe(20261201);
      expect(journalDayOfArg("2026-12-01")).toBe(20261201);
      expect(() => journalDayOfArg("Dec 1st, 2026")).toThrow(/journal date/);
      expect(journalPageQuery(20261201)).toBe(QUERY);
      for (const bad of [NaN, 1.5, 2026, -20261201]) expect(() => journalPageQuery(bad)).toThrow(/journal day/);
    });
  });

  it("reads a Date back as its journal page id and day, a DateTime as epoch ms, by uuid with a #uuid input", async () => {
    const sent: unknown[][] = [];
    let rows: unknown[] = [[{ uuid: UUID, [START]: { id: 199, "journal-day": 20260923 } }]];
    vi.stubGlobal("logseq", { DB: { datascriptQuery: async (...args: unknown[]) => (sent.push(args), rows) } });
    expect(await dateWriteDeps().readDate(UUID, START, "date")).toEqual({ id: 199, journalDay: 20260923 });
    expect(sent[0]).toEqual([`[:find (pull ?b [:block/uuid {${START} [:db/id :block/journal-day]}]) :in $ ?u :where [?b :block/uuid ?u]]`, `#uuid "${UUID}"`]);
    rows = [[{ uuid: UUID, [START]: 1791041400000 }]];
    expect(await dateWriteDeps().readDate(UUID, START, "datetime")).toBe(1791041400000);
    expect(sent[1][0]).toBe(`[:find (pull ?b [:block/uuid ${START}]) :in $ ?u :where [?b :block/uuid ?u]]`);
    expect(dateReadQuery(START, "datetime")).toBe(sent[1][0]);
  });

  it("an absent value reads as null; a missing block, a malformed ident or uuid fails", async () => {
    let rows: unknown[] = [[{ uuid: UUID }]];
    vi.stubGlobal("logseq", { DB: { datascriptQuery: async () => rows } });
    expect(await dateWriteDeps().readDate(UUID, START, "date")).toBeNull();
    rows = [];
    await expect(dateWriteDeps().readDate(UUID, START, "date")).rejects.toThrow(/not found/);
    expect(() => dateReadQuery("user.property/start", "date")).toThrow(/ident/);
    await expect(dateWriteDeps().readDate("not-a-uuid", START, "datetime")).rejects.toThrow(/uuid/);
  });
});
