// @vitest-environment happy-dom
// N21: the workspace restores and saves the per-graph UI state. Its own file: happy-dom keeps memory for every
// re-rendered tree, and workspace.test.ts is already close to a worker's heap limit (tasks.md N24).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { defaultViewConfig, serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { StorageDeps, Surface, TagInfo } from "../types";
import { DEFAULT_PREFS, type UiPrefs, type UiStore } from "../ui-state";
import { createWorkspace, initialTag, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq, noDateWrites, noWrites } from "./test-fakes";

let tags: TagInfo[];
const tag = (title: string) => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
let root: HTMLElement;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const label = (sel: string) => $(sel)?.getAttribute("aria-label") ?? "";

const created: Workspace[] = [];
async function setup(opts: { storage?: StorageDeps; setSurface?: (surface: Surface) => void; prefs?: UiStore } = {}) {
  const store = createViewStore(opts.storage ?? fakeStorage());
  const ws = createWorkspace(root, { dq: fixtureDq(), views: store, onClose: vi.fn(), openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03", time: () => "13:30",
    kanban: noWrites, dates: noDateWrites, weekStart: async () => 0, setSurface: opts.setSurface, prefs: opts.prefs });
  created.push(ws);
  await ws.open();
  return { ws, store };
}
async function click(ws: Workspace, sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.click();
  await ws.idle();
}
/** Clicks the tag in the tree, opening the collapsed built-in group first when the tag is in it. */
async function pickTag(ws: Workspace, title: string) {
  if (tag(title).builtIn && $("[data-fold=built-in]")!.getAttribute("aria-expanded") === "false") await click(ws, "[data-fold=built-in]");
  await click(ws, `[data-tag-id="${tag(title).id}"]`);
}

beforeEach(async () => {
  (window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }).happyDOM.setViewport({ width: 1024 });
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => void created.splice(0).forEach((ws) => ws.stop()));

