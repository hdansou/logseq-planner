// @vitest-environment happy-dom
// Workspace.refresh (T12): the quiet reload that live updates trigger.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTagInfos, loadTagInfos, TAG_PROPERTIES_QUERY, TAGS_QUERY, type Dq } from "../core/schema";
import { nodesQuery, TASKS_QUERY } from "../core/queries";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeGraph, fakeStorage, fixtureDq } from "./test-fakes";

const SITE = "6a000000-0000-4000-8000-000000000001";
const STATUS = ":logseq.property/status";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let graph: ReturnType<typeof fakeGraph>;
let dqCalls: string[];
const tag = (title: string) => tags.find((x) => x.title === title)!;
const status = (title: string) => tag("Project").choiceProps.find((p) => p.title === "Status")!.values.find((v) => v.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];

async function click(sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await ws.idle();
}

/** Opens the Planner over a fake graph the Kanban can write to; `wrap` can intercept its queries. Every query is counted. */
async function setup(wrap: (dq: Dq) => Dq = (dq) => dq) {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  graph = fakeGraph();
  dqCalls = [];
  const base = wrap(graph.dq);
  ws = createWorkspace(root, {
    dq: async (q, ...i) => (dqCalls.push(q), base(q, ...i)), views: createViewStore(fakeStorage()), onClose: vi.fn(), openNode: vi.fn(),
    zone: () => -300, today: () => "2026-10-03", weekStart: async () => 0, kanban: graph.writes,
  });
  await ws.open();
}
const setStatus = (title: string) => graph.edits.set(SITE, { [STATUS]: status(title).id });
const columnOf = (uuid: string) => $(`[data-kb-card="${uuid}"]`)?.closest<HTMLElement>("[data-kb-cell]")?.dataset.kbCol;
const nodeQueries = () => dqCalls.filter((q) => q === nodesQuery(tags)).length;

async function kanban() {
  await click(`[data-tag-id="${tag("Project").id}"]`);
  await click("[data-view-kind=kanban]");
}

beforeEach(() => setup());

describe("redraw", () => {
  it("a changed status redraws the visible view", async () => {
    await kanban();
    expect(columnOf(SITE)).toBe(status("Doing").uuid);
    setStatus("Done");
    await ws.refresh();
    expect(columnOf(SITE)).toBe(status("Done").uuid);
  });

  it("identical data: no redraw at all (same DOM nodes, no mutation), though the data was reloaded", async () => {
    await kanban();
    const before = $(".pl-ws")!;
    const seen: MutationRecord[] = [];
    const mo = new MutationObserver((r) => seen.push(...r));
    mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    const q = nodeQueries();
    await ws.refresh();
    seen.push(...mo.takeRecords());
    mo.disconnect();
    expect(nodeQueries()).toBe(q + 1);
    expect($(".pl-ws")).toBe(before);
    expect(seen).toEqual([]);
  });

  it("every refresh re-reads the tags (one tag query), so a new tag or closed value is picked up", async () => {
    await kanban();
    dqCalls.length = 0;
    await ws.refresh();
    expect(dqCalls.filter((q) => q === TAGS_QUERY)).toHaveLength(1);
  });

  it("tags that appear after an empty graph show up on refresh", async () => {
    let tagsExist = false;
    await setup((base) => async (q, ...i) => (q === TAGS_QUERY && !tagsExist ? [] : base(q, ...i)));
    expect($("[data-empty=no-tags]")).not.toBeNull();
    tagsExist = true;
    await ws.refresh();
    expect($("[data-empty=no-tags]")).toBeNull();
    expect(ws.config()).not.toBeNull();
    expect($$("[data-tag-id]").length).toBeGreaterThan(0);
  });

  it("a failing reload shows the error and keeps the old view", async () => {
    let fail = false;
    await setup((base) => async (q, ...i) => {
      if (fail && q === nodesQuery(tags)) throw new Error("db gone");
      return base(q, ...i);
    });
    const html = $("[data-region=view]")!.innerHTML;
    fail = true;
    await ws.refresh();
    expect($("[data-region=error]")!.textContent).toContain("db gone");
    expect($("[data-region=view]")!.innerHTML).toBe(html);
  });
});

