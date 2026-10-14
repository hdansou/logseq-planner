// @vitest-environment happy-dom
// N75: in Every value the Matrix has a Show menu, as the Kanban's: untick a value and its row or column leaves the grid.
// Its own file: workspace.test.ts is near a worker's heap limit (N24). #Project (fixtures), When across, Status down.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage } from "./test-fakes";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const config = () => ws.config() as Extract<ReturnType<Workspace["config"]> & object, { kind: "matrix" }>;

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await ws.idle();
}
async function untick(sel: string) {
  const el = $<HTMLInputElement>(sel)!;
  el.checked = !el.checked;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await ws.idle();
}

beforeEach(async () => {
  tags = await loadTagInfos(fakeGraph().dq);
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  const graph = fakeGraph();
  ws = createWorkspace(root, {
    dq: graph.dq, views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03", weekStart: async () => 0,
    kanban: graph.writes, dates: graph.dates,
  });
  await ws.open();
  await click(`[data-tag-id="${tag("Project").id}"]`);
  await click("[data-view-kind=matrix]");
});
afterEach(() => ws.stop());

describe("Matrix Show (N75)", () => {
  it("only in Every value; it lists each axis's values, all ticked", async () => {
    expect($("[data-control=mx-show]")).toBeNull();
    await click("[data-mx-mode=values]");
    expect($("[data-control=mx-show]")!.textContent).toContain("All");
    await click("[data-control=mx-show]");
    const y = config().y!.prop;
    const boxes = $$(`[data-popover=mx-show] input[data-mx-show-prop="${y}"]`) as HTMLInputElement[];
    expect(boxes.length).toBe($$("[data-mx-yhead]").length);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect($$(`[data-popover=mx-show] input[data-mx-show-prop="${config().x!.prop}"]`).length).toBe($$("[data-mx-xhead]").length);
  });

  it("unticking a value takes its row out and saves it per property; the last value of an axis cannot be unticked", async () => {
    await click("[data-mx-mode=values]");
    await click("[data-control=mx-show]");
    const y = config().y!.prop;
    const keys = $$("[data-mx-yhead]").map((h) => h.dataset.mxYhead!);
    await untick(`input[data-mx-show-prop="${y}"][data-mx-show-value="${keys[0]}"]`);
    expect(config().hidden).toEqual({ [y]: [keys[0]] });
    expect($(`[data-mx-yhead="${keys[0]}"]`)).toBeNull();
    expect($("[data-popover=mx-show]")).not.toBeNull(); // the menu stays open
    expect($("[data-control=mx-show]")!.textContent).toMatch(/\d+ of \d+/);
    for (const k of keys.slice(1, -1)) await untick(`input[data-mx-show-prop="${y}"][data-mx-show-value="${k}"]`);
    const last = $<HTMLInputElement>(`input[data-mx-show-prop="${y}"][data-mx-show-value="${keys[keys.length - 1]}"]`)!;
    expect(last.checked).toBe(true);
    expect(last.disabled).toBe(true);
    await untick(`input[data-mx-show-prop="${y}"][data-mx-show-value="${keys[0]}"]`); // ticked again
    expect(config().hidden![y]).not.toContain(keys[0]);
  });
});
