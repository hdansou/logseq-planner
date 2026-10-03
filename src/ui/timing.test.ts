// @vitest-environment happy-dom
// The timing seam in workspace.ts (T13): what the dev-only recorder is told, and when.
import { describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { createViewStore } from "../storage";
import { createWorkspace, type Timing, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage, fixtureDq } from "./test-fakes";

const SITE = "6a000000-0000-4000-8000-000000000001";
const STATUS = ":logseq.property/status";

async function setup(withTiming = true) {
  const tags = await loadTagInfos(fixtureDq());
  const root = document.createElement("div");
  document.body.append(root);
  const graph = fakeGraph();
  const events: string[] = [];
  const timing: Timing = {
    begin: (kind) => void events.push(`begin ${kind}`),
    queried: () => void events.push("queried"),
    rendered: (outcome) => void events.push(`rendered ${outcome}`),
  };
  const ws: Workspace = createWorkspace(root, {
    dq: graph.dq, views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03",
    weekStart: async () => 0, kanban: graph.writes, ...(withTiming ? { timing } : {}),
  });
  return { ws, root, events, graph, tags };
}

describe("timing seam", () => {
  it("open: begin, queried once the data is in, rendered when the view is on screen", async () => {
    const { ws, events, root } = await setup();
    await ws.open();
    expect(events).toEqual(["begin load", "queried", "rendered redrawn"]);
    expect(root.querySelector("[data-view-kind]")).not.toBeNull();
  });

  it("refresh with a change: begin, queried, rendered redrawn", async () => {
    const { ws, events, graph, tags, root } = await setup();
    await ws.open();
    root.querySelector<HTMLElement>(`[data-tag-id="${tags.find((t) => t.title === "Project")!.id}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await ws.idle();
    events.length = 0;
    const done = tags.find((t) => t.title === "Project")!.choiceProps.find((p) => p.title === "Status")!.values.find((v) => v.title === "Done")!;
    graph.edits.set(SITE, { [STATUS]: done.id });
    await ws.refresh();
    expect(events).toEqual(["begin refresh", "queried", "rendered redrawn"]);
  });

  it("refresh with identical data: rendered same", async () => {
    const { ws, events } = await setup();
    await ws.open();
    events.length = 0;
    await ws.refresh();
    expect(events).toEqual(["begin refresh", "queried", "rendered same"]);
  });

  it("refresh while a popover is open: rendered deferred, nothing queried", async () => {
    const { ws, events, root } = await setup();
    await ws.open();
    root.querySelector<HTMLElement>("[data-control=tag]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await ws.idle();
    events.length = 0;
    await ws.refresh();
    expect(events).toEqual(["begin refresh", "rendered deferred"]);
  });

  it("works without a recorder", async () => {
    const { ws, root } = await setup(false);
    await ws.open();
    await ws.refresh();
    expect(root.querySelector("[data-view-kind]")).not.toBeNull();
  });
});
