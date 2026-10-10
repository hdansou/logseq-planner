// @vitest-environment happy-dom
// N39: the compact header, the folded settings bar and focus mode. Its own file: happy-dom keeps memory for every
// re-rendered tree, and workspace.test.ts is already close to a worker's heap limit (tasks.md N24).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { Surface, TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq, noDateWrites, noWrites } from "./test-fakes";

let tags: TagInfo[];
let root: HTMLElement;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const created: Workspace[] = [];
const tag = (title: string) => tags.find((t) => t.title === title)!;

async function setup() {
  const store = createViewStore(fakeStorage());
  const ws = createWorkspace(root, { dq: fixtureDq(), views: store, onClose: vi.fn(), openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03", time: () => "13:30",
    kanban: noWrites, dates: noDateWrites, weekStart: async () => 0, setSurface: vi.fn((_: Surface) => {}) });
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
    expect(tabs.map((t) => t.dataset.viewKind)).toEqual(["timeline", "calendar", "agenda", "kanban"]);
    for (const t of tabs) {
      expect(t.querySelector("svg")).not.toBeNull();
      expect(t.getAttribute("aria-label")).toBe(t.querySelector(".pl-tab-label")!.textContent);
      expect(t.getAttribute("title")).toBe(t.getAttribute("aria-label"));
    }
    expect(tabs.filter((t) => t.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("the surface switch, Saved views, Panel and Close are in the ⋯ menu: shut until it opens, shut again on Escape", async () => {
    const ws = await setup();
    const more = $("[data-region=more]")!;
    expect(more.hasAttribute("hidden")).toBe(true);
    expect($("[data-control=more]")!.getAttribute("aria-expanded")).toBe("false");
    for (const sel of ["[data-surface=workspace]", "[data-surface=sidebar]", "[data-control=saved-views]", "[data-action=toggle-panel]", "[data-action=close]"]) {
      expect(more.querySelector(sel), sel).not.toBeNull();
    }
    await click("[data-control=more]", ws);
    expect($("[data-region=more]")!.hasAttribute("hidden")).toBe(false);
    expect($("[data-control=more]")!.getAttribute("aria-expanded")).toBe("true");
    expect(ws.escape()).toBe(true);
    await ws.idle();
    expect($("[data-region=more]")!.hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe($("[data-control=more]"));
  });

  it("Saved views opens inside the ⋯ menu and keeps it open; Panel closes it and still toggles the panel", async () => {
    const ws = await setup();
    await click("[data-control=more]", ws);
    await click("[data-control=saved-views]", ws);
    expect($("[data-region=more]")!.hasAttribute("hidden")).toBe(false);
    expect($("[data-region=more] [data-popover=views]")).not.toBeNull();
    const before = $("[data-action=toggle-panel]")!.getAttribute("aria-expanded");
    await click("[data-action=toggle-panel]", ws);
    expect($("[data-action=toggle-panel]")!.getAttribute("aria-expanded")).not.toBe(before);
    expect($("[data-region=more]")!.hasAttribute("hidden")).toBe(true);
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
