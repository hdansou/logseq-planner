// @vitest-environment happy-dom
// N29: Arrow Up / Down move through the saved-views, Done-when and Kanban Show popovers. Its own file (CLAUDE.md, N24).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { defaultViewConfig, serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq, noDateWrites, noWrites } from "./test-fakes";

let tags: TagInfo[];
let root: HTMLElement;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const created: Workspace[] = [];

async function setup() {
  const project = tags.find((t) => t.title === "Project")!;
  const config = serializeViewConfig(defaultViewConfig(project));
  const store = createViewStore(fakeStorage({ blocks: [{ uuid: "v1", name: "Roadmap", config }, { uuid: "v2", name: "Board", config }] }));
  const ws = createWorkspace(root, { dq: fixtureDq(), views: store, onClose: vi.fn(), openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03", time: () => "13:30",
    kanban: noWrites, dates: noDateWrites, weekStart: async () => 0 });
  created.push(ws);
  await ws.open();
  return ws;
}
async function click(ws: Workspace, sel: string) {
  $(sel)!.click();
  await ws.idle();
}
/** Presses `key` on the focused element; returns whether the default was prevented. */
const press = (key: string) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(e);
  return e.defaultPrevented;
};
const focused = () => document.activeElement as HTMLElement;

beforeEach(async () => {
  (window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }).happyDOM.setViewport({ width: 1024 });
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => void created.splice(0).forEach((ws) => ws.stop()));

describe("arrow keys in popovers (N29)", () => {
  it("saved views: Down and Up walk the views, the Name field and Save, skipping the delete buttons, and wrap", async () => {
    const ws = await setup();
    await click(ws, "[data-control=saved-views]");
    $("[data-view-open=v1]")!.focus();
    expect(press("ArrowDown")).toBe(true);
    expect(focused()).toBe($("[data-view-open=v2]"));
    press("ArrowDown");
    expect(focused()).toBe($("[data-field=view-name]"));
    press("ArrowDown");
    expect(focused()).toBe($("[data-action=save-view]"));
    press("ArrowDown");
    expect(focused()).toBe($("[data-view-open=v1]")); // wraps
    press("ArrowUp");
    expect(focused()).toBe($("[data-action=save-view]"));
  });

  it("saved views: from a delete button, Down goes to the next row and Up to its own row", async () => {
    const ws = await setup();
    await click(ws, "[data-control=saved-views]");
    $("[data-view-delete=v1]")!.focus();
    press("ArrowDown");
    expect(focused()).toBe($("[data-view-open=v2]"));
    $("[data-view-delete=v2]")!.focus();
    press("ArrowUp");
    expect(focused()).toBe($("[data-view-open=v2]"));
  });

  it("an open saved view adds Update to the walk; the Delete? question's two buttons are part of it", async () => {
    const ws = await setup();
    await click(ws, "[data-control=saved-views]");
    await click(ws, "[data-view-open=v2]");
    await click(ws, "[data-control=saved-views]");
    $("[data-view-open=v2]")!.focus();
    press("ArrowDown");
    expect(focused()).toBe($("[data-action=update-view]"));
    await click(ws, "[data-view-delete=v1]");
    expect(focused()).toBe($("[data-view-delete-cancel]"));
    press("ArrowDown");
    expect(focused()).toBe($("[data-view-delete-confirm]"));
  });

  it("Done when: Down and Up move between the checkboxes and wrap; other keys are left alone", async () => {
    const ws = await setup();
    await click(ws, "[data-control=done-values]");
    const boxes = [...root.querySelectorAll<HTMLInputElement>("[data-popover=done] input")];
    expect(boxes.length).toBeGreaterThan(1);
    boxes[0].focus();
    expect(press("ArrowDown")).toBe(true);
    expect(focused()).toBe(boxes[1]);
    press("ArrowUp");
    press("ArrowUp");
    expect(focused()).toBe(boxes[boxes.length - 1]);
    expect(press("ArrowLeft")).toBe(false);
    expect(press("a")).toBe(false);
  });

  it("outside a popover the arrow keys are not taken", async () => {
    await setup();
    $("[data-control=saved-views]")!.focus();
    expect(press("ArrowDown")).toBe(false);
  });
});