describe("per-graph UI state (N21)", () => {
  /** A fake store: `load` gives `stored`, `save` replaces it. */
  const fakePrefs = (stored: Partial<UiPrefs> = {}) => {
    const state = { stored: { ...DEFAULT_PREFS, ...stored } as UiPrefs };
    const prefs = { load: vi.fn(async () => state.stored), save: vi.fn((next: UiPrefs) => void (state.stored = next)) } satisfies UiStore;
    return { prefs, state };
  };
  const kanbanOfMeeting = () => ({ ...defaultViewConfig(tag("Meeting"), "kanban") });

  it("opens as it was left: panel, Edit dates, the view's settings and its saved view", async () => {
    const config = serializeViewConfig(defaultViewConfig(tag("Meeting")));
    const { prefs } = fakePrefs({ panel: { wide: false, narrow: false }, editDates: true, view: { id: "v1", config } });
    const { ws } = await setup({ prefs, storage: fakeStorage({ blocks: [{ uuid: "v1", name: "Meetings", config }] }) });
    expect(prefs.load).toHaveBeenCalledTimes(1);
    expect(ws.config()!.tags).toEqual([tag("Meeting").ident]);
    expect(label("[data-control=saved-views]")).toContain("Meetings");
    expect($("[data-action=toggle-panel]")!.getAttribute("aria-expanded")).toBe("false");
    expect($("[data-tl-edit]")!.getAttribute("aria-pressed")).toBe("true");
    expect($("[data-region=error]")).toBeNull();
  });

  it("restores the view's kind and settings without a saved view", async () => {
    const { prefs } = fakePrefs({ view: { id: null, config: serializeViewConfig(kanbanOfMeeting()) } });
    const { ws } = await setup({ prefs });
    expect(ws.config()).toEqual(kanbanOfMeeting());
    expect($("[data-view-kind=kanban]")!.getAttribute("aria-pressed")).toBe("true");
    expect(label("[data-control=saved-views]")).toContain("None");
  });

  it("a saved view that is gone leaves the settings; unreadable settings or a gone tag give the default view, without an error", async () => {
    const gone = await setup({ prefs: fakePrefs({ view: { id: "v9", config: serializeViewConfig(kanbanOfMeeting()) } }).prefs });
    expect(gone.ws.config()).toEqual(kanbanOfMeeting());
    expect(label("[data-control=saved-views]")).toContain("None");
    const unknown = { ...defaultViewConfig(tag("Meeting")), tags: [":user.class/gone"], dates: {} };
    for (const config of ["{nope", serializeViewConfig(unknown as never)]) {
      const { ws } = await setup({ prefs: fakePrefs({ view: { id: null, config } }).prefs });
      expect(ws.config()).toEqual(defaultViewConfig(initialTag(tags)!));
      expect($("[data-region=error]")).toBeNull();
    }
  });

  it("saves what changed, once per change, and nothing while it is still loading", async () => {
    const { prefs, state } = fakePrefs();
    const { ws } = await setup({ prefs });
    expect(prefs.save).toHaveBeenCalledTimes(1); // the default view it opened with
    expect(state.stored.view).toEqual({ id: null, config: serializeViewConfig(ws.config()!) });

    await pickTag(ws, "Meeting");
    expect(state.stored.view!.config).toBe(serializeViewConfig(ws.config()!));
    await click(ws, "[data-action=toggle-panel]");
    expect(state.stored.panel).toEqual({ wide: false, narrow: false });
    await click(ws, "[data-tl-edit]");
    expect(state.stored.editDates).toBe(true);
    const calls = prefs.save.mock.calls.length;
    await click(ws, "[data-control=saved-views]"); // a redraw that changes nothing kept
    expect(prefs.save).toHaveBeenCalledTimes(calls);

    $<HTMLInputElement>("[data-field=view-name]")!.value = "Mine";
    await click(ws, "[data-action=save-view]");
    expect(state.stored.view!.id).not.toBeNull();
  });

  it("restores the surface where the switch exists, and keeps the stored one where it does not", async () => {
    const setSurface = vi.fn();
    const desktop = fakePrefs({ surface: "sidebar" });
    await setup({ prefs: desktop.prefs, setSurface });
    expect(setSurface).toHaveBeenCalledWith("sidebar");
    expect($("[data-action=toggle-surface]")!.getAttribute("data-surface-to")).toBe("workspace");
    expect(desktop.state.stored.surface).toBe("sidebar");

    const web = fakePrefs({ surface: "sidebar" });
    const { ws } = await setup({ prefs: web.prefs }); // no switch: web app
    await pickTag(ws, "Meeting");
    expect(web.state.stored.surface).toBe("sidebar");
  });

  it("stores a surface picked with the switch", async () => {
    const { prefs, state } = fakePrefs();
    const { ws } = await setup({ prefs, setSurface: vi.fn() });
    expect(state.stored.surface).toBe("workspace");
    await click(ws, "[data-action=toggle-surface]");
    expect(state.stored.surface).toBe("sidebar");
  });

  it("after a graph switch (reset) the next open reads the new graph's state, defaults included", async () => {
    const { prefs, state } = fakePrefs({ panel: { wide: false, narrow: false }, editDates: true });
    const { ws } = await setup({ prefs });
    state.stored = { ...DEFAULT_PREFS, view: { id: null, config: serializeViewConfig(kanbanOfMeeting()) } };
    const saves = prefs.save.mock.calls.length;
    await ws.reset();
    expect(prefs.save).toHaveBeenCalledTimes(saves); // nothing of the old graph is written to the new one
    await ws.open();
    expect(prefs.load).toHaveBeenCalledTimes(2);
    expect(ws.config()).toEqual(kanbanOfMeeting());
    expect($("[data-action=toggle-panel]")!.getAttribute("aria-expanded")).toBe("true");
  });
});
