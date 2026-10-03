// @vitest-environment happy-dom
// Hostile titles (T14 security review): every graph string Planner shows is markup-escaped, in every view and menu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos, TAG_PROPERTIES_QUERY, TAGS_QUERY, type Dq } from "../core/schema";
import { defaultViewConfig, serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq, noWrites } from "./test-fakes";

/** One string with the three payloads: an element, an attribute break-out and a closing tag. */
const H = `<img src=x onerror=alert(1)>" onmouseover="x</button>`;
const SITE = "6a000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;
const titled = <T extends Row>(r: T, title: string): T => ({ ...r, title });

/**
 * The fixture graph with titles replaced by hostile ones, nothing else changed (the stated exception to fixture-only
 * data: these strings are the point of the test): the Project tag, its Owner property and the Alice value, the node
 * Website relaunch and the task Draft brief (its inline [[uuid]] ref kept).
 */
const hostileDq = (): Dq => {
  const base = fixtureDq();
  return async (q, ...inputs) => {
    const rows = (await base(q, ...inputs)) as unknown[];
    if (q === TAGS_QUERY) return (rows as [Row][]).map(([t]) => [t.title === "Project" ? titled(t, `${H} Project`) : t]);
    if (q === TAG_PROPERTIES_QUERY) {
      return (rows as [string, Row][]).map(([tag, p]) => [tag, p.title !== "Owner" ? p : {
        ...titled(p, `${H} Owner`),
        "_closed-value-property": (p["_closed-value-property"] as Row[]).map((v) => (v.title === "Alice" ? titled(v, `${H} Alice`) : v)),
      }]);
    }
    return (rows as unknown[][]).map((r) => {
      const [x] = r as [Row];
      if (x && typeof x === "object" && x.title === "Website relaunch") return [titled(x, `${H} Website relaunch`)];
      if (x && typeof x === "object" && typeof x.title === "string" && x.title.startsWith("Draft brief")) return [titled(x, `${H} ${x.title}`)];
      return r;
    });
  };
};

let root: HTMLElement;
let ws: Workspace;
let tags: TagInfo[];
const $ = (sel: string) => root.querySelector<HTMLElement>(sel);

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.click();
  await ws.idle();
}

/** Nothing was created from the strings: no element, no event-handler attribute; the strings show as text. */
function expectInert(where: string) {
  expect(root.querySelectorAll("img").length, where).toBe(0);
  expect(root.querySelectorAll("[onerror], [onmouseover], [x]").length, where).toBe(0);
  expect(root.textContent, where).toContain(H);
}

beforeEach(async () => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  tags = await loadTagInfos(hostileDq());
  const project = tags.find((t) => t.title.endsWith(" Project"))!;
  const blocks = [{ uuid: "v1", name: `${H} view`, config: serializeViewConfig(defaultViewConfig(project)) }];
  ws = createWorkspace(root, {
    dq: hostileDq(), views: createViewStore(fakeStorage({ blocks })), onClose: vi.fn(), openNode: vi.fn(), zone: () => -300,
    today: () => "2026-10-03", kanban: noWrites, weekStart: async () => 0,
  });
  await ws.open();
  await click(`[data-tag-id="${project.id}"]`);
});

describe("hostile titles render inert (T14)", () => {
  it("settings bar, tag tree, filters, tag menu, done values and saved views", async () => {
    expectInert("bar");
    expect($(`[data-filter-group] input[data-filter-value]`)).not.toBeNull();
    for (const control of ["tag", "done-values", "saved-views"]) {
      await click(`[data-control=${control}]`);
      expectInert(control);
      await click(`[data-control=${control}]`);
    }
    await click("[data-control=saved-views]");
    expect($("[data-view-open=v1]")!.textContent).toBe(`${H} view`);
    expect($("[data-view-delete=v1]")!.getAttribute("aria-label")).toBe(`Delete saved view ${H} view`); // attribute intact
  });

  it("Timeline (with task rows), Calendar, Agenda by node and by date, Kanban with Owner lanes", async () => {
    await click(`[data-tl-toggle]`);
    expectInert("timeline");
    expect($(`[data-tl-open="${SITE}"]`)).not.toBeNull();
    await click("[data-view-kind=calendar]");
    expectInert("calendar");
    await click("[data-view-kind=agenda]");
    expectInert("agenda by node");
    await click("[data-ag-group-by=date]");
    expectInert("agenda by date");
    await click("[data-view-kind=kanban]");
    const owner = tags.find((t) => t.title.endsWith(" Project"))!.choiceProps.find((p) => p.title.endsWith(" Owner"))!;
    await click("[data-control=kb-lane]");
    expectInert("kanban lane menu");
    await click(`[data-popover=kb-lane] [data-option="${owner.ident}"]`);
    expectInert("kanban");
    expect($(`[data-kb-open="${SITE}"]`)!.getAttribute("aria-label")).toContain(H); // attribute intact
    await click(`[data-kb-move="${SITE}"]`);
    expectInert("kanban move menu");
  });
});
