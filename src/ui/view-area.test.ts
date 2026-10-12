// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos } from "../core/schema";
import { defaultViewConfig, validateViewConfig, VIEW_KINDS } from "../core/view-config";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { AGENDA_GROUP_PAGE } from "./agenda";
import { fakeStorage, fixtureDq, noDateWrites, noWrites } from "./test-fakes";
import { blockSession, readViewData, renderViewArea, type Now, type ViewSession } from "./view-area";
import { createWorkspace } from "./workspace";

const NOW: Now = { today: "2026-10-03", time: "13:30", weekStart: 0 };
/** The session a freshly opened workspace has. */
const workspaceSession = (): ViewSession => ({
  anchor: null, expanded: new Set(), collapsed: new Set(), agendaOpen: new Set(), agendaGroups: AGENDA_GROUP_PAGE, agendaOverdue: AGENDA_GROUP_PAGE,
  kbShown: new Map(), pending: new Map(), moveOpen: null, popover: null, editDates: false, datePending: new Map(), labelWidth: null,
});
/** HTML as the DOM serialises it (boolean attributes gain `=""`). */
const normal = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.innerHTML;
};

let tags: TagInfo[];
const tag = (title: string) => tags.find((t) => t.title === title)!;

beforeEach(async () => {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
});

describe("renderViewArea (N06b: shared by the workspace and the in-page block)", () => {
  it.each(VIEW_KINDS)("draws exactly what the workspace's view area and toolbar show (%s)", async (kind) => {
    const root = document.createElement("div");
    document.body.append(root);
    const ws = createWorkspace(root, { dq: fixtureDq(), views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode: vi.fn(), zone: () => -300,
      today: () => NOW.today, time: () => NOW.time, kanban: noWrites, dates: noDateWrites, weekStart: async () => NOW.weekStart });
    await ws.open();
    // The first tag (#Meeting) has one choice property; a Matrix needs two (N64): #Project has Status and Owner.
    if (kind === "matrix") {
      root.querySelector<HTMLElement>(`[data-tag-id="${tag("Project").id}"]`)!.click();
      await ws.idle();
    }
    root.querySelector<HTMLElement>(`[data-view-kind=${kind}]`)!.click();
    await ws.idle();
    const config = ws.config()!;
    expect(config.kind).toBe(kind);
    const data = await readViewData(fixtureDq(), config, tags, () => -300);
    const area = renderViewArea({ tags, config, view: validateViewConfig(config, tags), ...data, session: workspaceSession() }, () => NOW);
    expect(area.view).not.toContain("data-empty"); // a drawn view, not an empty state
    expect(root.querySelector("[data-region=view]")!.innerHTML).toBe(normal(area.view));
    expect(root.querySelector("[data-region=view-toolbar]")!.innerHTML).toBe(normal(area.toolbar));
  });

  it("an empty state for a tag without nodes, and never asks the clock for it", () => {
    const config = defaultViewConfig(tag("Task"));
    const now = vi.fn(() => NOW);
    const area = renderViewArea({ tags, config, view: validateViewConfig(config, tags), nodes: [], tasks: [], titles: new Map(), session: workspaceSession() }, now);
    expect(area).toEqual({ view: expect.stringContaining('data-empty="no-nodes"'), toolbar: "" });
    expect(now).not.toHaveBeenCalled();
  });
});

describe("blockSession", () => {
  it("anchors on today, keeps nested parents open and task rows folded, and renders every folded Agenda bucket", () => {
    const s = blockSession();
    expect(s.anchor).toBeNull();
    expect([...s.expanded]).toEqual([]);
    expect([...s.collapsed]).toEqual([]);
    expect([...s.agendaOpen].sort()).toEqual(["earlier", "later", "none"]);
    expect(s.moveOpen).toBeNull();
    expect(s.pending.size).toBe(0);
  });
});
