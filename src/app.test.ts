// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nodeOpener, registerApp } from "./app";
import { dockFrame, dockHostStyle, HEADBAR, WORKSPACE_FRAME, workspaceFrame } from "./sdk";
import type { AppDeps, MacroSlotEvent, StorageDeps } from "./types";
import tagsFixture from "./core/__fixtures__/tags.json";
import propsFixture from "./core/__fixtures__/class-properties.json";
import { TAG_PROPERTIES_QUERY, TAGS_QUERY } from "./core/schema";
import { DEBOUNCE_MS } from "./ui/changes";
import { MACRO_TEXT, OPEN_NODE, OPEN_VIEW } from "./ui/block";
import { blockStyle } from "./ui/block-style";
import { fakeChangeFeed, fakeClock, fakeStorage, fixtureDq } from "./ui/test-fakes";
import { buildTagInfos } from "./core/schema";
import { defaultViewConfig, serializeViewConfig } from "./core/view-config";
import type { ViewBlock } from "./types";
import type { HostDocument } from "./ui/host-keys";
import { DEFAULT_PREFS, type UiPrefs } from "./ui-state";
import { Window } from "happy-dom";

/** Fake SDK: records every call; `defer` queues work so the test decides when it runs. */
function fakeDeps() {
  const deferred: Array<() => void> = [];
  const clock = fakeClock();
  const feed = fakeChangeFeed();
  const visibility: Array<(visible: boolean) => void> = [];
  const unload: Array<() => void> = [];
  /** The macro-renderer listeners the app registered (N06b). */
  const slotted: Array<(e: MacroSlotEvent) => void> = [];
  /** The off hooks the theme and visibility subscriptions return, by name. */
  const offs = { mode: vi.fn(), theme: vi.fn(), visible: vi.fn(), graph: vi.fn() };
  /** The `onCurrentGraphChanged` listeners the app registered. */
  const graphChanged: Array<() => void> = [];
  const deps = {
    registerUIItem: vi.fn(),
    registerCommandPalette: vi.fn(),
    provideModel: vi.fn(),
    onMacroRendererSlotted: vi.fn((cb: (e: MacroSlotEvent) => void) => void slotted.push(cb)),
    provideUI: vi.fn((ui: { key: string; slot: string; reset: true; template: string }) => void ui),
    provideStyle: vi.fn((style: { key: string; style: string }) => void style),
    registerSlashCommand: vi.fn((label: string, action: () => void) => void [label, action]),
    insertAtCursor: vi.fn(async (text: string) => void text),
    showMainUI: vi.fn(),
    hideMainUI: vi.fn(),
    setFrame: vi.fn((style: Record<string, string>) => void style),
    pluginId: vi.fn(() => "planner-test"),
    dockWidth: { read: vi.fn((): number | null => null), write: vi.fn((px: number) => void px) },
    openPage: vi.fn(),
    openInSidebar: vi.fn(),
    theme: {
      later: vi.fn(),
      getUserConfigs: vi.fn(async () => ({ preferredThemeMode: "light" })),
      resolveThemeCssPropsVals: vi.fn(async () => ({})),
      onThemeModeChanged: vi.fn(() => offs.mode),
      onThemeChanged: vi.fn(() => offs.theme),
    },
    defer: vi.fn((fn: () => void) => void deferred.push(fn)),
    later: vi.fn(),
    weekStart: vi.fn(async () => 1),
    // Tags from the T01 fixtures; no nodes anywhere.
    dq: vi.fn(async (query: string) => (query === TAGS_QUERY ? tagsFixture.query.detail : query === TAG_PROPERTIES_QUERY ? propsFixture.query.detail : [])),
    storage: {
      findPage: async () => null,
      createPage: async () => {},
      renamePage: async () => {},
      ensureConfigProperty: async () => {},
      listBlocks: async () => [],
      readBlock: async () => null,
      appendBlock: async () => null,
      setConfig: async () => {},
      removeBlock: async () => {},
      blockTags: async () => 0,
    } as StorageDeps,
    changes: {
      subscribe: feed.subscribe,
      later: clock.later,
      onVisibleChanged: (cb: (visible: boolean) => void) => (visibility.push(cb), offs.visible),
      onUnload: (cb: () => void) => void unload.push(cb),
      onGraphChanged: (cb: () => void) => (graphChanged.push(cb), offs.graph),
    },
    kanban: { upsertBlockProperty: async () => null, removeBlockProperty: async () => null, readChoice: async () => null },
    dates: { upsertBlockProperty: async () => null, removeBlockProperty: async () => null, createJournalPage: async () => null, readDate: async () => null },
    hostDocument: vi.fn((): HostDocument | null => null), // cross-origin unless a test gives it a host
    prefs: { graph: vi.fn(async () => "logseq_db_test"), read: vi.fn((): unknown => undefined), write: vi.fn((graph: string, prefs: UiPrefs) => void [graph, prefs]) },
    graphState: { read: vi.fn(async (): Promise<string | null> => null), write: vi.fn(async (_text: string) => {}) },
  } satisfies AppDeps;
  const flush = () => deferred.splice(0).forEach((fn) => fn());
  return { deps, flush, clock, feed, visibility, unload, offs, slotted, graphChanged };
}

/** The model handler the toolbar button's `data-on-click` names. */
function modelHandler(deps: ReturnType<typeof fakeDeps>["deps"]): () => void {
  const [model] = deps.provideModel.mock.calls[0] as unknown as [Record<string, () => void>];
  const [, item] = deps.registerUIItem.mock.calls[0];
  const name = /data-on-click="([^"]+)"/.exec(item.template)![1];
  return model[name];
}

