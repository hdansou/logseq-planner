// @vitest-environment happy-dom
// N77: the panel with many tags (owner, sketch D of four): the status line, Find and Added pinned at the top; every
// heading but Find folds, with Logseq's block bullet, and names what is on in it while folded; Tags folded to the view's
// chips with a tag search over Your tags and Built-in tags; the strip above the view is gone. Its own file:
// workspace.test.ts is near a worker's heap limit (N24).
// #Project (fixtures): Website relaunch, Mobile app, Acme rollout, Archive cleanup. Today Sat 3 Oct 2026, UTC-5.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { DEFAULT_PREFS, type UiPrefs, type UiStore } from "../ui-state";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage } from "./test-fakes";
import workspaceCss from "./workspace.css?inline";
import themeCss from "./theme.css?inline";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
const created: Workspace[] = [];
const tag = (title: string) => tags.find((x) => x.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const open = (key: string) => $(`[data-fold="${key}"]`)!.getAttribute("aria-expanded") === "true";
const bodyHidden = (key: string) => document.getElementById($(`[data-fold="${key}"]`)!.getAttribute("aria-controls")!)!.hidden;

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await ws.idle();
}
async function change(sel: string, checked = true) {
  const el = $<HTMLInputElement>(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.checked = checked;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await ws.idle();
}
async function type(sel: string, value: string) {
  const el = $<HTMLInputElement>(sel)!;
  el.focus();
  el.value = value;
  el.setSelectionRange(value.length, value.length);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await ws.idle();
}

/** A fake prefs store: `load` gives `stored`, `save` replaces it. */
const fakePrefs = (stored: Partial<UiPrefs> = {}) => {
  const state = { stored: { ...DEFAULT_PREFS, ...stored } as UiPrefs };
  const prefs = { load: vi.fn(async () => state.stored), save: vi.fn((next: UiPrefs) => void (state.stored = next)) } satisfies UiStore;
  return { prefs, state };
};

async function start(prefs?: UiStore) {
  const graph = fakeGraph();
  ws = createWorkspace(root, {
    dq: graph.dq, kanban: graph.writes, dates: graph.dates, views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03",
    weekStart: async () => 0, prefs,
  });
  created.push(ws);
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`);
}

beforeEach(async () => {
  (window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }).happyDOM.setViewport({ width: 1024 });
  tags = await loadTagInfos(fakeGraph().dq);
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => void created.splice(0).forEach((w) => w.stop()));

describe("the panel's order (N77)", () => {
  it("pins Find and Added at the top; Tags, then the filters, scroll under them", async () => {
    await start();
    const top = $("[data-region=panel-top]")!;
    const scroll = $("[data-region=panel-scroll]")!;
    expect(top.querySelector("[data-narrow-find]")).not.toBeNull();
    expect(top.querySelector("[data-narrow-group=added]")).not.toBeNull();
    expect(top.querySelector("[data-tag-section]")).toBeNull();
    const sections = [...scroll.children].map((el) => (el as HTMLElement).hasAttribute("data-tag-section") ? "tags" : (el as HTMLElement).dataset.filterGroup);
    expect(sections[0]).toBe("tags");
    expect(sections.slice(1)).toEqual(tag("Project").choiceProps.map((p) => p.ident));
  });

  it("every heading but Find folds; Added and Tags start folded, Your tags and the filters open, Built-in tags folded", async () => {
    await start();
    expect($("[data-fold=find]")).toBeNull();
    expect(text("[data-narrow-group=find] .pl-fold-head")).toBe("Find");
    expect(open("added")).toBe(false);
    expect(bodyHidden("added")).toBe(true);
    expect(open("tags")).toBe(false);
    expect(open("own")).toBe(true);
    expect(open("built-in")).toBe(false);
    for (const p of tag("Project").choiceProps) expect(open(`filter:${p.ident}`)).toBe(true);
    await click("[data-fold=added]");
    expect(open("added")).toBe(true);
    expect(bodyHidden("added")).toBe(false);
    expect(document.activeElement?.getAttribute("data-fold")).toBe("added");
  });

  it("a folded heading names what is on in it", async () => {
    await start();
    await click("[data-fold=added]");
    await change("input[name=pl-added][value=today]");
    await click("[data-fold=added]");
    expect(text("[data-fold=added]")).toBe("Added · Today");
    const status = tag("Project").choiceProps.find((p) => p.title === "Status")!;
    const value = status.values[0];
    await change(`input[data-filter-prop="${status.ident}"][data-filter-value="${value.uuid}"]`);
    await change(`input[data-filter-prop="${status.ident}"][data-filter-value=""]`);
    expect(text(`[data-fold="filter:${status.ident}"]`)).toBe("Status"); // open: no summary
    await click(`[data-fold="filter:${status.ident}"]`);
    expect(text(`[data-fold="filter:${status.ident}"]`)).toBe(`Status · ${value.title}, No value`);
  });

  it("the headings carry Logseq's block bullet: a dot, with a halo while folded (stylesheet)", () => {
    expect(workspaceCss).toMatch(/\.pl-fold-label::before,\s*\.pl-fold-btn::before\s*\{[^}]*background:\s*var\(--pl-bullet\)/);
    expect(workspaceCss).toMatch(/\[aria-expanded="false"\]::before\s*\{[^}]*box-shadow:\s*0 0 0 4px var\(--pl-bullet-halo\)/);
    expect(themeCss).toMatch(/--pl-bullet:/);
    expect(themeCss).toMatch(/--pl-bullet-halo:/);
  });

  it("the current heading locks while the panel scrolls, the top stays put, and the drawer scrolls as one (stylesheet)", () => {
    expect(workspaceCss).toMatch(/\.pl-panel-scroll\s*\{[^}]*overflow:\s*auto;[^}]*padding:\s*0 /); // seen live: rows showed above a locked heading
    expect(workspaceCss).toMatch(/\.pl-panel-scroll \.pl-fold-head\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/);
    expect(workspaceCss).toMatch(/\.pl-fold-sub > \.pl-fold-head\s*\{[^}]*top:\s*var\(--pl-fold-h\)/);
    const drawer = workspaceCss.slice(workspaceCss.lastIndexOf("@media (max-width: 639px)"));
    expect(drawer).toMatch(/\.pl-panel\s*\{[^}]*overflow:\s*auto/);
    expect(drawer).toMatch(/\.pl-panel-scroll\s*\{[^}]*overflow:\s*visible/);
  });
});

describe("Tags (N77)", () => {
  it("folded, it shows the view's tags; unfolded, a tag search narrows Your tags and Built-in tags and their counts", async () => {
    await start();
    expect(text("[data-tag-chips]")).toBe("#Project");
    await click("[data-fold=tags]");
    const all = Number(text("[data-tag-count=own]"));
    expect(all).toBe($$("[data-tag-group=own] [data-tag-id]").length);
    await type("[data-tag-find]", "client");
    // a parent stays to show where a match sits
    const own = $$("[data-tag-group=own] [data-tag-id]").map((b) => b.textContent?.replace(/\s+/g, " ").trim());
    expect(own).toEqual(["#Project", "#Client project"]);
    expect(text("[data-tag-count=own]")).toBe("1");
    expect(text("[data-tag-count=built-in]")).toBe("0");
    const field = $<HTMLInputElement>("[data-tag-find]")!;
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(6);
    expect("tagFind" in ws.config()!).toBe(false); // session state, not the view's
    await type("[data-tag-find]", "zzz");
    expect(text("[data-tags-none]")).toBe("No tag matches");
  });

  it("selecting a built-in tag opens Built-in tags", async () => {
    await start();
    await click("[data-control=tag]");
    await click(`[data-popover=tag] [data-option="${tag("Task").ident}"]`);
    expect(open("built-in")).toBe(true);
  });
});

describe("the status line (N77)", () => {
  it("replaces the strip: in the panel top, nodes shown of all after filters, Added and Find; Clear all; none when nothing narrows", async () => {
    await start();
    expect($("[data-region=narrowed]")).toBeNull();
    expect($("[data-region=panel-status]")).toBeNull();
    await type("[data-narrow-find]", "acme");
    expect($("[data-region=narrowed]")).toBeNull();
    expect($("[data-region=panel-top] [data-region=panel-status]")).not.toBeNull();
    expect(text("[data-region=panel-status]")).toBe("1 of 4 nodes Clear all");
    await type("[data-narrow-find]", "");
    const status = tag("Project").choiceProps.find((p) => p.title === "Status")!;
    await change(`input[data-filter-prop="${status.ident}"][data-filter-value=""]`);
    expect(text("[data-region=panel-status]")).toMatch(/^\d of 4 nodes Clear all$/);
    $("[data-region=panel-status] [data-action=clear-filters]")!.focus(); // a real click focuses the button
    await click("[data-region=panel-status] [data-action=clear-filters]");
    expect(ws.config()!.filters).toEqual({});
    expect($("[data-region=panel-status]")).toBeNull();
    expect(document.activeElement?.hasAttribute("data-narrow-find")).toBe(true); // seen live: it fell to the body
  });

  it("with the panel closed, the Panel button says how many nodes show", async () => {
    await start();
    await type("[data-narrow-find]", "acme");
    await click("[data-action=toggle-panel]");
    expect($("[data-action=toggle-panel]")!.getAttribute("aria-label")).toBe("Panel · 1 filter active · 1 of 4 nodes shown");
  });
});

describe("folds are kept (N77)", () => {
  it("per graph on this device, with the panel's other state; a stored fold opens as it was left", async () => {
    const { prefs, state } = fakePrefs({ folds: { added: true } });
    await start(prefs);
    expect(open("added")).toBe(true);
    await click("[data-fold=tags]");
    expect(state.stored.folds).toEqual({ added: true, tags: true });
  });
});
