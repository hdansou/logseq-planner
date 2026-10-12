// @vitest-environment happy-dom
// N39: the compact header, the folded settings bar and focus mode. Its own file: happy-dom keeps memory for every
// re-rendered tree, and workspace.test.ts is already close to a worker's heap limit (tasks.md N24).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { Surface, TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import workspaceCss from "./workspace.css?inline";
import { fakeStorage, fixtureDq, noDateWrites, noWrites } from "./test-fakes";

let tags: TagInfo[];
let root: HTMLElement;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const created: Workspace[] = [];
const tag = (title: string) => tags.find((t) => t.title === title)!;

async function setup(opts: { setSurface?: (s: Surface) => void } = {}) {
  const store = createViewStore(fakeStorage());
  const ws = createWorkspace(root, { dq: fixtureDq(), views: store, onClose: vi.fn(), openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03", time: () => "13:30",
    kanban: noWrites, dates: noDateWrites, weekStart: async () => 0, setSurface: opts.setSurface ?? vi.fn((_: Surface) => {}) });
  created.push(ws);
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`, ws);
  return ws;
}
async function click(sel: string, ws: Workspace) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.click();
  await ws.idle();
}

beforeEach(async () => {
  (window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }).happyDOM.setViewport({ width: 1024 });
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => void created.splice(0).forEach((ws) => ws.stop()));

describe("compact header (N39)", () => {
  it("the view tabs carry an icon, a name for assistive technology and a label span; one is pressed", async () => {
    await setup();
    const tabs = $$("[data-view-kind]");
    expect(tabs.map((t) => t.dataset.viewKind)).toEqual(["timeline", "calendar", "agenda", "kanban", "matrix"]);
    for (const t of tabs) {
      expect(t.querySelector("svg")).not.toBeNull();
      expect(t.getAttribute("aria-label")).toBe(t.querySelector(".pl-tab-label")!.textContent);
      expect(t.getAttribute("title")).toBe(t.getAttribute("aria-label"));
    }
    expect(tabs.filter((t) => t.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("no ⋯ menu: focus, settings, Panel, dock, Saved views and Close are icon buttons in the top bar, each named", async () => {
    await setup();
    expect($("[data-control=more]")).toBeNull();
    expect($("[data-region=more]")).toBeNull();
    const bar = $("[data-region=topbar]")!;
    for (const sel of ["[data-action=toggle-focus]", "[data-action=toggle-settings]", "[data-action=toggle-panel]", "[data-action=toggle-surface]", "[data-control=saved-views]", "[data-action=close]"]) {
      const b = bar.querySelector(sel);
      expect(b, sel).not.toBeNull();
      expect(b!.classList.contains("pl-ibtn"), sel).toBe(true);
      expect(b!.querySelector("svg") ?? b!.textContent, sel).toBeTruthy();
      expect(b!.getAttribute("aria-label"), sel).toBeTruthy();
      expect(b!.getAttribute("title"), sel).toBe(b!.getAttribute("aria-label"));
    }
  });

  it("the icons sit in their own group, which the narrow layout wraps under the tabs", async () => {
    await setup();
    const group = $("[data-region=topbar] .pl-tools")!;
    expect(group.querySelectorAll(".pl-ibtn")).toHaveLength(6);
    expect($("[data-region=topbar] .pl-tabs")!.contains(group)).toBe(false);
  });

  it("Saved views is its own popover from the top bar: opens on click, shuts on Escape with focus back on the button", async () => {
    const ws = await setup();
    expect($("[data-popover=views]")).toBeNull();
    await click("[data-control=saved-views]", ws);
    expect($("[data-region=topbar] [data-popover=views]")).not.toBeNull();
    expect($("[data-control=saved-views]")!.getAttribute("aria-expanded")).toBe("true");
    expect(ws.escape()).toBe(true);
    await ws.idle();
    expect($("[data-popover=views]")).toBeNull();
    expect(document.activeElement).toBe($("[data-control=saved-views]"));
  });

  it("the dock button names where it goes: Dock to the right, then Back to the workspace", async () => {
    const setSurface = vi.fn();
    const ws = await setup({ setSurface });
    expect($("[data-action=toggle-surface]")!.getAttribute("data-surface-to")).toBe("sidebar");
    await click("[data-action=toggle-surface]", ws);
    expect(setSurface).toHaveBeenLastCalledWith("sidebar");
    expect($("[data-action=toggle-surface]")!.getAttribute("data-surface-to")).toBe("workspace");
    expect($("[data-action=toggle-surface]")!.getAttribute("aria-label")).toBe("Back to the workspace");
    expect(document.activeElement).toBe($("[data-action=toggle-surface]"));
    await click("[data-action=toggle-surface]", ws);
    expect(setSurface).toHaveBeenLastCalledWith("workspace");
    expect($("[data-action=toggle-surface]")!.getAttribute("data-surface-to")).toBe("sidebar");
  });

  it("the Panel button is an icon named Panel; hidden, it shows the ticked filters as a badge", async () => {
    const ws = await setup();
    const btn = () => $("[data-action=toggle-panel]")!;
    expect(btn().getAttribute("aria-label")).toBe("Panel");
    expect(btn().querySelector(".pl-badge")).toBeNull();
    await click("[data-action=toggle-panel]", ws);
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    expect(btn().querySelector(".pl-badge")).toBeNull(); // nothing ticked
  });
});

describe("folded settings (N39)", () => {
  it("the settings bar starts folded; ⚙ opens it in place and its menus still work", async () => {
    const ws = await setup();
    const gear = () => $("[data-action=toggle-settings]")!;
    expect($("[data-region=settings]")!.hasAttribute("hidden")).toBe(true);
    expect([gear().getAttribute("aria-expanded"), gear().getAttribute("aria-controls")]).toEqual(["false", "pl-settings"]);
    await click("[data-action=toggle-settings]", ws);
    expect($("[data-region=settings]")!.hasAttribute("hidden")).toBe(false);
    expect(gear().getAttribute("aria-expanded")).toBe("true");
    await click("[data-control=tag]", ws);
    expect($("[data-popover=tag]")).not.toBeNull();
    await click("[data-action=toggle-settings]", ws);
    expect($("[data-region=settings]")!.hasAttribute("hidden")).toBe(true);
  });

  it("it is session state: not in the view config", async () => {
    const ws = await setup();
    await click("[data-action=toggle-settings]", ws);
    expect(serializeViewConfig(ws.config()!)).not.toMatch(/settings|focus/i);
  });
});

describe("focus mode (N39)", () => {
  it("⤢ hides the header, the settings and the view toolbar behind one strip that names the view; ⌄ brings them back", async () => {
    const ws = await setup();
    const regions = ["topbar", "settings", "view-toolbar"];
    expect($("[data-region=focus-strip]")!.hasAttribute("hidden")).toBe(true);
    expect($("[data-action=toggle-focus]")!.getAttribute("aria-pressed")).toBe("false");
    await click("[data-action=toggle-focus]", ws);
    for (const r of regions) expect($(`[data-region=${r}]`)!.hasAttribute("hidden"), r).toBe(true);
    const strip = $("[data-region=focus-strip]")!;
    expect(strip.hasAttribute("hidden")).toBe(false);
    expect(strip.textContent).toContain("#Project");
    expect(strip.textContent).toMatch(/Timeline/);
    expect($("[data-region=view]")!.children.length).toBeGreaterThan(0); // the view is still there
    await click("[data-focus-show]", ws);
    for (const r of regions) expect($(`[data-region=${r}]`)!.hasAttribute("hidden"), r).toBe(r === "settings");
    expect($("[data-region=focus-strip]")!.hasAttribute("hidden")).toBe(true);
  });

  it("focus survives a view change and a reload of the data, and is not saved with a view", async () => {
    const ws = await setup();
    await click("[data-action=toggle-focus]", ws);
    $("[data-view-kind=kanban]")!.click();
    await ws.idle();
    expect($("[data-region=focus-strip]")!.hasAttribute("hidden")).toBe(false);
    expect($("[data-region=focus-strip]")!.textContent).toMatch(/Kanban/);
    await ws.refresh();
    expect($("[data-region=topbar]")!.hasAttribute("hidden")).toBe(true);
    expect(serializeViewConfig(ws.config()!)).not.toMatch(/focus/i);
  });
});

describe("window buttons (N57)", () => {
  it("the top rows leave room at the left for the window buttons when the workspace covers the header", () => {
    expect(workspaceCss).toMatch(/\[data-window-controls="left"\]\s+\.pl-top[^{]*{[^}]*padding-left:\s*(8\d|9\d|1\d\d)px/);
    expect(workspaceCss).toMatch(/\[data-window-controls="left"\]\s+\.pl-strip/);
  });
});