/** The handlers registered with `provideModel`, by name. */
const modelOf = (deps: ReturnType<typeof fakeDeps>["deps"]) => deps.provideModel.mock.calls[0][0] as unknown as Record<string, (e: { dataset?: Record<string, string> }) => void>;
const fixtureProject = () => buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]).find((t) => t.title === "Project")!;
/** A saved Timeline view of #Project named "Roadmap". */
const roadmapView = (): ViewBlock => ({ uuid: "v1", name: "Roadmap", config: serializeViewConfig(defaultViewConfig(fixtureProject())) });

describe("registerApp", () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.append(root);
  });

  it("registers nothing until the deferred callback runs", () => {
    const { deps, flush } = fakeDeps();
    registerApp(deps, root);
    expect(deps.defer).toHaveBeenCalledTimes(1);
    expect(deps.registerUIItem).not.toHaveBeenCalled();
    expect(deps.registerCommandPalette).not.toHaveBeenCalled();
    expect(deps.provideModel).not.toHaveBeenCalled();

    flush();
    expect(deps.provideModel).toHaveBeenCalledTimes(1);
    expect(deps.registerUIItem).toHaveBeenCalledWith("toolbar", expect.objectContaining({ key: "planner-open" }));
    // The button draws Planner's own glyph (staggered bars), not a calendar: other plugins use the calendar icons.
    const [, item] = deps.registerUIItem.mock.calls[0];
    expect(item.template).toContain("<svg");
    expect(item.template).not.toMatch(/ti-calendar/);
    expect(deps.registerCommandPalette).toHaveBeenCalledWith(
      expect.objectContaining({ key: "planner-open", label: "Planner: open" }),
      expect.any(Function),
    );
  });

  it("binds g shift+p outside editing (free in the host keymap, gotcha 33)", () => {
    const { deps, flush } = fakeDeps();
    registerApp(deps, root);
    flush();
    expect(deps.registerCommandPalette.mock.calls[0][0].keybinding).toEqual({ binding: "g shift+p", mode: "non-editing" });
  });

  it("opening loads the workspace and moves focus into the frame", async () => {
    const { deps, flush } = fakeDeps();
    registerApp(deps, root);
    flush();
    modelHandler(deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-tag-group=own]")).not.toBeNull());
    expect(deps.dq).toHaveBeenCalledWith(TAGS_QUERY);
    expect(deps.weekStart).toHaveBeenCalledTimes(1); // the host's week start, read on every open
    expect(deps.later.mock.calls.map(([, ms]) => ms)).toEqual([50, 300, 800]);
  });

  it("sets no pl-mac-desktop class (N15)", () => {
    const { deps } = fakeDeps();
    registerApp(deps, root);
    expect(document.documentElement.classList.contains("pl-mac-desktop")).toBe(false);
  });

  it("the toolbar button toggles: a second click hides, a third shows again (N15)", () => {
    const { deps, flush } = fakeDeps();
    registerApp(deps, root);
    flush();
    const toggle = modelHandler(deps);
    toggle();
    expect(deps.showMainUI).toHaveBeenCalledTimes(1);
    toggle();
    expect(deps.hideMainUI).toHaveBeenCalledTimes(1);
    expect(deps.showMainUI).toHaveBeenCalledTimes(1);
    toggle();
    expect(deps.showMainUI).toHaveBeenCalledTimes(2);
  });

  it("the toolbar button shows after Escape or a host hide, and the palette command only opens (N15)", () => {
    const f = fakeDeps();
    registerApp(f.deps, root);
    f.flush();
    const toggle = modelHandler(f.deps);
    toggle();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    toggle();
    expect(f.deps.showMainUI).toHaveBeenCalledTimes(2);
    f.visibility.forEach((cb) => cb(false));
    toggle();
    expect(f.deps.showMainUI).toHaveBeenCalledTimes(3);
    const [, paletteAction] = f.deps.registerCommandPalette.mock.calls[0];
    paletteAction({} as never);
    paletteAction({} as never);
    expect(f.deps.showMainUI).toHaveBeenCalledTimes(5);
    expect(f.deps.hideMainUI).toHaveBeenCalledTimes(1); // only the Escape
  });

  it("Escape closes an open popover before it hides the main UI", async () => {
    const { deps, flush } = fakeDeps();
    registerApp(deps, root);
    flush();
    modelHandler(deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-control=tag]")).not.toBeNull());
    root.querySelector<HTMLButtonElement>("[data-control=tag]")!.click();
    await vi.waitFor(() => expect(root.querySelector("[data-popover=tag]")).not.toBeNull());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.querySelector("[data-popover=tag]")).toBeNull();
    expect(deps.hideMainUI).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(deps.hideMainUI).toHaveBeenCalledTimes(1);
  });

  it("narrow frame (N13): Escape closes a popover, then the panel drawer, then Planner; each Escape is prevented", async () => {
    const setViewport = (width: number) => (window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }).happyDOM.setViewport({ width });
    setViewport(500);
    try {
      const { deps, flush } = fakeDeps();
      registerApp(deps, root);
      flush();
      modelHandler(deps)();
      await vi.waitFor(() => expect(root.querySelector("[data-control=tag]")).not.toBeNull());
      root.querySelector<HTMLButtonElement>("[data-action=toggle-panel]")!.click();
      await vi.waitFor(() => expect(root.querySelector<HTMLElement>("[data-region=panel]")!.hidden).toBe(false));
      root.querySelector<HTMLButtonElement>("[data-control=tag]")!.click();
      await vi.waitFor(() => expect(root.querySelector("[data-popover=tag]")).not.toBeNull());
      const escape = () => {
        const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
        document.dispatchEvent(e);
        return e.defaultPrevented;
      };
      expect(escape()).toBe(true);
      expect(root.querySelector("[data-popover=tag]")).toBeNull();
      expect(root.querySelector<HTMLElement>("[data-region=panel]")!.hidden).toBe(false);
      expect(escape()).toBe(true);
      expect(root.querySelector<HTMLElement>("[data-region=panel]")!.hidden).toBe(true);
      expect(deps.hideMainUI).not.toHaveBeenCalled();
      expect(escape()).toBe(true);
      expect(deps.hideMainUI).toHaveBeenCalledTimes(1);
    } finally {
      setViewport(1024);
    }
  });

  it("opens the main UI from the toolbar button and the command palette", () => {
    const { deps, flush } = fakeDeps();
    registerApp(deps, root);
    flush();

    modelHandler(deps)();
    expect(deps.showMainUI).toHaveBeenCalledTimes(1);

    const [, paletteAction] = deps.registerCommandPalette.mock.calls[0];
    paletteAction({} as never);
    expect(deps.showMainUI).toHaveBeenCalledTimes(2);
  });

  it("renders an empty Planner workspace", () => {
    const { deps } = fakeDeps();
    registerApp(deps, root);
    expect(root.textContent).toContain("Planner");
  });

  it("hides the main UI on Escape", () => {
    const { deps } = fakeDeps();
    registerApp(deps, root);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(deps.hideMainUI).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const { deps } = fakeDeps();
    registerApp(deps, root);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(deps.hideMainUI).not.toHaveBeenCalled();
  });

  it("hides the main UI from the Close button", () => {
    const { deps } = fakeDeps();
    registerApp(deps, root);
    root.querySelector<HTMLButtonElement>("button[data-action=close]")!.click();
    expect(deps.hideMainUI).toHaveBeenCalledTimes(1);
  });

  it("a click opens the node in the main area and hides Planner; Shift+click opens it in the sidebar and keeps Planner open", () => {
    const { deps } = fakeDeps();
    const open = nodeOpener(deps);
    open("u-1", { sidebar: false });
    expect(deps.openPage).toHaveBeenCalledWith("u-1");
    expect(deps.hideMainUI).toHaveBeenCalledTimes(1);
    open("u-2", { sidebar: true });
    expect(deps.openInSidebar).toHaveBeenCalledWith("u-2");
    expect(deps.openPage).toHaveBeenCalledTimes(1);
    expect(deps.hideMainUI).toHaveBeenCalledTimes(1);
  });
});