describe("schema on refresh: data is read with the tags on screen while the tags are re-read (T13a)", () => {
  type Rows = [unknown, Record<string, unknown>][];
  /** Wraps the fake so the tag queries' answers (fixture rows) pass through `tagsFn` / `propsFn` while `change` is on. */
  const changing = (tagsFn: (rows: Rows) => Rows, propsFn: (rows: Rows) => Rows) => {
    const state = { on: false };
    return {
      state,
      wrap: (base: Dq): Dq => async (q, ...i) => {
        const rows = await base(q, ...i);
        if (q === TAGS_QUERY) return state.on ? tagsFn(rows as Rows) : rows;
        if (q === TAG_PROPERTIES_QUERY) return state.on ? propsFn(rows as Rows) : rows;
        return rows;
      },
    };
  };
  const same = (rows: Rows) => rows;
  const tasksQueries = () => dqCalls.filter((q) => q === TASKS_QUERY).length;

  it("unchanged schema: one node and one task query per refresh, both asked before the tag queries answer", async () => {
    let release!: () => void;
    let hold = false;
    const gate = new Promise<void>((r) => (release = r));
    await setup((base) => async (q, ...i) => (q === TAGS_QUERY && hold ? (await gate, base(q, ...i)) : base(q, ...i)));
    await kanban();
    dqCalls.length = 0;
    hold = true;
    setStatus("Done");
    const refreshing = ws.refresh();
    for (let k = 0; k < 10; k++) await Promise.resolve();
    expect(nodeQueries()).toBe(1);
    expect(tasksQueries()).toBe(1);
    release();
    await refreshing;
    expect(nodeQueries()).toBe(1);
    expect(tasksQueries()).toBe(1);
    expect(columnOf(SITE)).toBe(status("Done").uuid);
  });

  it("a new closed value is applied to the rows already read: no second node query", async () => {
    const doing = () => status("Doing").uuid;
    const noDoing = (rows: Rows) => rows.map(([t, p]) => [t, { ...p, "_closed-value-property": ((p["_closed-value-property"] ?? []) as { uuid: string }[]).filter((v) => v.uuid !== doing()) }] as [unknown, Record<string, unknown>]);
    const c = changing(same, noDoing);
    c.state.on = true; // the graph starts without Doing
    await setup(c.wrap);
    await kanban();
    expect(columnOf(SITE)).toBe("none");
    dqCalls.length = 0;
    c.state.on = false; // Doing is (re)created and Website relaunch points at it
    await ws.refresh();
    expect(nodeQueries()).toBe(1);
    expect(columnOf(SITE)).toBe(doing());
  });

  it("a new date property on the tag's tree: a second pass of the node query with the new ident (tasks not re-read)", async () => {
    const client = (p: Record<string, unknown>) => String(p.ident).startsWith(":user.property/client-");
    const clientAsDateTime = (rows: Rows) => rows.map(([t, p]) => [t, client(p) ? { ...p, ":logseq.property/type": "datetime" } : p] as [unknown, Record<string, unknown>]);
    const c = changing(same, clientAsDateTime);
    await setup(c.wrap);
    await kanban();
    const before = nodesQuery(tags);
    const after = nodesQuery(buildTagInfos(
      (await fixtureDq()(TAGS_QUERY)) as unknown[], clientAsDateTime((await fixtureDq()(TAG_PROPERTIES_QUERY, [])) as Rows)));
    expect(after).not.toBe(before);
    dqCalls.length = 0;
    c.state.on = true;
    await ws.refresh();
    expect(dqCalls.filter((q) => q === before || q === after)).toEqual([before, after]);
    expect(after).toMatch(/:user\.property\/client-/);
    expect(tasksQueries()).toBe(1);
  });

  describe("a null field takes the default once the tag gains a suitable property (T14)", () => {
    // Fixture property rows of these types left out (for every tag: built-in Status is shared with Task) until
    // `state.on` is false again.
    const without = (types: string[]) => (rows: Rows) => rows.filter(([, p]) => !types.includes(String(p[":logseq.property/type"])));

    it("Start and End: null while the tag has no dates, the default Start/End after it gains them", async () => {
      const c = changing(same, without(["date", "datetime"]));
      c.state.on = true;
      await setup(c.wrap);
      await click(`[data-tag-id="${tag("Project").id}"]`);
      expect(ws.config()).toMatchObject({ tag: tag("Project").ident, start: null, end: null });
      expect($("[data-empty=no-dates]")).not.toBeNull();
      c.state.on = false;
      await ws.refresh();
      const date = (title: string) => tag("Project").dateProps.find((p) => p.title === title)!.ident;
      expect(ws.config()).toMatchObject({ start: date("Start"), end: date("End") });
      expect($("[data-empty=no-dates]")).toBeNull();
      expect($("[data-tl-row]")).not.toBeNull();
    });

    it("Kanban column: null while the tag has no choice property, Status after it gains one", async () => {
      const c = changing(same, without(["default"]));
      c.state.on = true;
      await setup(c.wrap);
      await kanban();
      expect(ws.config()).toMatchObject({ kind: "kanban", columnProp: null });
      expect($("[data-empty=no-choice]")).not.toBeNull();
      c.state.on = false;
      await ws.refresh();
      expect(ws.config()).toMatchObject({ kind: "kanban", columnProp: STATUS, laneProp: null });
      expect(columnOf(SITE)).toBe(status("Doing").uuid);
    });
  });

  it("a new tag elsewhere: the tag tree shows it, with no second node query", async () => {
    const comment = () => tag("Comment").id;
    const c = changing((rows) => rows.filter(([t]) => (t as { id: number }).id !== comment()), same);
    c.state.on = true; // no Comment tag yet
    await setup(c.wrap);
    await kanban();
    expect($(`[data-tag-id="${comment()}"]`)).toBeNull();
    dqCalls.length = 0;
    c.state.on = false;
    await ws.refresh();
    expect($(`[data-tag-id="${comment()}"]`)).not.toBeNull();
    expect(nodeQueries()).toBe(1);
    expect(tasksQueries()).toBe(1);
  });
});

