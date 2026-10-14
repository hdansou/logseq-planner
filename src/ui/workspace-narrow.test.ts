// @vitest-environment happy-dom
// N73: Added and Find in the panel narrow the view to what was created lately or matches words in its title. Its own
// file: workspace.test.ts is near a worker's heap limit (N24).
// #Project (fixtures): Website relaunch (tasks Draft brief, Ship homepage, Survey users), Mobile app (Wireframes), Acme
// rollout (Acme contract), Archive cleanup. Today Sat 3 Oct 2026, UTC-5. The fixture nodes were all created on 3 Oct;
// the tests make three of them old.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore, type ViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage } from "./test-fakes";

const SITE = "6a000000-0000-4000-8000-000000000001";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const ACME = "6a000000-0000-4000-8000-000000000003";
const ACME_CONTRACT = "6a000000-0000-4000-8000-000000000025";
const OLD = Date.UTC(2026, 0, 5, 15);
const LATELY = Date.UTC(2026, 8, 30, 15); // 30 Sep: within the last 7 days, not today

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let views: ViewStore;
let graph: ReturnType<typeof fakeGraph>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const viewText = () => text("[data-region=view]") ?? "";

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await ws.idle();
}
async function change(sel: string, value?: string) {
  const el = $<HTMLInputElement>(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  if (value !== undefined) el.value = value;
  else el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0)); // the days field commits a task later
  await ws.idle();
}
async function type(value: string) {
  const el = $<HTMLInputElement>("[data-narrow-find]")!;
  el.focus();
  el.value = value;
  el.setSelectionRange(value.length, value.length);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await ws.idle();
}