describe("live updates (T12)", () => {
  const tagQueries = (deps: ReturnType<typeof fakeDeps>["deps"]) => deps.dq.mock.calls.filter(([q]) => q === TAGS_QUERY).length;
  const opened = async () => {
    const f = fakeDeps();
    registerApp(f.deps, root);
    f.flush();
    modelHandler(f.deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-tag-group=own]")).not.toBeNull());
    return f;
  };
  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.append(root);
  });
  let root: HTMLElement;

  it("subscribes only after the deferred registrations, and a change while open reloads once", async () => {
    const f = fakeDeps();
    registerApp(f.deps, root);
    expect(f.feed.count()).toBe(0);
    f.flush();
    expect(f.feed.count()).toBe(1);
    modelHandler(f.deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-tag-group=own]")).not.toBeNull());
    expect(tagQueries(f.deps)).toBe(1);
    f.feed.fire();
    f.feed.fire();
    f.clock.advance(DEBOUNCE_MS);
    await vi.waitFor(() => expect(tagQueries(f.deps)).toBe(2));
  });

  it("closing (Escape) stops the refreshes; reopening reloads once because a change came in meanwhile", async () => {
    const f = await opened();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(f.deps.hideMainUI).toHaveBeenCalled();
    f.feed.fire();
    f.clock.advance(DEBOUNCE_MS * 2);
    await new Promise((r) => setTimeout(r, 0));
    expect(tagQueries(f.deps)).toBe(1);
    modelHandler(f.deps)();
    await vi.waitFor(() => expect(tagQueries(f.deps)).toBe(2));
  });

  it("reopening after a stale hide reloads once: the queries of one load, no second reload (N04)", async () => {
    const f = fakeDeps();
    f.deps.dq.mockImplementation(fixtureDq() as never);
    registerApp(f.deps, root);
    f.flush();
    modelHandler(f.deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-tag-group=own]")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    const since = f.deps.dq.mock.calls.length;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    f.visibility.forEach((cb) => cb(false)); // the host's own visibility events follow the hide and the show
    f.feed.fire(); // a change while hidden: stale
    f.feed.fire();
    modelHandler(f.deps)();
    f.visibility.forEach((cb) => cb(true));
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); // let any further reload run
    const queries = f.deps.dq.mock.calls.slice(since).map(([q]) => q);
    expect(queries.filter((q) => q === TAGS_QUERY)).toHaveLength(1);
    // Exactly one load's worth: the tags and their properties are asked once each.
    expect(queries.filter((q) => q === TAG_PROPERTIES_QUERY)).toHaveLength(1);
  });

  it("the host's visibility event drives it too (hidden by the host, then shown)", async () => {
    const f = await opened();
    f.visibility.forEach((cb) => cb(false));
    f.feed.fire();
    f.clock.advance(DEBOUNCE_MS * 2);
    await new Promise((r) => setTimeout(r, 0));
    expect(tagQueries(f.deps)).toBe(1);
    f.visibility.forEach((cb) => cb(true));
    await vi.waitFor(() => expect(tagQueries(f.deps)).toBe(2));
  });

  it("saved views are listed afresh on every show: one added or deleted on another device shows after hide + show (T14)", async () => {
    const project = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]).find((t) => t.title === "Project")!;
    const config = serializeViewConfig(defaultViewConfig(project));
    const blocks: ViewBlock[] = [{ uuid: "v1", name: "Roadmap", config }];
    const f = fakeDeps();
    const deps = { ...f.deps, storage: fakeStorage({ blocks }) };
    registerApp(deps, root);
    f.flush();
    modelHandler(f.deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-tag-group=own]")).not.toBeNull());
    const listed = async () => {
      (root.querySelector("[data-control=saved-views]") as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 0));
      const ids = [...root.querySelectorAll<HTMLElement>("[data-view-open]")].map((b) => b.dataset.viewOpen);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // close the menu
      return ids;
    };
    const hideAndShow = async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      modelHandler(f.deps)();
      await new Promise((r) => setTimeout(r, 0));
    };
    expect(await listed()).toEqual(["v1"]);
    blocks.push({ uuid: "v2", name: "Meetings", config }); // written by another device
    await hideAndShow();
    await vi.waitFor(async () => expect(await listed()).toEqual(["v1", "v2"]));
    blocks.splice(0, 1); // deleted on another device
    await hideAndShow();
    await vi.waitFor(async () => expect(await listed()).toEqual(["v2"]));
  });

  /** The fixture graph without its own tags: the built-in tags only, no properties (another graph in the same session). */
  const otherGraphDq = () => async (query: string) =>
    query === TAGS_QUERY ? (tagsFixture.query.detail as Array<Record<string, unknown>[]>).filter((row) => (row[0] as Record<string, unknown>)[":logseq.property/built-in?"]) : [];

  describe("a graph change (N04)", () => {
    /** Graph A shows the saved view "Roadmap" on #Project; the test then switches the dq and the stored views to graph B. */
    async function onGraphA() {
      const blocks: ViewBlock[] = [roadmapView()];
      const f = fakeDeps();
      f.deps.storage = fakeStorage({ blocks });
      f.deps.dq.mockImplementation(fixtureDq() as never);
      registerApp(f.deps, root);
      f.flush();
      modelOf(f.deps)[OPEN_VIEW]({ dataset: { viewId: "v1" } });
      await vi.waitFor(() => expect(root.querySelector("[data-control=tag]")!.textContent).toContain("Project"));
      return { f, blocks };
    }
    const switchToB = (f: ReturnType<typeof fakeDeps>, blocks: ViewBlock[]) => {
      f.deps.dq.mockImplementation(otherGraphDq() as never);
      blocks.splice(0);
    };

    it("while Planner is shown: the new graph's default view, no error bar, its saved views listed", async () => {
      const { f, blocks } = await onGraphA();
      switchToB(f, blocks);
      expect(f.graphChanged).toHaveLength(1);
      f.graphChanged[0]();
      await vi.waitFor(() => expect(root.querySelector("[data-control=tag]")!.textContent).not.toContain("Project"));
      expect(root.querySelector("[data-region=error]")).toBeNull();
      expect(root.querySelector("[data-control=saved-views]")!.getAttribute("aria-label")).toContain("None");
      (root.querySelector("[data-control=saved-views]") as HTMLElement).click();
      await vi.waitFor(() => expect(root.querySelector("[data-popover=views]")!.textContent).toContain("No saved views yet"));
    });

    it("while Planner is hidden: the next show starts fresh, with no error bar", async () => {
      const { f, blocks } = await onGraphA();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // hide
      switchToB(f, blocks);
      f.graphChanged[0]();
      modelHandler(f.deps)(); // show
      await vi.waitFor(() => expect(root.querySelector("[data-control=tag]")!.textContent).not.toContain("Project"));
      expect(root.querySelector("[data-region=error]")).toBeNull();
      expect(root.querySelector("[data-control=saved-views]")!.getAttribute("aria-label")).toContain("None");
    });

    it("the in-page blocks forget the old graph's slots", async () => {
      const f = fakeDeps();
      f.deps.storage = fakeStorage({ blocks: [roadmapView()] });
      f.deps.dq.mockImplementation(fixtureDq() as never);
      registerApp(f.deps, root);
      f.flush();
      f.slotted.forEach((cb) => cb({ slot: "slot__a", payload: { arguments: [":planner", "Roadmap"], uuid: "block-a" } }));
      await vi.waitFor(() => expect(f.deps.provideUI).toHaveBeenCalledTimes(1));
      f.graphChanged[0]();
      f.feed.fire();
      f.clock.advance(DEBOUNCE_MS);
      await new Promise((r) => setTimeout(r, 20));
      expect(f.deps.provideUI).toHaveBeenCalledTimes(1); // no slot left to draw into
    });

    it("unload unhooks the listener", async () => {
      const { f } = await onGraphA();
      f.unload.forEach((cb) => cb());
      expect(f.offs.graph).toHaveBeenCalledTimes(1);
    });
  });

  it("unload also unhooks the theme and visibility listeners (T14)", async () => {
    const f = await opened();
    await new Promise((r) => setTimeout(r, 0)); // watchTheme registers, then reads the configs
    f.unload.forEach((cb) => cb());
    await new Promise((r) => setTimeout(r, 0));
    expect(f.offs.mode).toHaveBeenCalledTimes(1);
    expect(f.offs.theme).toHaveBeenCalledTimes(1);
    expect(f.offs.visible).toHaveBeenCalledTimes(1);
  });

  it("unload removes the workspace's window resize listener (N12 connectors)", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const f = await opened();
    f.unload.forEach((cb) => cb());
    expect(remove.mock.calls.some(([type]) => type === "resize")).toBe(true);
    remove.mockRestore();
  });

  it("unload unsubscribes and cancels the timers", async () => {
    const f = await opened();
    f.feed.fire();
    f.unload.forEach((cb) => cb());
    expect(f.feed.count()).toBe(0);
    expect(f.clock.pending()).toBe(0);
  });

  describe("host shortcuts (N16)", () => {
    /** A second window as the host; `seen` is what reached its body. */
    function withHost() {
      const f = fakeDeps();
      const host = new Window().document as unknown as HostDocument;
      const seen: KeyboardEvent[] = [];
      host.body.addEventListener("keydown", (e) => void seen.push(e));
      f.deps.hostDocument.mockReturnValue(host);
      registerApp(f.deps, root);
      f.flush();
      return { ...f, seen };
    }
    const key = (target: Element, key: string, init: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      return e;
    };

    it("Cmd+K from a toolbar button reaches the host; Escape with an open popover does not", async () => {
      const f = withHost();
      modelHandler(f.deps)();
      await vi.waitFor(() => expect(root.querySelector("[data-control=tag]")).not.toBeNull());
      const button = root.querySelector<HTMLButtonElement>("[data-control=tag]")!;
      key(button, "k", { metaKey: true });
      expect(f.seen.map((e) => e.key)).toEqual(["k"]);
      button.click();
      await vi.waitFor(() => expect(root.querySelector("[data-popover=tag]")).not.toBeNull());
      const escape = key(root.querySelector("[data-control=tag]")!, "Escape"); // the button was re-rendered
      expect(root.querySelector("[data-popover=tag]")).toBeNull();
      expect(escape.defaultPrevented).toBe(true);
      expect(f.seen.map((e) => e.key)).toEqual(["k"]);
      f.unload.forEach((cb) => cb());
    });

    it("focus falling to the host body while Planner is shown focuses the frame; hidden, it does not", async () => {
      const f = fakeDeps();
      const host = new Window().document as unknown as HostDocument;
      host.hasFocus = () => true;
      f.deps.hostDocument.mockReturnValue(host);
      const focus = vi.spyOn(window, "focus");
      registerApp(f.deps, root);
      f.flush();
      const focusOut = async () => {
        host.body.dispatchEvent(new Event("focusout", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 5));
      };
      await focusOut();
      expect(focus).not.toHaveBeenCalled(); // not shown yet
      modelHandler(f.deps)();
      focus.mockClear();
      await focusOut();
      expect(focus).toHaveBeenCalledTimes(1);
      modelHandler(f.deps)(); // toggles: hidden
      focus.mockClear();
      await focusOut();
      expect(focus).not.toHaveBeenCalled();
      f.unload.forEach((cb) => cb());
      focus.mockRestore();
    });

    it("unload removes the forwarder", () => {
      const f = withHost();
      f.unload.forEach((cb) => cb());
      key(document.body, "k", { metaKey: true });
      expect(f.seen).toHaveLength(0);
    });

    it("a cross-origin frame installs nothing", () => {
      const f = fakeDeps();
      const add = vi.spyOn(document, "addEventListener");
      registerApp(f.deps, root);
      expect(add.mock.calls.filter(([type]) => type === "keyup")).toHaveLength(0);
      add.mockRestore();
    });
  });
});