describe("what a redraw keeps", () => {
  it("anchor, expanded Timeline rows, scroll of the view and the sidebar, and keyboard focus", async () => {
    await click(`[data-tag-id="${tag("Project").id}"]`);
    await click("[data-tl-nav=next]");
    const range = $("[data-tl-range]")!.textContent;
    const site = $$("[data-tl-row]").find((r) => r.textContent!.includes("Website relaunch"))!;
    await click(`[data-tl-toggle="${site.dataset.tlRow}"]`);
    const expanded = $$("[data-tl-task]").length;
    expect(expanded).toBeGreaterThan(0);
    $("[data-region=view]")!.scrollTop = 120;
    $("[data-region=view]")!.scrollLeft = 340;
    $("[data-region=sidebar]")!.scrollTop = 55;
    const filter = $<HTMLInputElement>("[data-filter-prop]")!;
    filter.focus();
    const focused = filter.outerHTML;
    const before = $(".pl-ws")!;

    setStatus("Done"); // changes a filter count, so the shell is redrawn
    const html = root.innerHTML;
    await ws.refresh();

    expect(root.innerHTML).not.toBe(html);
    expect($(".pl-ws")).not.toBe(before); // really redrawn
    expect($("[data-tl-range]")!.textContent).toBe(range);
    expect($$("[data-tl-task]")).toHaveLength(expanded);
    expect($("[data-region=view]")!.scrollTop).toBe(120);
    expect($("[data-region=view]")!.scrollLeft).toBe(340);
    expect($("[data-region=sidebar]")!.scrollTop).toBe(55);
    expect(document.activeElement!.outerHTML).toBe(focused);
    expect(document.activeElement).toBe($("[data-filter-prop]"));
  });

  it("the Kanban's sideways scroll and the Agenda's unfolded buckets survive", async () => {
    await click(`[data-tag-id="${tag("Project").id}"]`);
    await click("[data-view-kind=agenda]");
    await click('[data-ag-group-by="date"]');
    const folded = $$<HTMLDetailsElement>("details[data-ag-bucket]");
    expect(folded.length).toBeGreaterThan(0);
    folded[0].open = true;
    const key = folded[0].dataset.agBucket;
    expect($$<HTMLDetailsElement>("details[data-ag-bucket]").filter((d) => d.dataset.agBucket !== key).every((d) => !d.open)).toBe(true);
    // a real change: the Done value makes the node done, so the agenda changes
    setStatus("Done");
    await ws.refresh();
    const after = $$<HTMLDetailsElement>("details[data-ag-bucket]");
    expect(after.find((d) => d.dataset.agBucket === key)!.open).toBe(true);
    expect(after.filter((d) => d.dataset.agBucket !== key).every((d) => !d.open)).toBe(true);
  });
});

