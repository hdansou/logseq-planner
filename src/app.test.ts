// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nodeOpener, registerApp } from "./app";
import { WORKSPACE_FRAME } from "./sdk";
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
  const offs = { mode: vi.fn(), theme: vi.fn(), visible: vi.fn() };
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
    setRightSidebarVisible: vi.fn((visible: boolean) => void visible),
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
    },
    kanban: { upsertBlockProperty: async () => null, removeBlockProperty: async () => null, readChoice: async () => null },
    hostDocument: vi.fn((): HostDocument | null => null), // cross-origin unless a test gives it a host
  } satisfies AppDeps;
  const flush = () => deferred.splice(0).forEach((fn) => fn());
  return { deps, flush, clock, feed, visibility, unload, offs, slotted };
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

describe("sidebar surface (N06a)", () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.append(root);
  });

  /** A ResizeObserver the test can fire (happy-dom's never calls back); installed as the host window's constructor. */
  class FakeResizeObserver {
    static all: FakeResizeObserver[] = [];
    targets: Element[] = [];
    connected = true;
    constructor(private cb: ResizeObserverCallback) {
      FakeResizeObserver.all.push(this);
    }
    observe(t: Element) {
      this.targets.push(t);
    }
    unobserve() {}
    disconnect() {
      this.connected = false;
    }
    fire() {
      if (this.connected) this.cb([], this as never);
    }
  }

  /**
   * A second window as the host, with Logseq's right sidebar (closed) and its resizer measured as on the desktop app
   * (1777 px window, sidebar 40% = 711 px). `setRightSidebarVisible` flips the sidebar's class as the host does.
   */
  function docked(views: ViewBlock[] = []) {
    FakeResizeObserver.all = [];
    const f = fakeDeps();
    if (views.length) {
      f.deps.storage = fakeStorage({ blocks: views });
      f.deps.dq.mockImplementation(fixtureDq() as never);
    }
    const win = new Window();
    const host = win.document as unknown as HostDocument & Document;
    host.body.innerHTML = `<div id="right-sidebar" class="cp__right-sidebar closed"><div class="resizer"></div></div>`;
    const sidebar = host.querySelector<HTMLElement>("#right-sidebar")!;
    let box = { left: 1066, width: 711 };
    const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 48, bottom: 900, height: 852, x: left, y: 48 }) as DOMRect;
    sidebar.getBoundingClientRect = () => rect(box.left, box.width);
    sidebar.querySelector<HTMLElement>(".resizer")!.getBoundingClientRect = () => rect(box.left + 1, 3);
    (win as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
    const mutations: Array<{ connected: boolean }> = [];
    const HostMutationObserver = win.MutationObserver;
    (win as unknown as { MutationObserver: unknown }).MutationObserver = class extends HostMutationObserver {
      state = { connected: true };
      constructor(cb: MutationCallback) {
        super(cb as never);
        mutations.push(this.state);
      }
      disconnect() {
        this.state.connected = false;
        super.disconnect();
      }
    };
    const setOpen = (open: boolean) => (sidebar.className = `cp__right-sidebar ${open ? "open" : "closed"}`);
    f.deps.setRightSidebarVisible.mockImplementation((v: boolean) => void setOpen(v));
    f.deps.hostDocument.mockReturnValue(host);
    registerApp(f.deps, root);
    f.flush();
    const resize = (left: number, width: number) => {
      box = { left, width };
      FakeResizeObserver.all.forEach((o) => o.fire());
    };
    const lastFrame = () => f.deps.setFrame.mock.lastCall?.[0];
    const connected = () => FakeResizeObserver.all.filter((o) => o.connected).length + mutations.filter((m) => m.connected).length;
    return { ...f, win, host, sidebar, setOpen, resize, lastFrame, connected, setBox: (left: number, width: number) => (box = { left, width }) };
  }
  const DOCKED = { position: "fixed", zIndex: "999", top: "var(--ls-headbar-height, 3rem)", height: "calc(100vh - var(--ls-headbar-height, 3rem))", left: "1072px", width: "705px", right: "auto" };
  const switchTo = (surface: "workspace" | "sidebar") => root.querySelector<HTMLButtonElement>(`[data-surface=${surface}]`)!.click();
  const opened = async (d: ReturnType<typeof docked>) => {
    modelHandler(d.deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-surface=sidebar]")).not.toBeNull());
  };

  it("opening in the workspace mode applies the workspace frame, then shows", () => {
    const f = fakeDeps();
    registerApp(f.deps, root);
    f.flush();
    modelHandler(f.deps)();
    expect(f.deps.setFrame).toHaveBeenCalledWith(WORKSPACE_FRAME);
    expect(f.deps.setFrame.mock.invocationCallOrder[0]).toBeLessThan(f.deps.showMainUI.mock.invocationCallOrder[0]);
    expect(f.deps.setRightSidebarVisible).not.toHaveBeenCalled();
  });

  it("a cross-origin frame has no switch", async () => {
    const f = fakeDeps();
    registerApp(f.deps, root);
    f.flush();
    modelHandler(f.deps)();
    await vi.waitFor(() => expect(root.querySelector("[data-tag-group=own]")).not.toBeNull());
    expect(root.querySelector("[data-surface]")).toBeNull();
  });

  it("Sidebar opens the host's sidebar and lays the frame over it, right of the resizer", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    expect(d.deps.setRightSidebarVisible).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED));
    expect(FakeResizeObserver.all[0].targets).toEqual([d.sidebar]);
    expect(root.querySelector("[data-surface=sidebar]")!.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector(".pl-ws")!.getAttribute("data-surface-mode")).toBe("sidebar");
  });

  it("an already open sidebar docks at once", async () => {
    const d = docked();
    d.setOpen(true);
    await opened(d);
    switchTo("sidebar");
    expect(d.lastFrame()).toEqual(DOCKED);
  });

  it("follows the sidebar: a resize of it and a window resize re-apply the frame", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED));
    d.resize(900, 877);
    expect(d.lastFrame()).toMatchObject({ left: "906px", width: "871px" });
    d.setBox(1000, 777);
    d.win.dispatchEvent(new d.win.Event("resize"));
    expect(d.lastFrame()).toMatchObject({ left: "1006px", width: "771px" });
  });

  it("the host closing its sidebar hides Planner and keeps the mode; the next open docks again", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED));
    d.setOpen(false); // the user closes Logseq's sidebar
    await vi.waitFor(() => expect(d.deps.hideMainUI).toHaveBeenCalledTimes(1));
    expect(d.connected()).toBe(0);
    expect(d.deps.setRightSidebarVisible).not.toHaveBeenCalledWith(false);
    const frames = d.deps.setFrame.mock.calls.length;
    modelHandler(d.deps)(); // the toolbar button: Planner was hidden, so it opens
    expect(d.deps.showMainUI).toHaveBeenCalledTimes(2);
    expect(d.deps.setRightSidebarVisible).toHaveBeenCalledTimes(2);
    expect(d.deps.setFrame.mock.calls.slice(frames).map(([s]) => s)).not.toContainEqual(WORKSPACE_FRAME);
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED));
    expect(root.querySelector("[data-surface=sidebar]")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("closing Planner in the sidebar mode (Escape, Close, toolbar) disconnects the observers and leaves the host's sidebar open", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED));
    const removed = vi.spyOn(d.win, "removeEventListener");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(d.deps.hideMainUI).toHaveBeenCalledTimes(1);
    expect(d.connected()).toBe(0);
    expect(removed.mock.calls.some(([type]) => type === "resize")).toBe(true);
    expect(d.sidebar.classList.contains("open")).toBe(true);
    expect(d.deps.setRightSidebarVisible).not.toHaveBeenCalledWith(false);
    // Close button and toolbar toggle take the same path
    modelHandler(d.deps)();
    await vi.waitFor(() => expect(d.connected()).toBe(2));
    root.querySelector<HTMLButtonElement>("[data-action=close]")!.click();
    expect(d.connected()).toBe(0);
    modelHandler(d.deps)();
    await vi.waitFor(() => expect(d.connected()).toBe(2));
    modelHandler(d.deps)();
    expect(d.connected()).toBe(0);
    expect(d.deps.setRightSidebarVisible).not.toHaveBeenCalledWith(false);
  });

  it("switching back to Workspace restores the workspace frame, disconnects, and leaves the host's sidebar as it is", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED));
    switchTo("workspace");
    expect(d.lastFrame()).toEqual(WORKSPACE_FRAME);
    expect(d.connected()).toBe(0);
    expect(d.sidebar.classList.contains("open")).toBe(true);
    expect(d.deps.setRightSidebarVisible).toHaveBeenCalledTimes(1);
    d.resize(900, 877); // no longer followed
    expect(d.lastFrame()).toEqual(WORKSPACE_FRAME);
    expect(d.deps.hideMainUI).not.toHaveBeenCalled();
    expect(root.querySelector(".pl-ws")!.getAttribute("data-surface-mode")).toBe("workspace");
  });

  it("Open in Planner from a page block (N06b) leaves the sidebar mode: workspace frame, that view selected", async () => {
    const d = docked([roadmapView()]);
    await opened(d);
    switchTo("sidebar");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED));
    modelOf(d.deps)[OPEN_VIEW]({ dataset: { viewId: "v1" } });
    expect(d.lastFrame()).toEqual(WORKSPACE_FRAME);
    await vi.waitFor(() => expect(root.querySelector("[data-control=saved-views]")!.textContent).toContain("Roadmap"));
    expect(root.querySelector(".pl-ws")!.getAttribute("data-surface-mode")).toBe("workspace");
    expect(root.querySelector("[data-surface=workspace]")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("unload disconnects the observers", async () => {
    const d = docked();
    await opened(d);
    switchTo("sidebar");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED));
    d.unload.forEach((cb) => cb());
    expect(d.connected()).toBe(0);
  });

  it("the focus hand-back does not fire once the host's closed sidebar hid Planner", async () => {
    const d = docked();
    d.host.hasFocus = () => true;
    await opened(d);
    switchTo("sidebar");
    await vi.waitFor(() => expect(d.lastFrame()).toEqual(DOCKED));
    d.setOpen(false);
    await vi.waitFor(() => expect(d.deps.hideMainUI).toHaveBeenCalledTimes(1));
    const focus = vi.spyOn(window, "focus");
    d.host.body.dispatchEvent(new d.win.Event("focusout", { bubbles: true }) as never);
    await new Promise((r) => setTimeout(r, 5));
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
    d.unload.forEach((cb) => cb());
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
    await vi.waitFor(() => expect(root.querySelector("[data-control=saved-views]")!.textContent).toContain("Roadmap"));
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