describe("opening a node while docked (N43)", () => {
  it("nodeOpener keeps Planner open when told to", () => {
    const { deps } = fakeDeps();
    nodeOpener(deps, () => true)("u-1", { sidebar: false });
    expect(deps.openPage).toHaveBeenCalledWith("u-1");
    expect(deps.hideMainUI).not.toHaveBeenCalled();
  });
});

describe("sidebar surface beside the host's sidebar (N40)", () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.append(root);
  });

  /** A second window as the host (1500 px wide), with Logseq's own right sidebar in it, which Planner must leave alone. */
  function docked(views: ViewBlock[] = [], userAgent?: string) {
    const f = fakeDeps();
    if (views.length) {
      f.deps.storage = fakeStorage({ blocks: views });
      f.deps.dq.mockImplementation(fixtureDq() as never);
    }
    const win = new Window(userAgent ? { settings: { navigator: { userAgent } } } : undefined);
    win.happyDOM.setViewport({ width: 1500, height: 900 });
    const host = win.document as unknown as HostDocument & Document;
    host.body.innerHTML = `<div id="right-sidebar" class="cp__right-sidebar closed"><div class="resizer"></div></div>`;
    const sidebar = host.querySelector<HTMLElement>("#right-sidebar")!;
    f.deps.hostDocument.mockReturnValue(host);
    registerApp(f.deps, root);
    f.flush();
    const lastFrame = () => f.deps.setFrame.mock.lastCall?.[0];
    const styles = () => f.deps.provideStyle.mock.calls.map(([x]) => x).filter((x) => x.key === "planner-dock");
    const lastStyle = () => styles()[styles().length - 1]?.style;
    const noDrag = () => f.deps.provideStyle.mock.calls.map(([x]) => x).filter((x) => x.key === "planner-no-drag");
    return { ...f, win, host, sidebar, lastFrame, lastStyle, styles, noDrag };
  }
  const DOCKED = (width: number, offset = 0) => dockFrame(width, HEADBAR, offset);
  const switchTo = (surface: "workspace" | "sidebar") => {
    const dock = root.querySelector<HTMLButtonElement>("[data-action=toggle-surface]")!;
    if (dock.getAttribute("data-surface-to") === surface) dock.click();
  };
  const opened = async (d: ReturnType<typeof docked>) => {
    modelHandler(d.deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-action=toggle-surface]")).not.toBeNull());
  };
  const ptr = (type: string, clientX: number) =>
    root.querySelector("[data-dock-resize]")!.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, button: 0, bubbles: true }));

  it("a node opened while docked leaves Planner docked; back in the workspace it hides Planner again (N43)", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    modelOf(d.deps)[OPEN_NODE]({ dataset: { uuid: "u-1" } });
    expect(d.deps.openPage).toHaveBeenCalledWith("u-1");
    expect(d.deps.hideMainUI).not.toHaveBeenCalled();
    expect(d.lastStyle()).toBe(dockHostStyle("planner-test", 600, true));
    switchTo("workspace");
    modelOf(d.deps)[OPEN_NODE]({ dataset: { uuid: "u-2" } });
    expect(d.deps.hideMainUI).toHaveBeenCalledTimes(1);
  });

  it("on macOS the workspace covers the whole window, so the host controls behind it cannot be clicked, and the header leaves room for the window buttons (N57)", async () => {
    const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/30";
    const mac = docked([], MAC);
    modelHandler(mac.deps)();
    expect(mac.lastFrame()).toEqual(workspaceFrame("0px"));
    // N59: the host header is a window drag region and swallows real clicks on what is drawn over it: no-drag while Planner covers it
    expect(mac.noDrag().slice(-1)[0]!.style).toContain("-webkit-app-region: no-drag");
    expect(root.getAttribute("data-window-controls")).toBe("left");
    await vi.waitFor(() => expect(root.querySelector("[data-action=toggle-surface]")).not.toBeNull());
    switchTo("sidebar"); // docked on the right edge: the window buttons are far away
    expect(root.hasAttribute("data-window-controls")).toBe(false);
    expect(mac.noDrag().slice(-1)[0]!.style).toBe(""); // the header is not under Planner any more
    switchTo("workspace");
    expect(mac.lastFrame()).toEqual(workspaceFrame("0px"));
    expect(mac.noDrag().slice(-1)[0]!.style).toContain("no-drag");
    expect(root.getAttribute("data-window-controls")).toBe("left");
    const other = docked([], "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/30");
    modelHandler(other.deps)();
    expect(other.lastFrame()).toEqual(WORKSPACE_FRAME);
    expect(other.noDrag()).toEqual([]);
    expect(root.hasAttribute("data-window-controls")).toBe(false);
  });

  it("opening in the workspace mode applies the workspace frame and reserves nothing", async () => {
    const d = docked();
    modelHandler(d.deps)();
    expect(d.deps.setFrame).toHaveBeenCalledWith(WORKSPACE_FRAME);
    expect(d.deps.setFrame.mock.invocationCallOrder[0]).toBeLessThan(d.deps.showMainUI.mock.invocationCallOrder[0]);
    expect(d.styles()).toEqual([]);
    expect(root.querySelector("[data-dock-resize]")).toBeNull();
  });

  it("on macOS the docked frame starts at the top of the window, where the header has nothing to show beside it (N49); elsewhere it stays under the header", async () => {
    const mac = docked([], "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/30");
    await opened(mac);
    switchTo("sidebar");
    expect(mac.lastFrame()).toEqual(dockFrame(600, "0px"));
    const other = docked([], "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Electron/30");
    await opened(other);
    switchTo("sidebar");
    expect(other.lastFrame()).toEqual(dockFrame(600, HEADBAR));
  });

  it("Sidebar docks at the right edge, 40% of the window, and reserves that strip in the host layout; the host's sidebar is not touched", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    expect(d.lastFrame()).toEqual(DOCKED(600));
    expect(d.lastStyle()).toBe(dockHostStyle("planner-test", 600, true));
    expect(d.sidebar.className).toBe("cp__right-sidebar closed");
    expect(root.querySelector("[data-action=toggle-surface]")!.getAttribute("data-surface-to")).toBe("workspace");
    expect(root.querySelector(".pl-ws")!.getAttribute("data-surface-mode")).toBe("sidebar");
    expect(root.querySelector("[data-dock-resize]")!.getAttribute("role")).toBe("separator");
  });

  it("the graph's last surface comes back on the first open: Sidebar docks without a click, and a switch is stored (N21)", async () => {
    const d = docked();
    d.deps.prefs.read.mockReturnValue({ logseq_db_test: { ...DEFAULT_PREFS, surface: "sidebar" } });
    await opened(d);
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED(600)));
    expect(root.querySelector("[data-action=toggle-surface]")!.getAttribute("data-surface-to")).toBe("workspace");
    switchTo("workspace");
    await vi.waitFor(() => expect(d.deps.prefs.write.mock.lastCall![1].surface).toBe("workspace"));
    expect(d.deps.prefs.write.mock.lastCall![0]).toBe("logseq_db_test");
  });

  it("a width kept on this device is used, within the allowed range", async () => {
    const d = docked();
    d.deps.dockWidth.read.mockReturnValue(480);
    await opened(d);
    switchTo("sidebar");
    expect(d.lastFrame()).toEqual(DOCKED(480));
    switchTo("workspace");
    d.deps.dockWidth.read.mockReturnValue(5000);
    switchTo("sidebar");
    expect(d.lastFrame()).toEqual(DOCKED(1140)); // the window less the page's 360 px
  });

  /** Another plugin's docked frame on the window's right edge, `width` px wide (the host is 1500 px wide). */
  const neighbour = (d: ReturnType<typeof docked>, width: number, visible = true, seq?: number) => {
    const el = d.host.createElement("div");
    if (seq !== undefined) el.setAttribute("data-dock-seq", String(seq));
    el.className = "lsp-iframe-sandbox-container" + (visible ? " visible" : "");
    el.setAttribute("data-pid", "outline-canvas");
    el.getBoundingClientRect = () => ({ left: 1500 - width, right: 1500, width, top: 0, bottom: 900, height: 900 }) as DOMRect;
    d.host.body.append(el);
    return el;
  };

  it("another docked plugin already there: Planner docks to its left and reserves both strips (N44)", async () => {
    const d = docked();
    neighbour(d, 300);
    await opened(d);
    switchTo("sidebar");
    expect(d.lastFrame()).toEqual(DOCKED(480, 300)); // 40% of the room left of the neighbour
    expect(d.lastStyle()).toBe(dockHostStyle("planner-test", 480, true, 300, 1));
    expect(d.lastStyle()).toContain("margin-right: 780px");
  });

  it("another plugin showing, resizing or hiding while Planner is docked moves Planner and the reserved strip (N44)", async () => {
    const d = docked();
    const other = neighbour(d, 300, false);
    await opened(d);
    switchTo("sidebar");
    expect(d.lastFrame()).toEqual(DOCKED(600));
    other.classList.add("visible");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED(600, 300)));
    expect(d.lastStyle()).toBe(dockHostStyle("planner-test", 600, true, 300, 1));
    other.getBoundingClientRect = () => ({ left: 900, right: 1500, width: 600 }) as DOMRect;
    other.setAttribute("style", "width: 600px");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED(540, 600))); // the page keeps its 360 px
    other.classList.remove("visible");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED(600)));
    expect(d.lastStyle()).toBe(dockHostStyle("planner-test", 600, true));
  });

  it("Planner stamps its frame when it docks and takes the stamp off when it closes; a plugin docked after it does not move it (N44)", async () => {
    const d = docked();
    const own = d.host.createElement("div");
    own.className = "lsp-iframe-sandbox-container visible";
    own.setAttribute("data-pid", "planner-test");
    d.host.body.append(own);
    neighbour(d, 300, true, 4);
    await opened(d);
    switchTo("sidebar");
    expect(own.getAttribute("data-dock-seq")).toBe("5");
    neighbour(d, 500, true, 6); // docked after Planner: it yields to Planner, not the other way round
    await new Promise((r) => setTimeout(r, 30));
    expect(d.lastFrame()).toEqual(DOCKED(480, 300));
    expect(d.lastStyle()).toBe(dockHostStyle("planner-test", 480, true, 300, 1));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(own.hasAttribute("data-dock-seq")).toBe(false);
  });

  it("stops watching other plugins when Planner closes (N44)", async () => {
    const d = docked();
    const other = neighbour(d, 300, false);
    await opened(d);
    switchTo("sidebar");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const frames = d.deps.setFrame.mock.calls.length;
    other.classList.add("visible");
    await new Promise((r) => setTimeout(r, 30));
    expect(d.deps.setFrame.mock.calls.length).toBe(frames);
  });

  it("Logseq's own sidebar opening, closing and resizing does not move, hide or close Planner", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    const frames = d.deps.setFrame.mock.calls.length;
    d.sidebar.className = "cp__right-sidebar open";
    d.sidebar.className = "cp__right-sidebar closed";
    d.win.dispatchEvent(new d.win.Event("resize"));
    await new Promise((r) => setTimeout(r, 5));
    expect(d.deps.hideMainUI).not.toHaveBeenCalled();
    expect(d.deps.setFrame.mock.calls.length).toBe(frames + 1); // only the window's own resize re-clamps the width
    expect(d.lastFrame()).toEqual(DOCKED(600));
  });

  it("a smaller window pulls a too wide Planner in, so the page keeps its room", async () => {
    const d = docked();
    d.deps.dockWidth.read.mockReturnValue(1000);
    await opened(d);
    switchTo("sidebar");
    expect(d.lastFrame()).toEqual(DOCKED(1000));
    d.win.happyDOM.setViewport({ width: 1200, height: 900 });
    d.win.dispatchEvent(new d.win.Event("resize"));
    expect(d.lastFrame()).toEqual(DOCKED(840));
    expect(d.lastStyle()).toContain("margin-right: 840px");
  });

  it("closing Planner in the sidebar mode (Escape, Close, toolbar) gives the strip back and keeps the mode; the next open reserves it again", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    const frames = d.deps.setFrame.mock.calls.length;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(d.deps.hideMainUI).toHaveBeenCalledTimes(1);
    expect(d.lastStyle()).toBe("");
    modelHandler(d.deps)(); // the toolbar button: Planner was hidden, so it opens
    expect(d.lastStyle()).toBe(dockHostStyle("planner-test", 600, true));
    expect(d.lastFrame()).toEqual(DOCKED(600));
    root.querySelector<HTMLButtonElement>("[data-action=close]")!.click();
    expect(d.lastStyle()).toBe("");
    modelHandler(d.deps)();
    modelHandler(d.deps)(); // toggles off
    expect(d.lastStyle()).toBe("");
    expect(d.deps.setFrame.mock.calls.slice(frames).map(([x]) => x)).not.toContainEqual(WORKSPACE_FRAME);
  });

  it("switching back to Workspace restores the workspace frame and gives the strip back", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    switchTo("workspace");
    expect(d.lastFrame()).toEqual(WORKSPACE_FRAME);
    expect(d.lastStyle()).toBe("");
    expect(d.deps.hideMainUI).not.toHaveBeenCalled();
    expect(root.querySelector(".pl-ws")!.getAttribute("data-surface-mode")).toBe("workspace");
    expect(root.querySelector("[data-dock-resize]")).toBeNull();
  });

  it("Open in Planner from a page block (N06b) leaves the sidebar mode: workspace frame, strip given back, that view selected", async () => {
    const d = docked([roadmapView()]);
    await opened(d);
    switchTo("sidebar");
    modelOf(d.deps)[OPEN_VIEW]({ dataset: { viewId: "v1" } });
    expect(d.lastFrame()).toEqual(WORKSPACE_FRAME);
    expect(d.lastStyle()).toBe("");
    await vi.waitFor(() => expect(root.querySelector("[data-control=saved-views]")!.getAttribute("aria-label")).toContain("Roadmap"));
    expect(root.querySelector("[data-action=toggle-surface]")!.getAttribute("data-surface-to")).toBe("sidebar");
  });

  it("dragging the handle widens the frame and the reserved strip together without animation, and keeps the width on release", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    ptr("pointerdown", 2);
    ptr("pointermove", -48);
    expect(d.lastFrame()).toEqual(DOCKED(650));
    expect(d.lastStyle()).toBe(dockHostStyle("planner-test", 650, false));
    ptr("pointermove", -48); // the frame moved left with the pointer: another 50 px reads the same
    expect(d.lastFrame()).toEqual(DOCKED(700));
    ptr("pointerup", -48);
    expect(d.deps.dockWidth.write).toHaveBeenCalledWith(700);
    expect(d.lastStyle()).toBe(dockHostStyle("planner-test", 700, true));
    switchTo("workspace");
    switchTo("sidebar");
    expect(d.lastFrame()).toEqual(DOCKED(700)); // this session remembers it even before the settings answer
  });

  it("unload gives the strip back and stops listening to the handle", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    d.unload.forEach((cb) => cb());
    expect(d.lastStyle()).toBe("");
    const frames = d.deps.setFrame.mock.calls.length;
    ptr("pointerdown", 2);
    ptr("pointermove", -50);
    expect(d.deps.setFrame.mock.calls.length).toBe(frames);
  });

  it("a cross-origin frame has no switch", async () => {
    const f = fakeDeps();
    registerApp(f.deps, root);
    f.flush();
    modelHandler(f.deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-tag-group=own]")).not.toBeNull());
    expect(root.querySelector("[data-action=toggle-surface]")).toBeNull();
  });
});

