// @vitest-environment happy-dom
// N36: the Timeline's title column divider. Its own file (happy-dom keeps memory for every re-rendered tree, N24).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { DEFAULT_PREFS, type UiPrefs, type UiStore } from "../ui-state";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq, noDateWrites, noWrites } from "./test-fakes";

let tags: TagInfo[];
let root: HTMLElement;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const created: Workspace[] = [];
const fakePrefs = (stored: Partial<UiPrefs> = {}) => {
  const state = { stored: { ...DEFAULT_PREFS, ...stored } as UiPrefs };
  const prefs = { load: vi.fn(async () => state.stored), save: vi.fn((next: UiPrefs) => void (state.stored = next)) } satisfies UiStore;
  return { prefs, state };
};
async function setup(prefs: UiStore) {
  const ws = createWorkspace(root, { dq: fixtureDq(), views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode: vi.fn(), zone: () => -300,
    today: () => "2026-10-03", time: () => "13:30", kanban: noWrites, dates: noDateWrites, weekStart: async () => 0, prefs });
  created.push(ws);
  await ws.open();
  await $(`[data-tag-id="${tags.find((t) => t.title === "Project")!.id}"]`)!.click();
  await ws.idle();
  return ws;
}
const ptr = (type: string, x: number) => new PointerEvent(type, { clientX: x, pointerId: 1, button: 0, bubbles: true });
const labelVar = () => $("[data-timeline]")!.style.getPropertyValue("--pl-tl-label-w");

beforeEach(async () => {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => void created.splice(0).forEach((ws) => ws.stop()));

describe("Timeline title column divider (N36)", () => {
  it("dragging sets the width live, keeps it within the range, saves it per graph; double-click resets", async () => {
    const { prefs, state } = fakePrefs();
    const ws = await setup(prefs);
    const grip = $("[data-tl-resize]")!;
    grip.dispatchEvent(ptr("pointerdown", 240));
    grip.dispatchEvent(ptr("pointermove", 300));
    expect(labelVar()).toBe("300px");
    grip.dispatchEvent(ptr("pointermove", 2000));
    expect(labelVar()).toBe("640px");
    grip.dispatchEvent(ptr("pointermove", 340));
    grip.dispatchEvent(ptr("pointerup", 340));
    await ws.idle();
    expect(labelVar()).toBe("340px"); // survives the render
    expect(state.stored.labelWidth).toBe(340);
    $("[data-tl-resize]")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await ws.idle();
    expect(labelVar()).toBe("");
    expect(state.stored.labelWidth).toBeNull();
  });

  it("a cancelled drag puts the width back; a stored width is restored on open", async () => {
    const ws = await setup(fakePrefs({ labelWidth: 400 }).prefs);
    expect(labelVar()).toBe("400px");
    const grip = $("[data-tl-resize]")!;
    grip.dispatchEvent(ptr("pointerdown", 400));
    grip.dispatchEvent(ptr("pointermove", 450));
    grip.dispatchEvent(ptr("pointercancel", 450));
    await ws.idle();
    expect(labelVar()).toBe("400px");
  });
});