describe("what defers a redraw", () => {
  it("an open popover: nothing is reloaded or redrawn until it closes, then one redraw", async () => {
    await kanban();
    await click("[data-control=kb-column]");
    expect($("[data-popover=kb-column]")).not.toBeNull();
    setStatus("Done");
    const q = nodeQueries();
    await ws.refresh();
    expect(nodeQueries()).toBe(q);
    expect($("[data-popover=kb-column]")).not.toBeNull();
    expect(columnOf(SITE)).toBe(status("Doing").uuid);

    expect(ws.escape()).toBe(true);
    await ws.idle();
    expect(nodeQueries()).toBe(q + 1);
    expect($("[data-popover]")).toBeNull();
    expect(columnOf(SITE)).toBe(status("Done").uuid);
  });

  it("a popover opened while the reload runs wins: the result is dropped and applied after it closes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let hold = false;
    await setup((base) => async (q, ...i) => (q === nodesQuery(tags) && hold ? (await gate, base(q, ...i)) : base(q, ...i)));
    await kanban();
    hold = true;
    setStatus("Done");
    const refreshing = ws.refresh();
    await click("[data-control=kb-column]"); // queued behind the reload
    release();
    await refreshing;
    await ws.idle();
    // the click ran after the reload on the queue; the popover is open and the old board is still shown
    expect($("[data-popover=kb-column]")).not.toBeNull();
    hold = false;
    ws.escape();
    await ws.idle();
    expect(columnOf(SITE)).toBe(status("Done").uuid);
  });

  it("a pending Kanban write: no extra reload while it runs, one refresh afterwards", async () => {
    await kanban();
    let release!: () => void;
    graph.state.hold = new Promise<void>((r) => (release = r));
    const card = $(`[data-kb-card="${SITE}"]`)!;
    const cell = $(`[data-kb-cell][data-kb-col="${status("Done").uuid}"]`)!;
    const ev = (type: string) => new Event(type, { bubbles: true, cancelable: true });
    card.dispatchEvent(ev("dragstart"));
    cell.dispatchEvent(ev("dragover"));
    cell.dispatchEvent(ev("drop"));
    card.dispatchEvent(ev("dragend"));
    expect($(`[data-kb-card="${SITE}"]`)!.hasAttribute("data-kb-pending")).toBe(true);
    const q = nodeQueries();
    const refreshing = ws.refresh(); // queued behind the write on the same queue
    await Promise.resolve();
    expect(nodeQueries()).toBe(q);
    release();
    await refreshing;
    await ws.idle();
    expect($(`[data-kb-card="${SITE}"]`)!.hasAttribute("data-kb-pending")).toBe(false);
    expect(columnOf(SITE)).toBe(status("Done").uuid);
    expect(nodeQueries()).toBeGreaterThan(q); // the write's own reload, plus the queued refresh
  });

  it("a drag in progress: nothing is redrawn under the cursor; the refresh runs when the drag ends", async () => {
    await kanban();
    const card = $(`[data-kb-card="${SITE}"]`)!;
    card.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    setStatus("Done");
    const q = nodeQueries();
    await ws.refresh();
    expect(nodeQueries()).toBe(q);
    expect($(`[data-kb-card="${SITE}"]`)).toBe(card); // same element
    card.dispatchEvent(new Event("dragend", { bubbles: true }));
    await ws.idle();
    expect(columnOf(SITE)).toBe(status("Done").uuid);
  });
});