beforeEach(async () => {
  tags = await loadTagInfos(fakeGraph().dq);
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  graph = fakeGraph();
  for (const uuid of [SITE, MOBILE, ACME]) graph.edits.set(uuid, { "created-at": { raw: OLD } });
  views = createViewStore(fakeStorage());
  ws = createWorkspace(root, {
    dq: graph.dq, views, onClose: vi.fn(), openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03", weekStart: async () => 0,
    kanban: graph.writes, dates: graph.dates,
  });
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`);
  await click("[data-view-kind=agenda]");
  await click("[data-fold=added]"); // N77: Added starts folded
});
afterEach(() => ws.stop());

describe("Added and Find (N73)", () => {
  it("the panel has Find and Added (Any, Today, Last 7 days) above the filters; nothing is narrowed at first", () => {
    const panel = $("[data-region=panel]")!;
    const find = panel.querySelector<HTMLInputElement>("[data-narrow-find]")!;
    expect(find.type).toBe("search");
    const radios = [...panel.querySelectorAll<HTMLInputElement>("input[name=pl-added]")];
    expect(radios.map((r) => [r.value, r.checked])).toEqual([["any", true], ["today", false], ["days", false]]);
    expect(panel.querySelector<HTMLInputElement>("[data-narrow-days]")!.value).toBe("7");
    expect(find.compareDocumentPosition(panel.querySelector("[data-filter-group]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect($("[data-region=panel-status]")).toBeNull();
  });

  it("Last 7 days shows the nodes created lately, and an old node through its new task (only that task under it)", async () => {
    graph.edits.set(ACME_CONTRACT, { "created-at": { raw: LATELY } });
    await ws.refresh();
    await change("input[name=pl-added][value=days]");
    expect(ws.config()!.added).toBe(7);
    const shown = viewText();
    expect(shown).toContain("Archive cleanup");
    expect(shown).toContain("Acme rollout");
    expect(shown).toContain("Acme contract");
    expect(shown).not.toContain("Website relaunch");
    expect(shown).not.toContain("Mobile app");
    expect(text("[data-region=panel-status]")).toBe("2 of 4 nodes Clear all"); // N77: in the panel, not a strip over the view
  });

  it("the number of days is editable and picks Last N days; Today and Any switch it", async () => {
    await change("[data-narrow-days]", "400");
    expect(ws.config()!.added).toBe(365); // clamped
    await change("[data-narrow-days]", "30");
    expect(ws.config()!.added).toBe(30);
    expect($<HTMLInputElement>("input[name=pl-added][value=days]")!.checked).toBe(true);
    await change("input[name=pl-added][value=today]");
    expect(ws.config()!.added).toBe("today");
    expect($<HTMLInputElement>("[data-narrow-days]")!.value).toBe("30"); // the number stays for this session
    await change("input[name=pl-added][value=days]");
    expect(ws.config()!.added).toBe(30);
    await change("input[name=pl-added][value=any]");
    expect("added" in ws.config()!).toBe(false);
  });

  it("the days field commits on Tab and the focus stays where Tab took it (seen on the stable app: it fell to the body)", async () => {
    // Chromium's order on Tab: change on the field (its handlers and their microtasks run), then the focus moves to the
    // next control. A redraw in between replaced that control, so the focus went nowhere.
    const days = $<HTMLInputElement>("[data-narrow-days]")!;
    const next = $<HTMLInputElement>("input[data-filter-prop]")!;
    days.focus();
    days.value = "14";
    days.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    days.blur();
    next.focus();
    await new Promise((r) => setTimeout(r, 0));
    await ws.idle();
    expect(ws.config()!.added).toBe(14);
    expect(document.activeElement?.hasAttribute("data-filter-prop")).toBe(true);
  });

  it("Find narrows as you type and keeps the field focused with the caret at the end", async () => {
    await type("acme");
    expect(ws.config()!.find).toBe("acme");
    expect(viewText()).toContain("Acme rollout");
    expect(viewText()).not.toContain("Archive cleanup");
    const field = $<HTMLInputElement>("[data-narrow-find]")!;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("acme");
    expect(field.selectionStart).toBe(4);
    expect(text("[data-region=panel-status]")).toBe("1 of 4 nodes Clear all");
    await type("");
    expect("find" in ws.config()!).toBe(false);
    expect($("[data-region=panel-status]")).toBeNull();
  });

  it("Clear all in the panel turns both off; the Panel badge counts them while the panel is closed", async () => {
    await change("input[name=pl-added][value=today]");
    await type("archive");
    await click("[data-action=toggle-panel]");
    expect(text("[data-action=toggle-panel] .pl-badge")).toBe("2");
    await click("[data-action=toggle-panel]");
    await click("[data-region=panel-status] [data-action=clear-filters]");
    expect("added" in ws.config()! || "find" in ws.config()!).toBe(false);
    expect($("[data-region=panel-status]")).toBeNull();
    await click("[data-action=toggle-panel]");
    expect($("[data-action=toggle-panel] .pl-badge")).toBeNull();
  });

  it("nothing matching shows the no-matches state; Clear filters clears Added and Find too", async () => {
    await type("zzz");
    expect($("[data-empty=no-matches]")).not.toBeNull();
    await click("[data-action=clear-filters]");
    expect("find" in ws.config()!).toBe(false);
    expect(viewText()).toContain("Archive cleanup");
  });

  it("is saved with a view", async () => {
    await change("input[name=pl-added][value=days]");
    await type("acme");
    await click("[data-control=saved-views]");
    $<HTMLInputElement>("[data-field=view-name]")!.value = "Triage";
    await click("[data-action=save-view]");
    const [saved] = await views.list();
    expect("config" in saved && saved.config.added).toBe(7);
    expect("config" in saved && saved.config.find).toBe("acme");
  });

  it("switching view kinds keeps them", async () => {
    await change("input[name=pl-added][value=today]");
    await click("[data-view-kind=kanban]");
    expect(ws.config()!.added).toBe("today");
    expect($<HTMLInputElement>("input[name=pl-added][value=today]")!.checked).toBe(true);
  });
});
