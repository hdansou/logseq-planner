// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nodeOpener, registerApp } from "./app";
import type { AppDeps } from "./types";
import tagsFixture from "./core/__fixtures__/tags.json";
import propsFixture from "./core/__fixtures__/class-properties.json";
import { TAG_PROPERTIES_QUERY, TAGS_QUERY } from "./core/schema";

/** Fake SDK: records every call; `defer` queues work so the test decides when it runs. */
function fakeDeps() {
  const deferred: Array<() => void> = [];
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
      onThemeModeChanged: vi.fn(),
      onThemeChanged: vi.fn(),
    },
    defer: vi.fn((fn: () => void) => void deferred.push(fn)),
    later: vi.fn(),
    macWindowButtons: false,
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
    },
  } satisfies AppDeps;
  const flush = () => deferred.splice(0).forEach((fn) => fn());
  return { deps, flush };
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

  it("marks the frame for the macOS window buttons on desktop", () => {
    const { deps } = fakeDeps();
    registerApp({ ...deps, macWindowButtons: true }, root);
    expect(document.documentElement.classList.contains("pl-mac-desktop")).toBe(true);
    document.documentElement.classList.remove("pl-mac-desktop");
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
