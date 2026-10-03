// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerApp } from "./app";
import type { AppDeps } from "./types";

/** Fake SDK: records every call; `defer` queues work so the test decides when it runs. */
function fakeDeps() {
  const deferred: Array<() => void> = [];
  const deps = {
    registerUIItem: vi.fn(),
    registerCommandPalette: vi.fn(),
    provideModel: vi.fn(),
    showMainUI: vi.fn(),
    hideMainUI: vi.fn(),
    theme: {
      later: vi.fn(),
      getUserConfigs: vi.fn(async () => ({ preferredThemeMode: "light" })),
      resolveThemeCssPropsVals: vi.fn(async () => ({})),
      onThemeModeChanged: vi.fn(),
      onThemeChanged: vi.fn(),
    },
    defer: vi.fn((fn: () => void) => void deferred.push(fn)),
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

  it("registers no default keybinding", () => {
    const { deps, flush } = fakeDeps();
    registerApp(deps, root);
    flush();
    expect(deps.registerCommandPalette.mock.calls[0][0]).not.toHaveProperty("keybinding");
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
});
