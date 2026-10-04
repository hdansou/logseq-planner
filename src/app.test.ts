// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nodeOpener, registerApp } from "./app";
import type { AppDeps } from "./types";
import tagsFixture from "./core/__fixtures__/tags.json";
import propsFixture from "./core/__fixtures__/class-properties.json";
import { TAG_PROPERTIES_QUERY, TAGS_QUERY } from "./core/schema";
import { DEBOUNCE_MS } from "./ui/changes";
import { fakeChangeFeed, fakeClock, fakeStorage } from "./ui/test-fakes";
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
  /** The off hooks the theme and visibility subscriptions return, by name. */
  const offs = { mode: vi.fn(), theme: vi.fn(), visible: vi.fn() };
  const deps = {
    registerUIItem: vi.fn(),
    registerCommandPalette: vi.fn(),
    provideModel: vi.fn(),
    showMainUI: vi.fn(),
    hideMainUI: vi.fn(),
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
    },
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
  return { deps, flush, clock, feed, visibility, unload, offs };
}

/** The model handler the toolbar button's `data-on-click` names. */
function modelHandler(deps: ReturnType<typeof fakeDeps>["deps"]): () => void {
  const [model] = deps.provideModel.mock.calls[0];
  const [, item] = deps.registerUIItem.mock.calls[0];
  const name = /data-on-click="([^"]+)"/.exec(item.template)![1];
  return model[name];
}

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