describe("in-page block (N06b)", () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.append(root);
  });

  /** The app with a saved view "Roadmap" and the fixture graph; the deferred registrations run. */
  function withView() {
    const f = fakeDeps();
    f.deps.storage = fakeStorage({ blocks: [roadmapView()] });
    f.deps.dq.mockImplementation(fixtureDq() as never);
    registerApp(f.deps, root);
    f.flush();
    const slot = (id: string, args = [":planner", "Roadmap"]) => f.slotted.forEach((cb) => cb({ slot: id, payload: { arguments: args, uuid: `block-${id}` } }));
    return { ...f, slot };
  }

  it("registers nothing until the deferred callback runs; then the macro listener, the scoped styles once and the slash command", () => {
    const f = fakeDeps();
    registerApp(f.deps, root);
    expect(f.deps.onMacroRendererSlotted).not.toHaveBeenCalled();
    expect(f.deps.provideStyle).not.toHaveBeenCalled();
    f.flush();
    expect(f.deps.onMacroRendererSlotted).toHaveBeenCalledTimes(1);
    expect(f.deps.provideStyle).toHaveBeenCalledTimes(1);
    expect(f.deps.provideStyle).toHaveBeenCalledWith({ key: "planner-block", style: blockStyle() });
    expect(f.deps.registerSlashCommand).toHaveBeenCalledWith("Planner view", expect.any(Function));
  });

  it("the slash command inserts the macro at the caret, for the user to type the view's name", () => {
    const f = fakeDeps();
    registerApp(f.deps, root);
    f.flush();
    f.deps.registerSlashCommand.mock.calls[0][1]();
    expect(f.deps.insertAtCursor).toHaveBeenCalledWith("{{renderer :planner, }}");
    expect(MACRO_TEXT).toBe("{{renderer :planner, }}");
  });

  it("a Planner macro draws the saved view into its slot, Planner hidden", async () => {
    const f = withView();
    f.slot("slot__a");
    await vi.waitFor(() => expect(f.deps.provideUI).toHaveBeenCalledTimes(1));
    const [ui] = f.deps.provideUI.mock.calls[0];
    expect(ui).toMatchObject({ key: "planner-block-slot__a", slot: "slot__a", reset: true });
    expect(ui.template).toContain('data-view-kind="timeline"');
    expect(f.deps.showMainUI).not.toHaveBeenCalled();
  });

  it("a graph change redraws the blocks while Planner is hidden, through the one DB.onChanged subscription", async () => {
    const f = withView();
    expect(f.feed.count()).toBe(1); // the workspace and the blocks share it
    f.slot("slot__a");
    await vi.waitFor(() => expect(f.deps.provideUI).toHaveBeenCalledTimes(1));
    f.feed.fire();
    f.clock.advance(DEBOUNCE_MS);
    await vi.waitFor(() => expect(f.deps.provideUI).toHaveBeenCalledTimes(2));
  });

  it("a click on an item opens the node (plain open, Planner hidden)", () => {
    const f = fakeDeps();
    registerApp(f.deps, root);
    f.flush();
    modelOf(f.deps)[OPEN_NODE]({ dataset: { uuid: "u-1" } });
    expect(f.deps.openPage).toHaveBeenCalledWith("u-1");
    expect(f.deps.openInSidebar).not.toHaveBeenCalled();
    expect(f.deps.hideMainUI).toHaveBeenCalledTimes(1);
    expect(() => modelOf(f.deps)[OPEN_NODE]({ dataset: {} })).toThrow(/uuid/);
  });

  it("Open in Planner shows Planner with that saved view selected", async () => {
    const f = withView();
    modelOf(f.deps)[OPEN_VIEW]({ dataset: { viewId: "v1" } });
    expect(f.deps.showMainUI).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(root.querySelector("[data-control=saved-views]")!.getAttribute("aria-label")).toContain("Roadmap"));
    expect(root.querySelector("[data-view-kind=timeline]")!.getAttribute("aria-pressed")).toBe("true");
    expect(() => modelOf(f.deps)[OPEN_VIEW]({ dataset: {} })).toThrow(/view id/);
  });

  it("unload stops the blocks' refreshes too", async () => {
    const f = withView();
    f.slot("slot__a");
    await vi.waitFor(() => expect(f.deps.provideUI).toHaveBeenCalledTimes(1));
    f.unload.forEach((cb) => cb());
    expect(f.feed.count()).toBe(0);
    expect(f.clock.pending()).toBe(0);
  });
});
