// @vitest-environment happy-dom
// N72: switching view kinds and back keeps each kind's own settings (Kanban columns, Agenda grouping, Matrix axes…)
// for the session; the shared fields (tags, dates, filters, done values) come from the view switched from. Seen on the
// stable app: Kanban When columns → Matrix → Kanban came back as Status columns. Its own file: workspace.test.ts is near
// a worker's heap limit (N24).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { WHEN_KEY } from "../core/when";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage } from "./test-fakes";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const config = () => ws.config() as unknown as Record<string, unknown> & { kind: string; tags: string[]; filters: Record<string, string[]> };

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
});
afterEach(() => ws.stop());

describe("switching view kinds (N72)", () => {
  it("Kanban When columns survive a trip to the Matrix and back", async () => {
    await click("[data-view-kind=kanban]");
    await click("[data-control=kb-column]");
    await click(`[data-popover=kb-column] [data-option="${WHEN_KEY}"]`);
    expect(config().columnProp).toBe(WHEN_KEY);
    await click("[data-view-kind=matrix]");
    await click("[data-view-kind=kanban]");
    expect(config().columnProp).toBe(WHEN_KEY);
    expect($("[data-kanban]")!.dataset.kbProp).toBe(WHEN_KEY);
  });

  it("the Agenda keeps its grouping; a filter set in another kind comes along", async () => {
    await click("[data-view-kind=agenda]");
    await click("[data-ag-group-by=date]");
    expect(config().groupBy).toBe("date");
    await click("[data-view-kind=kanban]");
    const status = tag("Project").choiceProps.find((p) => p.title === "Status")!;
    await click(`input[data-filter-prop="${status.ident}"][data-filter-value="${status.values[0].uuid}"]`);
    expect(config().filters).toEqual({ [status.ident]: [status.values[0].uuid] });
    await click("[data-view-kind=agenda]");
    expect(config().groupBy).toBe("date");
    expect(config().filters).toEqual({ [status.ident]: [status.values[0].uuid] });
  });

  it("another tag starts every kind from its defaults again", async () => {
    await click("[data-view-kind=kanban]");
    await click("[data-control=kb-column]");
    await click(`[data-popover=kb-column] [data-option="${WHEN_KEY}"]`);
    await click("[data-view-kind=timeline]");
    await click(`[data-tag-id="${tag("Task").id}"]`);
    await click("[data-view-kind=kanban]");
    expect(config().columnProp).not.toBe(WHEN_KEY);
  });
});
