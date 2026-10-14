// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos, mergeTags, TAGS_QUERY, type Dq } from "../core/schema";
import { defaultViewConfig, serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { StorageDeps, Surface, TagInfo } from "../types";
import { createWorkspace, initialTag, NARROW_MEDIA, type Workspace } from "./workspace";
import { visibleData } from "./view-area";
import { DEPENDS_ON, fakeStorage, fixtureDq, noDateWrites, noWrites } from "./test-fakes";
import { DAY_TRACK_PX } from "./timeline";
import { loadNodes, loadNodesAndTasks, tasksQuery, TITLES_QUERY } from "../core/queries";
import { Window } from "happy-dom";
import { installHostKeys, type HostDocument } from "./host-keys";
import workspaceCss from "./workspace.css?inline";
import themeCss from "./theme.css?inline";

let tags: TagInfo[];
const tag = (title: string) => {
  const t = tags.find((x) => x.title === title);
  if (!t) throw new Error(`no tag ${title}`);
  return t;
};
const dateIdent = (t: TagInfo, title: string) => t.dateProps.find((p) => p.title === title)!.ident;
const choice = (t: TagInfo, title: string) => t.choiceProps.find((p) => p.title === title)!;

let root: HTMLElement;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
/** Nodes the Timeline shows: rows plus the undated footnote. */
const shownNodes = () => $$("[data-tl-row]").length + $$("[data-tl-undated] [data-tl-open]").length;
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
const label = (sel: string) => $(sel)?.getAttribute("aria-label") ?? "";

async function setup(opts: { dq?: Dq; storage?: StorageDeps; weekStart?: () => Promise<number>; time?: () => string; setSurface?: (surface: Surface) => void } = {}) {
  const store = createViewStore(opts.storage ?? fakeStorage());
  const onClose = vi.fn();
  const ws = createWorkspace(root, { dq: opts.dq ?? fixtureDq(), views: store, onClose, openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03", time: opts.time ?? (() => "13:30"), kanban: noWrites, dates: noDateWrites, weekStart: opts.weekStart ?? (async () => 0), setSurface: opts.setSurface });
  created.push(ws);
  await ws.open();
  return { ws, store, onClose };
}
/** Every workspace `setup` made in this test: stopped afterwards, so its window listeners do not keep it (and its DOM) alive. */
const created: Workspace[] = [];
afterEach(() => void created.splice(0).forEach((ws) => ws.stop()));
async function click(ws: Workspace, sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.click();
  await ws.idle();
}
/** Clicks the tag in the tree, opening the collapsed built-in group first when the tag is in it. */
async function pickTag(ws: Workspace, title: string) {
  if (tag(title).builtIn && $("[data-action=toggle-built-in]")!.getAttribute("aria-expanded") === "false") await click(ws, "[data-action=toggle-built-in]");
  await click(ws, `[data-tag-id="${tag(title).id}"]`);
}

/** Sets the frame's width (happy-dom evaluates `matchMedia` against it and fires its change events). */
const viewport = (width: number) => (window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }).happyDOM.setViewport({ width });

beforeEach(async () => {
  viewport(1024);
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});

describe("empty states", () => {
  it("no tags", async () => {
    await setup({ dq: fixtureDq({ noTags: true }) });
    expect($("[data-empty=no-tags]")).not.toBeNull();
    expect(text("[data-empty=no-tags]")).toContain("No tags");
  });

  it("tag without date properties", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Page");
    expect($("[data-empty=no-dates]")).not.toBeNull();
    expect(text("[data-empty=no-dates]")).toContain("#Page has no date properties");
  });

  it("tag without nodes", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Task"); // has Scheduled/Deadline; the fake graph has no Task nodes
    expect($("[data-empty=no-nodes]")).not.toBeNull();
    expect(text("[data-empty=no-nodes]")).toContain("No #Task nodes");
  });

  it("filters exclude everything", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    const status = choice(tag("Project"), "Status");
    const count = (uuid: string) => $(`input[data-filter-prop="${status.ident}"][data-filter-value="${uuid}"]`)!.closest("label")!.querySelector(".pl-count")!.textContent;
    const unused = status.values.find((v) => count(v.uuid) === "0")!;
    await click(ws, `input[data-filter-prop="${status.ident}"][data-filter-value="${unused.uuid}"]`);
    expect($("[data-empty=no-matches]")).not.toBeNull();
    expect(ws.config()!.filters).toEqual({ [status.ident]: [unused.uuid] });

    await click(ws, "[data-action=clear-filters]");
    expect($("[data-empty=no-matches]")).toBeNull();
    expect(ws.config()!.filters).toEqual({});
  });

  it("renders the Kanban for the kanban kind (T11); no view kind shows a placeholder any more", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "[data-view-kind=kanban]");
    expect($("[data-empty]")).toBeNull();
    expect($("[data-region=view] [data-kanban]")).not.toBeNull();
    expect($$("[data-kb-card]")).toHaveLength(4);
    expect($(".pl-placeholder")).toBeNull();
  });

  it("Kanban: a tag without choice properties says so instead of a board (no-dates state does not apply)", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Page"); // no date and no choice properties
    await click(ws, "[data-view-kind=kanban]");
    expect($("[data-empty=no-dates]")).toBeNull();
    expect($("[data-empty=no-choice]")).not.toBeNull();
    expect(text("[data-empty=no-choice]")).toContain("#Page has no choice properties");
    expect($("[data-kanban]")).toBeNull();
    expect(ws.config()).toMatchObject({ kind: "kanban", columnProp: null });
  });

  it("renders the Agenda for the agenda kind (T10)", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "[data-view-kind=agenda]");
    expect($("[data-region=view] [data-agenda]")).not.toBeNull();
    expect($(".pl-placeholder")).toBeNull();
  });

  it("renders the Timeline for the timeline kind (T08)", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    expect($("[data-region=view] [data-timeline]")).not.toBeNull();
    expect($(".pl-placeholder")).toBeNull();
  });
});

describe("settings bar", () => {
  it("is a labelled group, so the label is announced", async () => {
    await setup();
    expect($("[data-region=settings]")!.getAttribute("role")).toBe("group");
    expect($("[data-region=settings]")!.getAttribute("aria-label")).toBe("View settings");
  });

  it("shows the Project schema: Start/End, child tags, Status done values", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    expect(text("[data-control=tag]")).toContain("#Project");
    const child = $<HTMLInputElement>("input[data-control=child-tags]")!;
    expect(child.checked).toBe(true);
    expect(text("label[for=pl-child-tags]")).toContain("#Client project");
    expect(text("[data-control=start]")).toContain("Start");
    expect(text("[data-control=end]")).toContain("End");
    expect(text("[data-control=done-values]")).toContain("Status");
    expect(text("[data-control=done-values]")).toContain("Done, Canceled");
    expect(ws.config()).toMatchObject({ tags: [tag("Project").ident], dates: { [tag("Project").ident]: { start: dateIdent(tag("Project"), "Start"), end: dateIdent(tag("Project"), "End") } } });
    // filters for every choice property, each with "No value"
    const legends = $$("[data-filter-group] legend").map((l) => l.textContent?.trim());
    expect(legends).toEqual(expect.arrayContaining(["Status", "Owner"]));
    for (const p of tag("Project").choiceProps) expect($(`input[data-filter-prop="${p.ident}"][data-filter-value=""]`)).not.toBeNull();
  });

  it("switching to Meeting re-derives defaults and updates the bar to its Date and Type", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "[data-control=tag]");
    await click(ws, `[data-popover=tag] [data-option="${tag("Meeting").ident}"]`);
    expect(text("[data-control=tag]")).toContain("#Meeting");
    expect(text("[data-control=start]")).toContain("Date");
    expect(text("[data-control=end]")).toContain("None");
    expect(text("[data-control=done-values]")).toContain("Type");
    expect($("input[data-control=child-tags]")).toBeNull(); // Meeting has no child tags
    expect(ws.config()).toMatchObject({ tags: [tag("Meeting").ident], dates: { [tag("Meeting").ident]: { start: dateIdent(tag("Meeting"), "Date"), end: null } }, filters: {}, doneValues: {} });
    expect(shownNodes()).toBe(3);
  });

  it("switching to a tag with no dates hides the date pickers and shows that empty state", async () => {
    const { ws } = await setup();
    await click(ws, "[data-control=tag]");
    await click(ws, `[data-popover=tag] [data-option="${tag("Page").ident}"]`);
    expect($("[data-control=start]")).toBeNull();
    expect(text("[data-region=settings]")).toContain("No date properties");
    expect($("[data-empty=no-dates]")).not.toBeNull();
  });

  it("start and end pickers set the config", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "[data-control=end]");
    await click(ws, "[data-popover=end] [data-option=\"\"]");
    expect(ws.config()!.dates[tag("Project").ident].end).toBeNull();
    expect(text("[data-control=end]")).toContain("None");
    await click(ws, "[data-control=start]");
    await click(ws, `[data-popover=start] [data-option="${dateIdent(tag("Project"), "End")}"]`);
    expect(ws.config()!.dates[tag("Project").ident].start).toBe(dateIdent(tag("Project"), "End"));
  });

  it("the child-tags toggle reloads without extending tags", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "input[data-control=child-tags]");
    expect(ws.config()!.childTags).toBe(false);
    expect(shownNodes()).toBe(3);
  });

  it("done values: unticking Canceled stores the remaining value uuids", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    const status = choice(tag("Project"), "Status");
    const canceled = status.values.find((v) => v.canceled)!;
    const done = status.values.find((v) => v.checkbox === true)!;
    await click(ws, "[data-control=done-values]");
    await click(ws, `[data-popover=done] input[data-done-prop="${status.ident}"][data-done-value="${canceled.uuid}"]`);
    expect(ws.config()!.doneValues).toEqual({ [status.ident]: [done.uuid] });
    expect(text("[data-control=done-values]")).toContain("Status is Done");
    expect(text("[data-control=done-values]")).not.toContain("Canceled");
  });
});

describe("Kanban Show menu (N08)", () => {
  const kanban = async () => {
    const r = await setup();
    await pickTag(r.ws, "Project");
    await click(r.ws, "[data-view-kind=kanban]");
    return r;
  };
  const status = () => choice(tag("Project"), "Status");
  const owner = () => choice(tag("Project"), "Owner");
  const key = (title: string) => status().values.find((v) => v.title === title)!.uuid;
  const box = (k: string) => $<HTMLInputElement>(`[data-popover=kb-show] input[data-kb-show-value="${k}"]`)!;
  const heads = () => $$("[data-kb-column]").map((h) => h.querySelector(".pl-kb-head-title")!.textContent);
  const hiddenOf = (ws: Workspace) => (ws.config() as { hiddenColumns: Record<string, string[]> }).hiddenColumns;

  it("ticking a checkbox updates the config and the board; the popover stays open with focus on the checkbox", async () => {
    const { ws } = await kanban();
    await click(ws, "[data-control=kb-show]");
    box(key("Backlog")).focus();
    await click(ws, `[data-popover=kb-show] input[data-kb-show-value="${key("Backlog")}"]`);
    expect(hiddenOf(ws)).toEqual({ [status().ident]: [key("Backlog")] });
    expect(heads()).not.toContain("Backlog");
    expect($("[data-popover=kb-show]")).not.toBeNull();
    expect(document.activeElement).toBe(box(key("Backlog")));
    await click(ws, `[data-popover=kb-show] input[data-kb-show-value="none"]`);
    expect(hiddenOf(ws)).toEqual({ [status().ident]: [key("Backlog"), "none"] });
    await click(ws, `[data-popover=kb-show] input[data-kb-show-value="${key("Backlog")}"]`); // tick again: shown
    expect(hiddenOf(ws)).toEqual({ [status().ident]: ["none"] });
    expect(heads()).toContain("Backlog");
  });

  it("Escape closes the popover and returns focus to its button; so does a click outside", async () => {
    const { ws } = await kanban();
    await click(ws, "[data-control=kb-show]");
    expect(ws.escape()).toBe(true);
    expect($("[data-popover=kb-show]")).toBeNull();
    expect(document.activeElement).toBe($("[data-control=kb-show]"));
    await click(ws, "[data-control=kb-show]");
    await click(ws, "[data-region=main]");
    expect($("[data-popover]")).toBeNull();
  });

  it("refuses to hide the last shown column", async () => {
    const { ws } = await kanban();
    await click(ws, "[data-control=kb-show]");
    const others = [...status().values.map((v) => v.uuid), "none"].filter((k) => k !== key("Doing"));
    for (const k of others) await click(ws, `[data-popover=kb-show] input[data-kb-show-value="${k}"]`);
    const before = hiddenOf(ws);
    const last = box(key("Doing"));
    expect(last.disabled).toBe(true);
    // the handler refuses even when a change event arrives (a disabled box does not send one in a browser)
    last.disabled = false;
    last.checked = false;
    last.dispatchEvent(new Event("change", { bubbles: true }));
    await ws.idle();
    expect(hiddenOf(ws)).toEqual(before);
    expect(heads()).toEqual(["Doing"]);
    expect(box(key("Doing")).checked).toBe(true);
  });

  it("keeps the choice per column property: switching Columns away and back restores it", async () => {
    const { ws } = await kanban();
    await click(ws, "[data-control=kb-show]");
    await click(ws, `[data-popover=kb-show] input[data-kb-show-value="${key("Backlog")}"]`);
    await click(ws, "[data-control=kb-column]");
    await click(ws, `[data-popover=kb-column] [data-option="${owner().ident}"]`);
    expect(text("[data-control=kb-show]")).toBe("All▾");
    expect(heads()).toEqual(["Alice", "Bob", "No Owner"]);
    await click(ws, "[data-control=kb-show]");
    expect(text("[data-popover=kb-show] legend")).toBe("Owner");
    await click(ws, `[data-popover=kb-show] input[data-kb-show-value="none"]`);
    expect(heads()).toEqual(["Alice", "Bob"]);
    await click(ws, "[data-control=kb-column]");
    await click(ws, `[data-popover=kb-column] [data-option="${status().ident}"]`);
    expect(heads()).not.toContain("Backlog");
    expect(text("[data-control=kb-show]")).toBe("6 of 7▾");
    expect(hiddenOf(ws)).toEqual({ [status().ident]: [key("Backlog")], [owner().ident]: ["none"] });
  });

  it("is saved with the view and restored when it is opened", async () => {
    const { ws, store } = await kanban();
    await click(ws, "[data-control=kb-show]");
    await click(ws, `[data-popover=kb-show] input[data-kb-show-value="${key("Canceled")}"]`);
    await click(ws, "[data-control=saved-views]");
    await click(ws, "[data-action=save-view]");
    const id = (await store.list())[0].id;
    store.invalidate(); // read the stored JSON back, not the cached object
    await pickTag(ws, "Meeting");
    expect(hiddenOf(ws)).toEqual({});
    await click(ws, "[data-control=saved-views]");
    await click(ws, `[data-view-open="${id}"]`);
    expect(hiddenOf(ws)).toEqual({ [status().ident]: [key("Canceled")] });
    expect(heads()).not.toContain("Canceled");
    expect(text("[data-control=kb-show]")).toBe("6 of 7▾");
  });

  it("a key of a value that is gone is ignored on the board and kept when a box is ticked", async () => {
    const { ws, store } = await kanban();
    const saved = await store.create("Stale", { ...(ws.config() as object), hiddenColumns: { [status().ident]: ["gone-uuid", key("Done")] } } as never);
    await ws.showViews();
    await click(ws, "[data-control=saved-views]");
    await click(ws, `[data-view-open="${saved.id}"]`);
    expect(text("[data-control=kb-show]")).toBe("6 of 7▾");
    await click(ws, "[data-control=kb-show]");
    await click(ws, `[data-popover=kb-show] input[data-kb-show-value="${key("Backlog")}"]`);
    expect(hiddenOf(ws)).toEqual({ [status().ident]: ["gone-uuid", key("Backlog"), key("Done")] });
  });

  it("a view-kind change and back keeps it with the other Kanban settings (N72; reset before)", async () => {
    const { ws } = await kanban();
    await click(ws, "[data-control=kb-show]");
    await click(ws, `[data-popover=kb-show] input[data-kb-show-value="${key("Backlog")}"]`);
    await click(ws, "[data-kb-sort=title]");
    await click(ws, "[data-view-kind=timeline]");
    await click(ws, "[data-view-kind=kanban]");
    expect(ws.config()).toMatchObject({ sort: "title", hiddenColumns: { [status().ident]: [key("Backlog")] } });
  });
});

describe("initial tag (T07 D3)", () => {
  it("opens on the first own root tag with dates in tree order: Meeting, not the child Client project", async () => {
    const { ws } = await setup();
    expect(ws.config()!.tags).toEqual([tag("Meeting").ident]);
  });

  it("falls back to the first own tag with dates, then the first tag", () => {
    const root = { ...tag("Project"), title: "Alpha", dateProps: [] };
    const child = { ...tag("Client project"), title: "Beta", parentIds: [root.id] };
    expect(initialTag([root, child, tag("Task")])!.title).toBe("Beta");
    expect(initialTag([{ ...root, dateProps: [] }, tag("Page")])!.title).toBe("Alpha");
  });
});

describe("tasks of the visible nodes (T07 D4)", () => {
  it("counts only tasks linked to nodes that pass the filters", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    const owner = choice(tag("Project"), "Owner");
    const alice = owner.values.find((v) => v.title === "Alice")!;
    await click(ws, `input[data-filter-prop="${owner.ident}"][data-filter-value="${alice.uuid}"]`);
    const zone = () => -300;
    const nodes = (await loadNodes(fixtureDq(), tags, [tag("Project")], { childTags: true, zone })).filter((n) => n.choices[owner.ident]?.id === alice.id);
    const ids = new Set(nodes.map((n) => n.id));
    const loaded = await loadNodesAndTasks(fixtureDq(), tags, [tag("Project")], { childTags: true, zone });
    const expected = loaded.tasks.filter((t) => t.nodeIds.some((id) => ids.has(id))).length;
    expect(expected).toBeLessThan(loaded.tasks.length);
    const config = { ...defaultViewConfig(tag("Project")), filters: { [owner.ident]: [alice.uuid] } };
    const shown = visibleData(config, mergeTags([tag("Project")]), loaded.nodes, loaded.tasks);
    expect(shown.nodes.map((n) => n.id)).toEqual(nodes.map((n) => n.id));
    expect(shown.tasks).toHaveLength(expected);
    await click(ws, "[data-view-kind=kanban]"); // the board shows only the filtered nodes
    expect($$("[data-kb-card]").map((c) => c.dataset.kbCard).sort()).toEqual(nodes.map((n) => n.uuid).sort());
  });
});

describe("tag tree", () => {
  it("collapses the built-in group by default and toggles it (T07 D6)", async () => {
    const { ws } = await setup();
    const toggle = $("[data-action=toggle-built-in]")!;
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect($("[data-tag-group=built-in]")!.hidden).toBe(true);
    expect(toggle.getAttribute("aria-controls")).toBe($("[data-tag-group=built-in]")!.id);
    await click(ws, "[data-action=toggle-built-in]");
    expect($("[data-action=toggle-built-in]")!.getAttribute("aria-expanded")).toBe("true");
    expect($("[data-tag-group=built-in]")!.hidden).toBe(false);
    await click(ws, "[data-action=toggle-built-in]");
    expect($("[data-tag-group=built-in]")!.hidden).toBe(true);
  });

  it("runs the panel to the bottom of the window (T07 open item; stylesheet, happy-dom does not lay out)", () => {
    // The body takes the remaining height whether or not the error row is present, and the panel stretches in it.
    expect(workspaceCss).toMatch(/\.pl-ws\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100vh/);
    expect(workspaceCss).toMatch(/\.pl-body\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0/);
    expect(workspaceCss).not.toMatch(/\.pl-panel\s*\{[^}]*align-self:/);
    expect(workspaceCss).not.toMatch(/pl-mac-desktop/); // N15: the frame starts under the host header
  });

  it("spaces a group heading that follows a tag list (stylesheet; happy-dom does not lay out)", () => {
    expect(workspaceCss).toMatch(/\.pl-tree \+ \.pl-group-header\s*\{[^}]*margin-top:\s*16px/);
  });

  it("expands the built-in group when the selected tag is built-in", async () => {
    const { ws } = await setup();
    await click(ws, "[data-control=tag]");
    await click(ws, `[data-popover=tag] [data-option="${tag("Task").ident}"]`);
    expect($("[data-action=toggle-built-in]")!.getAttribute("aria-expanded")).toBe("true");
    expect($("[data-tag-group=built-in]")!.hidden).toBe(false);
  });

  it("lists own tags first, then built-in ones, children nested under their parent", async () => {
    await setup();
    const groups = $$("[data-tag-group]").map((g) => g.dataset.tagGroup);
    expect(groups).toEqual(["own", "built-in"]);
    const own = $$("[data-tag-group=own] [data-tag-id]").map((b) => b.textContent?.replace(/\s+/g, " ").trim());
    expect(own).toEqual(["#Meeting", "#Project", "#Client project"]);
    const client = $(`[data-tag-group=own] [data-tag-id="${tag("Client project").id}"]`)!;
    expect(client.closest("li")!.parentElement!.closest("li")!.querySelector("[data-tag-id]")!.textContent).toContain("Project");
    expect($(`[data-tag-group=built-in] [data-tag-id="${tag("Task").id}"]`)).not.toBeNull();
  });

  it("marks the selected tag", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    expect($(`[data-tag-id="${tag("Project").id}"]`)!.getAttribute("aria-pressed")).toBe("true");
    expect($(`[data-tag-id="${tag("Meeting").id}"]`)!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("panel (N13)", () => {
  it("comes after the view: main, then the panel, so reading and Tab order match what is seen", async () => {
    await setup();
    const body = $(".pl-body")!;
    expect([...body.children].map((c) => c.getAttribute("data-region"))).toEqual(["main", "panel"]);
    const panel = $("aside")!;
    expect(panel.classList.contains("pl-panel")).toBe(true);
    expect(panel.getAttribute("data-region")).toBe("panel");
    expect(panel.id).toBe("pl-panel");
    expect(panel.getAttribute("aria-label")).toBe("Tags and filters");
    expect(panel.querySelector("nav[aria-label=Tags]")).not.toBeNull();
    expect(panel.querySelector("[data-filter-prop]")).not.toBeNull();
    expect($(".pl-sidebar, [data-region=sidebar]")).toBeNull();
  });

  it("view then panel columns, border on the panel's left edge, no sidebar names left (stylesheets)", () => {
    expect(workspaceCss).toMatch(/\.pl-body\s*\{[^}]*grid-template-columns:\s*1fr 220px/);
    expect(themeCss).toMatch(/\.pl-panel\s*\{[^}]*background:\s*var\(--pl-panel\);[^}]*border-left:\s*1px solid var\(--pl-line-soft\)/);
    expect(themeCss).not.toMatch(/border-right/);
    for (const css of [workspaceCss, themeCss]) expect(css).not.toMatch(/sidebar/i);
  });

  it("a Panel icon button (N48) hides and shows the panel; the view then takes the full width; focus stays on it", async () => {
    const { ws } = await setup();
    const btn = () => $("[data-action=toggle-panel]")!;
    expect(btn().tagName).toBe("BUTTON");
    expect($("[data-region=topbar]")!.contains(btn())).toBe(true);
    expect(btn().getAttribute("aria-controls")).toBe("pl-panel");
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    expect(btn().getAttribute("aria-label")).toBe("Panel");
    expect($("[data-region=panel]")!.hidden).toBe(false);
    expect($(".pl-body")!.classList.contains("is-panel-closed")).toBe(false);

    btn().focus();
    await click(ws, "[data-action=toggle-panel]");
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    expect($("[data-region=panel]")!.hidden).toBe(true);
    expect($(".pl-body")!.classList.contains("is-panel-closed")).toBe(true);
    expect(document.activeElement).toBe(btn());

    await click(ws, "[data-action=toggle-panel]");
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    expect($("[data-region=panel]")!.hidden).toBe(false);
    expect(document.activeElement).toBe(btn());
  });

  it("is kept for the session: a view switch, a tag change and a reopen leave it hidden", async () => {
    const { ws } = await setup();
    await click(ws, "[data-action=toggle-panel]");
    await click(ws, "[data-view-kind=kanban]");
    await click(ws, "[data-control=tag]");
    await click(ws, `[data-popover=tag] [data-option="${tag("Meeting").ident}"]`);
    await ws.open();
    expect($("[data-region=panel]")!.hidden).toBe(true);
    expect($("[data-action=toggle-panel]")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("with filters ticked and the panel hidden, the toggle shows how many values are ticked and says so", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    const status = choice(tag("Project"), "Status");
    const owner = choice(tag("Project"), "Owner");
    await click(ws, `input[data-filter-prop="${status.ident}"][data-filter-value="${status.values[0]!.uuid}"]`);
    await click(ws, `input[data-filter-prop="${owner.ident}"][data-filter-value=""]`);
    expect($("[data-action=toggle-panel]")!.getAttribute("aria-label")).toBe("Panel"); // the panel shows them
    expect($("[data-action=toggle-panel] .pl-badge")).toBeNull();
    await click(ws, "[data-action=toggle-panel]");
    expect(text("[data-action=toggle-panel] .pl-badge")).toBe("2");
    expect($("[data-action=toggle-panel]")!.getAttribute("aria-label")).toBe("Panel · 2 filters active");
  });

  it("hidden panel (stylesheet): the body has one column", () => {
    expect(workspaceCss).toMatch(/\.pl-body\.is-panel-closed\s*\{[^}]*grid-template-columns:\s*1fr\s*;/);
  });

  it("the empty filter state points at the panel, not a left column", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    const status = choice(tag("Project"), "Status");
    const unused = status.values.find((v) => $(`input[data-filter-value="${v.uuid}"]`)!.closest("label")!.querySelector(".pl-count")!.textContent === "0")!;
    await click(ws, `input[data-filter-prop="${status.ident}"][data-filter-value="${unused.uuid}"]`);
    expect(text("[data-empty=no-matches]")).toContain("Change the filters in the panel.");
  });
  it("a wide frame opens with the panel docked and shown", async () => {
    await setup();
    expect($(".pl-body")!.getAttribute("data-panel-mode")).toBe("docked");
    expect($("[data-region=panel]")!.hidden).toBe(false);
  });
});

describe("panel drawer at narrow widths (N13)", () => {
  const btn = () => $("[data-action=toggle-panel]")!;
  const panelHidden = () => $("[data-region=panel]")!.hidden;

  it("a frame narrower than 640 px starts with the panel closed, as a drawer; the toggle opens it", async () => {
    viewport(500);
    const { ws } = await setup();
    expect($(".pl-body")!.getAttribute("data-panel-mode")).toBe("drawer");
    expect(panelHidden()).toBe(true);
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    await click(ws, "[data-action=toggle-panel]");
    expect(panelHidden()).toBe(false);
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(btn());
  });

  it("Escape closes an open popover first, then the drawer (focus back on the toggle), then reports nothing left", async () => {
    viewport(500);
    const { ws } = await setup();
    await click(ws, "[data-action=toggle-panel]");
    await click(ws, "[data-control=tag]");
    expect(ws.escape()).toBe(true);
    expect($("[data-popover=tag]")).toBeNull();
    expect(panelHidden()).toBe(false);
    expect(ws.escape()).toBe(true);
    expect(panelHidden()).toBe(true);
    expect(document.activeElement).toBe(btn());
    expect(ws.escape()).toBe(false);
  });

  it("Escape leaves a docked panel alone", async () => {
    const { ws } = await setup();
    expect(ws.escape()).toBe(false);
    expect(panelHidden()).toBe(false);
  });

  it("a click on the view closes the drawer; a click inside it or on the bars above keeps it; the toggle closes it once", async () => {
    viewport(500);
    const { ws } = await setup();
    await click(ws, "[data-action=toggle-panel]");
    await click(ws, "[data-action=toggle-built-in]");
    expect(panelHidden()).toBe(false);
    await click(ws, "[data-view-kind=calendar]");
    expect(panelHidden()).toBe(false);
    await click(ws, "[data-region=view]");
    expect(panelHidden()).toBe(true);
    await click(ws, "[data-action=toggle-panel]");
    await click(ws, "[data-action=toggle-panel]");
    expect(panelHidden()).toBe(true);
  });

  it("a click on a node in the view opens it and the drawer is drawn closed", async () => {
    viewport(500);
    const store = createViewStore(fakeStorage());
    const openNode = vi.fn();
    const ws = createWorkspace(root, { dq: fixtureDq(), views: store, onClose: vi.fn(), openNode, zone: () => -300, today: () => "2026-10-03", time: () => "13:30", kanban: noWrites, dates: noDateWrites, weekStart: async () => 0 });
    await ws.open();
    await click(ws, "[data-action=toggle-panel]");
    await click(ws, "[data-tl-open]");
    expect(openNode).toHaveBeenCalledTimes(1);
    expect(panelHidden()).toBe(true);
    expect(btn().getAttribute("aria-expanded")).toBe("false");
  });

  it("crossing the breakpoint follows the defaults until the user chooses; a choice is kept per width", async () => {
    const { ws } = await setup();
    viewport(500);
    await ws.idle();
    expect($(".pl-body")!.getAttribute("data-panel-mode")).toBe("drawer");
    expect(panelHidden()).toBe(true);
    viewport(1024);
    await ws.idle();
    expect($(".pl-body")!.getAttribute("data-panel-mode")).toBe("docked");
    expect(panelHidden()).toBe(false);

    await click(ws, "[data-action=toggle-panel]"); // wide: hidden by choice
    viewport(500);
    await ws.idle();
    await click(ws, "[data-action=toggle-panel]"); // narrow: drawer opened by choice
    viewport(1024);
    await ws.idle();
    expect(panelHidden()).toBe(true);
    viewport(500);
    await ws.idle();
    expect(panelHidden()).toBe(false);
  });

  it("stop() removes the width listener", async () => {
    const { ws } = await setup();
    ws.stop();
    viewport(500);
    await ws.idle();
    await click(ws, "[data-action=toggle-panel]"); // any redraw: the width change was not seen
    expect($(".pl-body")!.getAttribute("data-panel-mode")).toBe("docked");
  });

  it("the drawer overlays the view from the right edge, under popovers (stylesheet; same breakpoint as the code)", () => {
    expect(NARROW_MEDIA).toBe("(max-width: 639px)");
    const media = workspaceCss.slice(workspaceCss.indexOf(`@media ${NARROW_MEDIA}`));
    expect(media).not.toBe(workspaceCss);
    expect(media).toMatch(/\.pl-body\s*\{[^}]*position:\s*relative;[^}]*grid-template-columns:\s*1fr/);
    const panel = media.match(/\.pl-panel\s*\{([^}]*)\}/)![1]!;
    expect(panel).toMatch(/position:\s*absolute/);
    expect(panel).toMatch(/right:\s*0/);
    expect(panel).toMatch(/width:\s*min\(260px,\s*85%\)/);
    expect(panel).toMatch(/box-shadow:\s*var\(--pl-shadow-float\)/);
    const z = Number(panel.match(/z-index:\s*(\d+)/)![1]);
    const popoverZ = Number(workspaceCss.match(/\.pl-popover\s*\{[^}]*z-index:\s*(\d+)/)![1]);
    expect(z).toBeGreaterThan(4); // above the views' sticky heads and labels (2 to 4)
    expect(z).toBeLessThan(popoverZ);
  });
});

describe("surface switch (N06a)", () => {
  it("is not rendered when the host cannot be docked into (no setSurface: web app, dev server)", async () => {
    await setup();
    expect($("[data-surface]")).toBeNull();
    expect($(".pl-ws")!.hasAttribute("data-surface-mode")).toBe(false);
  });

  it("a dock toggle in the top bar (N48), not pressed in the Workspace mode", async () => {
    await setup({ setSurface: vi.fn() });
    const dock = $("[data-region=topbar] [data-action=toggle-surface]")!;
    expect([dock.getAttribute("data-surface-to"), dock.getAttribute("aria-label"), (dock as HTMLButtonElement).type]).toEqual(["sidebar", "Dock to the right", "button"]);
    expect($(".pl-ws")!.getAttribute("data-surface-mode")).toBe("workspace");
  });

  it("a click toggles: the app is told, the pressed state and the root's mode follow, focus stays on it", async () => {
    const setSurface = vi.fn();
    const { ws } = await setup({ setSurface });
    $("[data-action=toggle-surface]")!.focus();
    await click(ws, "[data-action=toggle-surface]");
    expect(setSurface).toHaveBeenCalledWith("sidebar");
    expect($("[data-action=toggle-surface]")!.getAttribute("data-surface-to")).toBe("workspace");
    expect($(".pl-ws")!.getAttribute("data-surface-mode")).toBe("sidebar");
    expect(document.activeElement).toBe($("[data-action=toggle-surface]"));
    await click(ws, "[data-action=toggle-surface]");
    expect(setSurface).toHaveBeenLastCalledWith("workspace");
    expect($(".pl-ws")!.getAttribute("data-surface-mode")).toBe("workspace");
  });


  it("the header is one row that never wraps (N39: icon tabs, the rest in the ⋯ menu), tab names shown from 640 px (stylesheet; happy-dom does not lay out)", () => {
    const top = workspaceCss.match(/\.pl-top\s*\{[^}]*\}/)![0];
    expect(top).not.toMatch(/flex-wrap/);
    expect(top).toMatch(/align-items:\s*center/);
    expect(workspaceCss).toMatch(/\.pl-tab\s*>\s*\.pl-tab-label\s*\{\s*display:\s*none/);
    expect(workspaceCss).toMatch(/@container \(min-width: 640px\)/);
  });
});

describe("view switch", () => {
  it("updates the config kind and keeps the tag mapping", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "[data-view-kind=kanban]");
    expect(ws.config()).toMatchObject({ kind: "kanban", tags: [tag("Project").ident], dates: { [tag("Project").ident]: { start: dateIdent(tag("Project"), "Start") } }, columnProp: choice(tag("Project"), "Status").ident });
    expect($("[data-view-kind=kanban]")!.getAttribute("aria-pressed")).toBe("true");
    expect($("[data-view-kind=timeline]")!.getAttribute("aria-pressed")).toBe("false");
    expect($("[data-region=view] [data-kanban]")).not.toBeNull();
    expect($("[data-region=view-toolbar]")!.dataset.toolbarKind).toBe("kanban");
  });

  it("a click on the toolbar's range label, hint text, a field label or its padding changes nothing (T14 review)", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "[data-tl-zoom=week]");
    const before = JSON.stringify(ws.config());
    for (const sel of ["[data-tl-range]", "[data-region=view-toolbar]"]) {
      await click(ws, sel);
      expect(JSON.stringify(ws.config()), sel).toBe(before);
    }
    await click(ws, "[data-view-kind=kanban]");
    await click(ws, "[data-kb-sort=title]");
    const board = JSON.stringify(ws.config());
    for (const sel of ["[data-region=view-toolbar] .pl-hint", "[data-region=view-toolbar] .pl-field-label", "[data-region=view-toolbar]"]) {
      await click(ws, sel);
      expect(JSON.stringify(ws.config()), sel).toBe(board);
    }
  });
});

describe("saved views", () => {
  const save = async (ws: Workspace, name: string) => {
    await click(ws, "[data-control=saved-views]");
    $<HTMLInputElement>("[data-field=view-name]")!.value = name;
    await click(ws, "[data-action=save-view]");
  };

  it("save, open and delete go through the store and re-render", async () => {
    const { ws, store } = await setup();
    const create = vi.spyOn(store, "create");
    const remove = vi.spyOn(store, "remove");
    await pickTag(ws, "Project");
    await save(ws, "Roadmap");
    expect(create).toHaveBeenCalledWith("Roadmap", ws.config());
    expect(label("[data-control=saved-views]")).toContain("Roadmap");

    await pickTag(ws, "Meeting");
    await click(ws, "[data-control=saved-views]");
    const id = (await store.list())[0].id;
    expect(text(`[data-view-open="${id}"]`)).toBe("Roadmap");
    await click(ws, `[data-view-open="${id}"]`);
    expect(ws.config()!.tags).toEqual([tag("Project").ident]);
    expect(text("[data-control=tag]")).toContain("#Project");

    await click(ws, "[data-control=saved-views]");
    await click(ws, `[data-view-delete="${id}"]`);
    await click(ws, `[data-view-delete-confirm="${id}"]`);
    expect(remove).toHaveBeenCalledWith(id);
    expect($(`[data-view-open="${id}"]`)).toBeNull();
    expect(text("[data-popover=views]")).toContain("No saved views");
  });

  it("deleting asks first: × shows Delete / Cancel in the row, and only Delete removes the view (N23)", async () => {
    const { ws, store } = await setup();
    const remove = vi.spyOn(store, "remove");
    await pickTag(ws, "Project");
    await save(ws, "Roadmap");
    const id = (await store.list())[0].id;
    await click(ws, "[data-control=saved-views]");
    await click(ws, `[data-view-delete="${id}"]`);
    expect(remove).not.toHaveBeenCalled();
    expect(text(`[data-view-deleting="${id}"]`)).toContain('Delete "Roadmap"?');
    expect($(`[data-view-open="${id}"]`)).toBeNull(); // the row is the question now
    expect(document.activeElement).toBe($("[data-view-delete-cancel]")); // the safe choice has the focus

    await click(ws, "[data-view-delete-cancel]");
    expect(remove).not.toHaveBeenCalled();
    expect($("[data-view-deleting]")).toBeNull();
    expect(text(`[data-view-open="${id}"]`)).toBe("Roadmap");
    expect(document.activeElement).toBe($(`[data-view-delete="${id}"]`));

    await click(ws, `[data-view-delete="${id}"]`);
    await click(ws, "[data-control=saved-views]"); // closing the menu drops the question
    await click(ws, "[data-control=saved-views]");
    expect($("[data-view-deleting]")).toBeNull();
    expect(remove).not.toHaveBeenCalled();

    await click(ws, `[data-view-delete="${id}"]`);
    await click(ws, `[data-view-delete-confirm="${id}"]`);
    expect(remove).toHaveBeenCalledWith(id);
    expect(await store.list()).toEqual([]);
  });

  it("Update replaces the open saved view's settings in place, name kept (N23)", async () => {
    const { ws, store } = await setup();
    const update = vi.spyOn(store, "update");
    const create = vi.spyOn(store, "create");
    await pickTag(ws, "Project");
    await click(ws, "[data-control=saved-views]");
    expect($("[data-action=update-view]")).toBeNull(); // no saved view is open
    await click(ws, "[data-control=saved-views]");
    await save(ws, "Roadmap");
    const id = (await store.list())[0].id;

    await click(ws, "[data-view-kind=kanban]");
    await click(ws, "[data-control=saved-views]");
    expect(text("[data-action=update-view]")).toBe('Update "Roadmap"');
    await click(ws, "[data-action=update-view]");
    expect(update).toHaveBeenCalledWith(id, ws.config());
    expect(create).toHaveBeenCalledTimes(1);
    expect($("[data-popover=views]")).toBeNull(); // closed, as after Save
    expect(label("[data-control=saved-views]")).toContain("Roadmap");
    const stored = await store.list();
    expect(stored.map((v) => v.name)).toEqual(["Roadmap"]);
    expect("config" in stored[0] && stored[0].config.kind).toBe("kanban");
  });

  it("a failed Update shows the store's error and keeps the menu open", async () => {
    const storage = fakeStorage();
    const { ws } = await setup({ storage });
    await pickTag(ws, "Project");
    await save(ws, "Roadmap");
    await click(ws, "[data-view-kind=kanban]");
    await click(ws, "[data-control=saved-views]");
    storage.findPage = async () => null; // the page went to Recycle
    await click(ws, "[data-action=update-view]");
    expect($("[data-region=error]")).not.toBeNull();
    expect($("[data-popover=views]")).not.toBeNull();
  });

  it("suggests a name without markup and shows the sanitised name after saving (T14, F3)", async () => {
    const { ws, store } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "[data-control=saved-views]");
    expect($<HTMLInputElement>("[data-field=view-name]")!.value).toBe("Project timeline");
    await click(ws, "[data-control=saved-views]");
    await save(ws, "#Project [[kanban]]");
    expect(label("[data-control=saved-views]")).toBe("Saved views: Project kanban");
    expect((await store.list()).map((v) => v.name)).toEqual(["Project kanban"]);
  });

  it("shows a store error and lets the user dismiss it", async () => {
    const { ws } = await setup({ storage: fakeStorage({ silent: true }) });
    await pickTag(ws, "Project");
    await save(ws, "Roadmap");
    expect(text("[data-region=error]")).toContain("was not stored");
    expect($("[data-region=error]")!.getAttribute("role")).toBe("alert");
    await click(ws, "[data-action=dismiss-error]");
    expect($("[data-region=error]")).toBeNull();
  });

  it("after a failed write, the list shows what the store holds now (views on a recycled page disappear)", async () => {
    const storage = fakeStorage();
    const { ws } = await setup({ storage });
    await pickTag(ws, "Project");
    await save(ws, "Roadmap");
    await click(ws, "[data-control=saved-views]");
    expect(text("[data-popover=views]")).toContain("Roadmap");
    await click(ws, "[data-control=saved-views]"); // close it again
    storage.findPage = async () => null; // the page went to Recycle
    storage.createPage = async () => {}; // the host returns the recycled page and creates nothing
    await save(ws, "Second");
    expect(text("[data-region=error]")).toContain("If it is in Recycle");
    expect(text("[data-popover=views]")).toContain("No saved views yet"); // still open after the failed save
    expect(label("[data-control=saved-views]")).toContain("None");
  });

  it("an unreadable saved view is listed greyed with its reason, can be deleted, and cannot be opened (T14)", async () => {
    const good = serializeViewConfig(defaultViewConfig(tags.find((t) => t.title === "Project")!));
    const { ws } = await setup({ storage: fakeStorage({ blocks: [{ uuid: "v1", name: "Roadmap", config: good }, { uuid: "v2", name: "Broken", config: "{nope" }] }) });
    expect($("[data-region=error]")).toBeNull();
    await click(ws, "[data-control=saved-views]");
    expect($("[data-view-open=v1]")).not.toBeNull();
    expect($("[data-view-open=v2]")).toBeNull();
    const broken = $("[data-view-invalid=v2]")!;
    expect(broken.getAttribute("aria-disabled")).toBe("true");
    expect(broken.textContent).toContain("Broken");
    expect(broken.closest("li")!.textContent).toContain("not valid JSON");
    await click(ws, "[data-view-delete=v2]");
    await click(ws, "[data-view-delete-confirm=v2]");
    expect($("[data-view-invalid=v2]")).toBeNull();
    expect($("[data-view-open=v1]")).not.toBeNull();
  });

  it("shows a validation error for a saved view that names an unknown property", async () => {
    const project = tags.find((t) => t.title === "Project")!;
    const bad = { ...defaultViewConfig(project), dates: { [project.ident]: { start: ":user.property/gone", end: null } } };
    const { ws } = await setup({ storage: fakeStorage({ blocks: [{ uuid: "v1", name: "Broken", config: serializeViewConfig(bad) }] }) });
    await pickTag(ws, "Meeting");
    await click(ws, "[data-control=saved-views]");
    await click(ws, "[data-view-open=v1]");
    expect(text("[data-region=error]")).toContain("unknown date property");
    expect(ws.config()!.tags).toEqual([tag("Meeting").ident]); // the current view stays
  });
});

describe("Timeline Day zoom (N10)", () => {
  /** Day track width in px (timeline.ts `DAY_TRACK_PX`) and the scroll the Day view opens at for a first track `t`. */
  const opensAt = (t: number) => Math.max(0, t - 2) * DAY_TRACK_PX;
  const view = () => $("[data-region=view]")!;

  it("Day is the first zoom; it shows one day of 24 hour columns and steps by one day", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    expect($$("[data-tl-zoom]").map((b) => b.dataset.tlZoom)).toEqual(["day", "week", "month", "quarter"]);
    await click(ws, "[data-tl-zoom=day]");
    expect(ws.config()).toMatchObject({ kind: "timeline", zoom: "day" });
    expect($("[data-tl-zoom=day]")!.getAttribute("aria-pressed")).toBe("true");
    expect(text("[data-tl-range]")).toBe("Sat 3 Oct 2026");
    expect($$("[data-tl-col]")).toHaveLength(24);
    const config = JSON.stringify(ws.config());
    await click(ws, "[data-tl-nav=next]");
    expect(text("[data-tl-range]")).toBe("Sun 4 Oct 2026");
    await click(ws, "[data-tl-nav=prev]");
    await click(ws, "[data-tl-nav=prev]");
    expect(text("[data-tl-range]")).toBe("Fri 2 Oct 2026");
    await click(ws, "[data-tl-nav=today]");
    expect(text("[data-tl-range]")).toBe("Sat 3 Oct 2026");
    expect(JSON.stringify(ws.config())).toBe(config); // the anchor is session state
  });

  it("is saved with the view and restored when it is opened", async () => {
    const { ws, store } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "[data-tl-zoom=day]");
    await click(ws, "[data-control=saved-views]");
    await click(ws, "[data-action=save-view]");
    const id = (await store.list())[0].id;
    store.invalidate();
    await click(ws, "[data-tl-zoom=week]");
    await click(ws, "[data-control=saved-views]");
    await click(ws, `[data-view-open="${id}"]`);
    expect(ws.config()).toMatchObject({ kind: "timeline", zoom: "day" });
    expect(text("[data-tl-range]")).toBe("Sat 3 Oct 2026");
  });

  it("opens scrolled to the day's first timed item, or 08:00 on a day without one", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Meeting");
    await click(ws, "[data-tl-zoom=day]");
    expect(view().scrollLeft).toBe(opensAt(42)); // Kickoff 10:30
    await click(ws, "[data-tl-nav=next]");
    expect(view().scrollLeft).toBe(opensAt(95)); // Late review 23:45
    await click(ws, "[data-tl-nav=next]");
    expect(view().scrollLeft).toBe(opensAt(32)); // nothing: 08:00
    await click(ws, "[data-tl-nav=today]");
    expect(view().scrollLeft).toBe(opensAt(42));
  });

  it("does not move the user's scroll on a redraw of the same day: an expanded row, a live refresh", async () => {
    let time = "13:30";
    const { ws } = await setup({ time: () => time });
    await pickTag(ws, "Project");
    await click(ws, "[data-tl-zoom=day]");
    expect(view().scrollLeft).toBe(opensAt(32)); // Date-only spans only
    view().scrollLeft = 100;
    await click(ws, "[data-tl-toggle]");
    expect($$("[data-tl-task]").length).toBeGreaterThan(0);
    expect(view().scrollLeft).toBe(100);
    time = "14:00"; // the refresh redraws for the now line alone
    await ws.refresh();
    expect($("[data-tl-today]")!.getAttribute("style")).toContain("--pl-tl-today: 56");
    expect(view().scrollLeft).toBe(100);
    await click(ws, "[data-tl-zoom=week]");
    await click(ws, "[data-tl-zoom=day]"); // back to Day: opens again
    expect(view().scrollLeft).toBe(opensAt(32));
  });
});

describe("a throwing render never jams the action queue (T14)", () => {
  /** A `today` that throws the next `n` times it is asked (every view render asks it). */
  const flakyToday = () => {
    let n = 0;
    return { today: () => { if (n > 0) { n--; throw new Error("render broke"); } return "2026-10-03"; }, failNext: (k: number) => void (n = k) };
  };
  const make = async (clock: ReturnType<typeof flakyToday>, weekStart = async () => 0) => {
    const onClose = vi.fn();
    const ws = createWorkspace(root, { dq: fixtureDq(), views: createViewStore(fakeStorage()), onClose, openNode: vi.fn(), zone: () => -300, today: clock.today, kanban: noWrites, dates: noDateWrites, weekStart });
    await ws.open();
    return { ws, onClose };
  };

  it("a render that throws once shows the error; later actions, Close included, still run", async () => {
    const clock = flakyToday();
    const { ws, onClose } = await make(clock);
    clock.failNext(1);
    await click(ws, "[data-tl-zoom=week]");
    expect(text("[data-region=error]")).toContain("render broke");
    await click(ws, "[data-tl-zoom=quarter]");
    expect(ws.config()).toMatchObject({ kind: "timeline", zoom: "quarter" });
    expect($("[data-tl-zoom=quarter]")!.getAttribute("aria-pressed")).toBe("true");
    await click(ws, "[data-action=close]");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a render that keeps throwing still leaves the error bar and a working Close", async () => {
    const clock = flakyToday();
    const { ws, onClose } = await make(clock);
    clock.failNext(1000);
    await click(ws, "[data-tl-zoom=week]");
    expect(text("[data-region=error]")).toContain("render broke");
    await click(ws, "[data-action=close]");
    expect(onClose).toHaveBeenCalledTimes(1);
    clock.failNext(0);
    await click(ws, "[data-action=dismiss-error]");
    expect($("[data-tl-zoom=week]")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("a refresh whose redraw throws resolves, shows the error, and the next action runs", async () => {
    const clock = flakyToday();
    let start = 0;
    const { ws } = await make(clock, async () => start);
    start = 1; // the week start changed: the refresh redraws
    clock.failNext(2);
    await expect(ws.refresh()).resolves.toBeUndefined();
    expect(text("[data-region=error]")).toContain("render broke");
    await click(ws, "[data-action=dismiss-error]"); // the bare shell keeps Dismiss and Close
    await click(ws, "[data-tl-zoom=week]");
    expect(ws.config()).toMatchObject({ zoom: "week" });
  });
});

describe("reset for another graph (N04)", () => {
  it("returns to the state of a first open: no config, no tags, no error; session UI choices stay", async () => {
    const { ws } = await setup();
    await click(ws, "[data-view-kind=kanban]");
    await click(ws, "[data-action=toggle-panel]");
    expect(ws.config()!.kind).toBe("kanban");
    const panelBefore = $("[data-action=toggle-panel]")!.getAttribute("aria-expanded");
    await ws.reset();
    expect(ws.config()).toBeNull();
    expect($$("[data-tag-id]")).toHaveLength(0);
    expect($("[data-region=error]")).toBeNull();
    expect($("[data-action=toggle-panel]")!.getAttribute("aria-expanded")).toBe(panelBefore);
  });

  it("open after a reset on a graph without the old tag shows that graph's default view, no error", async () => {
    let graphB = false;
    const dq: Dq = async (q, ...i) => (graphB && q === TAGS_QUERY ? [] : fixtureDq()(q, ...i)) as never;
    const { ws } = await setup({ dq });
    expect(ws.config()).not.toBeNull();
    graphB = true;
    await ws.reset();
    await ws.open();
    expect($("[data-region=error]")).toBeNull();
    expect(ws.config()).toBeNull(); // this graph has no tags at all: the empty state
    expect($("[data-region=main]")?.textContent ?? root.textContent).toContain("No tags");
  });
});

describe("closing", () => {
  it("Escape closes an open popover first, then reports nothing left to close", async () => {
    const { ws } = await setup();
    await click(ws, "[data-control=tag]");
    expect($("[data-popover=tag]")).not.toBeNull();
    expect(ws.escape()).toBe(true);
    expect($("[data-popover=tag]")).toBeNull();
    expect(ws.escape()).toBe(false);
  });

  it("Escape with focus in the view-name input closes the saved-views popover and returns focus to its trigger", async () => {
    const { ws } = await setup();
    await click(ws, "[data-control=saved-views]");
    $<HTMLInputElement>("[data-field=view-name]")!.focus();
    expect(ws.escape()).toBe(true);
    expect($("[data-popover=views]")).toBeNull();
    expect(document.activeElement).toBe($("[data-control=saved-views]"));
    expect(ws.escape()).toBe(false);
  });

  it("keys typed in the view-name field stay there, except Cmd combos that are not editing keys (N16)", async () => {
    const { ws } = await setup();
    await click(ws, "[data-control=saved-views]");
    const hostWindow = new Window();
    const seen: string[] = [];
    hostWindow.document.body.addEventListener("keydown", (e) => {
      const k = e as unknown as KeyboardEvent;
      seen.push(`${k.metaKey ? "cmd+" : ""}${k.key}`);
    });
    const off = installHostKeys(document, hostWindow.document as unknown as HostDocument, { isVisible: () => true, focusFrame: () => {} });
    const input = $<HTMLInputElement>("[data-field=view-name]")!;
    const press = (key: string, init: KeyboardEventInit = {}) => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    press("t");
    press("a", { metaKey: true });
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(seen).toEqual([]);
    expect(enter.defaultPrevented).toBe(true); // Enter saves: Planner used it
    press("k", { metaKey: true });
    expect(seen).toEqual(["cmd+k"]);
    off();
  });

  it("the Close button calls onClose", async () => {
    const { ws, onClose } = await setup();
    await click(ws, "[data-action=close]");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a click outside an open popover closes it", async () => {
    const { ws } = await setup();
    await click(ws, "[data-control=tag]");
    await click(ws, "[data-region=main]");
    expect($("[data-popover]")).toBeNull();
  });
});

describe("week start (Logseq preferredStartOfWeek, read on every open)", () => {
  it("Monday start moves the Timeline range to Monday weeks", async () => {
    await setup({ weekStart: async () => 1 });
    expect(text("[data-tl-range]")).toBe("14 Sep – 8 Nov 2026");
  });

  it("re-reads the host setting on every open", async () => {
    let start = 0;
    const weekStart = vi.fn(async () => start);
    const { ws } = await setup({ weekStart });
    expect(text("[data-tl-range]")).toBe("13 Sep – 7 Nov 2026");
    start = 1;
    await ws.open();
    expect(weekStart).toHaveBeenCalledTimes(2);
    expect(text("[data-tl-range]")).toBe("14 Sep – 8 Nov 2026");
  });

  it("shows the error when the host value is invalid", async () => {
    await setup({ weekStart: async () => { throw new Error("Logseq preferredStartOfWeek is \"x\", expected 0–6"); } });
    expect(text("[data-region=error]")).toContain("preferredStartOfWeek");
  });
});

describe("a load failure on open (T14)", () => {
  it("week start or tags failing: only the error and a Retry button, never the no-tags state; Retry loads", async () => {
    for (const failing of ["weekStart", "tags"] as const) {
      let fail = true;
      const base = fixtureDq();
      const dq: Dq = async (q, ...i) => {
        if (failing === "tags" && fail && q === TAGS_QUERY) throw new Error("tags query failed");
        return base(q, ...i);
      };
      const weekStart = async () => {
        if (failing === "weekStart" && fail) throw new Error("week start failed");
        return 0;
      };
      document.body.innerHTML = "";
      root = document.createElement("div");
      document.body.append(root);
      const { ws } = await setup({ dq, weekStart });
      expect(text("[data-region=error]"), failing).toContain("failed");
      expect($("[data-empty=no-tags]"), failing).toBeNull();
      expect($("[data-action=retry]"), failing).not.toBeNull();
      fail = false;
      await click(ws, "[data-action=retry]");
      expect($("[data-action=retry]"), failing).toBeNull();
      expect($("[data-tag-group=own]"), failing).not.toBeNull();
      expect($("[data-tl-row], [data-tl-undated]"), failing).not.toBeNull();
    }
  });
});

describe("linked titles outside the loaded nodes (T11 live finding)", () => {
  const SITE = "6a000000-0000-4000-8000-000000000001";
  /** The fixture graph with its #Task blocks as #Task nodes, recording every query sent. */
  const recording = (over: Partial<Record<string, unknown[]>> = {}) => {
    const base = fixtureDq({ taskNodes: true });
    const sent: { query: string; inputs: unknown[] }[] = [];
    const dq: Dq = async (query, ...inputs) => {
      sent.push({ query, inputs });
      return over[query] ?? base(query, ...inputs);
    };
    return { dq, titleLookups: () => sent.filter((x) => x.query === TITLES_QUERY) };
  };
  const cardTitles = () => $$("[data-kb-card] .pl-kb-title").map((e) => e.textContent);

  it("#Task board: a task whose title links a #Project node shows the project's title; one lookup, missing uuids only", async () => {
    const { dq, titleLookups } = recording();
    const { ws } = await setup({ dq });
    await pickTag(ws, "Task");
    await click(ws, "[data-view-kind=kanban]");
    expect(cardTitles()).toEqual(expect.arrayContaining(["Draft brief Website relaunch", "Ship homepage Website relaunch", "Survey users Website relaunch"]));
    expect(cardTitles().join(" ")).not.toContain("(link)");
    expect(titleLookups()).toHaveLength(1); // the Task load; switching the view kind does not reload
    expect(titleLookups()[0].inputs).toEqual([[SITE]]);
  });

  it("sends no lookup when every linked node is loaded (#Project: its tasks link loaded projects)", async () => {
    const { dq, titleLookups } = recording();
    const { ws } = await setup({ dq });
    const before = titleLookups().length; // Meeting on open: no refs
    await pickTag(ws, "Project");
    await click(ws, "[data-view-kind=agenda]");
    expect(text("[data-region=view]")).toContain("Draft brief Website relaunch");
    expect(titleLookups().length).toBe(before);
    expect(before).toBe(0);
  });

  it("a uuid the lookup does not resolve keeps the (link) placeholder", async () => {
    const { dq } = recording({ [TITLES_QUERY]: [] });
    const { ws } = await setup({ dq });
    await pickTag(ws, "Task");
    await click(ws, "[data-view-kind=kanban]");
    expect(cardTitles()).toEqual(expect.arrayContaining(["Draft brief (link)"]));
  });
});

describe("Depends on (N12)", () => {
  // #Task nodes (the fixture task blocks) with the hand-written depends_on property (test-fakes `DEPENDS_ON`): Wireframes
  // and Ship homepage depend on Draft brief, so both reference it.
  const DEPS = { Wireframes: ["Draft brief"], "Ship homepage": ["Draft brief"] };
  const recorded = () => {
    const queries: string[] = [];
    const base = fixtureDq({ taskNodes: true, depends: DEPS });
    const dq: Dq = async (q, ...i) => (queries.push(q), base(q, ...i));
    return { dq, queries };
  };
  const row = (title: string) => $$("[data-tl-row]").find((r) => r.querySelector(".pl-tl-name")!.textContent!.startsWith(title))!;
  const count = (title: string) => row(title).querySelector(".pl-tl-count")?.textContent ?? null;
  const controls = () => $$("[data-region=settings] [data-control]").map((el) => el.dataset.control);

  it("a Depends on menu follows End when the tag has a node property: None plus the node properties, the default chosen", async () => {
    const { ws } = await setup({ dq: recorded().dq });
    await pickTag(ws, "Task");
    expect(controls().slice(controls().indexOf("end"), controls().indexOf("end") + 2)).toEqual(["end", "depends"]);
    expect(text("[data-control=depends]")).toContain("depends_on");
    expect($("#pl-depends-label")!.textContent).toBe("Depends on");
    expect(ws.config()).not.toHaveProperty("dependsOn"); // not chosen: the default rule shows depends_on
    await click(ws, "[data-control=depends]");
    expect($$("[data-popover=depends] [data-option]").map((o) => [o.dataset.option, o.textContent, o.getAttribute("aria-selected")]))
      .toEqual([["", "None", "false"], [DEPENDS_ON.ident, "depends_on", "true"]]);
    expect(document.activeElement).toBe($(`[data-popover=depends] [data-option="${DEPENDS_ON.ident}"]`));
    await pickTag(ws, "Meeting");
    expect($("[data-control=depends]")).toBeNull(); // no node property on Meeting
  });

  it("a second tag ticked: Depends on takes the default property of the new tags until the user chooses (N14)", async () => {
    const { ws } = await setup({ dq: recorded().dq });
    await pickTag(ws, "Meeting"); // no node property
    expect($("[data-control=depends]")).toBeNull();
    await click(ws, `[data-tag-check="${tag("Task").id}"]`);
    expect(text("[data-control=depends]")).toContain("depends_on");
    expect(ws.config()).not.toHaveProperty("dependsOn");
    expect($$("[data-tl-links] [data-tl-link]").length).toBeGreaterThan(0);
    await click(ws, "[data-control=depends]");
    await click(ws, '[data-popover=depends] [data-option=""]'); // None is a choice and stays through a tag change
    await click(ws, `[data-tag-check="${tag("Project").id}"]`);
    expect(ws.config()).toMatchObject({ dependsOn: null });
  });

  it("is not shown for a tag without node properties", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    expect($("[data-control=depends]")).toBeNull();
    expect(ws.config()).not.toHaveProperty("dependsOn");
  });

  it("dependents are not tasks: Draft brief has no task rows; None reloads with them back as its tasks, and back again", async () => {
    const { dq, queries } = recorded();
    const { ws } = await setup({ dq });
    await pickTag(ws, "Task");
    expect(count("Draft brief")).toBeNull();
    expect(row("Draft brief").querySelector("[data-tl-toggle]")).toBeNull();
    queries.length = 0;
    await click(ws, "[data-control=depends]");
    await click(ws, '[data-popover=depends] [data-option=""]');
    expect(ws.config()!.dependsOn).toBeNull();
    expect(queries).toContain(tasksQuery(null));
    expect(text("[data-control=depends]")).toContain("None");
    expect(document.activeElement).toBe($("[data-control=depends]"));
    expect(count("Draft brief")).toBe("1/2");
    await click(ws, "[data-control=depends]");
    await click(ws, `[data-popover=depends] [data-option="${DEPENDS_ON.ident}"]`);
    expect(ws.config()!.dependsOn).toBe(DEPENDS_ON.ident);
    expect(count("Draft brief")).toBeNull();
  });

  it("switching the view kind keeps the choice", async () => {
    const { ws } = await setup({ dq: recorded().dq });
    await pickTag(ws, "Task");
    await click(ws, "[data-control=depends]");
    await click(ws, '[data-popover=depends] [data-option=""]');
    await click(ws, "[data-view-kind=agenda]");
    expect(ws.config()).toMatchObject({ kind: "agenda", dependsOn: null });
  });

  it("a saved view keeps the choice; a view stored without the key opens with the default rule", async () => {
    const taskTag = tags.find((t) => t.title === "Task")!;
    const { dependsOn: _, ...old } = defaultViewConfig({ ...taskTag, nodeProps: [] });
    const storage = fakeStorage({ blocks: [{ uuid: "v1", name: "Old", config: serializeViewConfig(old) }] });
    const { ws, store } = await setup({ dq: recorded().dq, storage });
    await pickTag(ws, "Task");
    await click(ws, "[data-control=depends]");
    await click(ws, '[data-popover=depends] [data-option=""]');
    await click(ws, "[data-control=saved-views]");
    $<HTMLInputElement>("[data-field=view-name]")!.value = "No deps";
    await click(ws, "[data-action=save-view]");
    const saved = (await store.list()).find((v) => v.name === "No deps")!;
    expect("config" in saved && saved.config.dependsOn).toBeNull();

    await pickTag(ws, "Meeting");
    await click(ws, "[data-control=saved-views]");
    await click(ws, `[data-view-open="${saved.id}"]`);
    expect(ws.config()!.dependsOn).toBeNull();
    expect(text("[data-control=depends]")).toContain("None");
    expect(count("Draft brief")).toBe("1/2");

    await click(ws, "[data-control=saved-views]");
    await click(ws, "[data-view-open=v1]");
    expect(ws.config()!.dependsOn).toBeUndefined();
    expect(text("[data-control=depends]")).toContain("depends_on");
    expect(count("Draft brief")).toBeNull();
  });
});

describe("Timeline connectors (N12)", () => {
  const DEPS = { Wireframes: ["Draft brief"], "Ship homepage": ["Draft brief"] };
  const uuidOf = (title: string) => $$("[data-tl-row] .pl-tl-name").find((e) => e.textContent!.startsWith(title))!.dataset.tlOpen!;
  const links = () => $$("[data-tl-links] [data-tl-link]").map((p) => p.getAttribute("data-tl-link"));
  /** Fake layout boxes so the post-render step can measure: the timeline 1000 px wide, each span at `x` px per row index. */
  const fakeBoxes = (x = 100) => vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const spans = [...root.querySelectorAll("[data-tl-bar], [data-tl-point]")];
    const i = spans.indexOf(this);
    const [l, t, r, b] = this.hasAttribute("data-timeline") ? [0, 0, 1000, 400] : i >= 0 ? [x + i * 50, 40 + i * 32, x + i * 50 + 20, 60 + i * 32] : [0, 0, 0, 0];
    return { left: l, top: t, right: r, bottom: b, x: l, y: t, width: r - l, height: b - t, toJSON: () => ({}) } as DOMRect;
  });

  async function taskTimeline() {
    const { ws } = await setup({ dq: fixtureDq({ taskNodes: true, depends: DEPS }) });
    await pickTag(ws, "Task");
    await click(ws, "[data-tl-zoom=week]");
    return ws;
  }

  it("draws a path per dependency whose both ends are on screen; None removes them", async () => {
    const ws = await taskTimeline();
    expect(links()).toContain(`${uuidOf("Draft brief")}:${uuidOf("Wireframes")}`);
    expect($("[data-tl-links]")!.getAttribute("aria-hidden")).toBe("true");
    await click(ws, "[data-control=depends]");
    await click(ws, '[data-popover=depends] [data-option=""]');
    expect($("[data-tl-links]")).toBeNull();
    expect(links()).toEqual([]);
  });

  it("the post-render step sets each path's d after every render", async () => {
    const boxes = fakeBoxes();
    try {
      const ws = await taskTimeline();
      const path = () => $(`[data-tl-link="${uuidOf("Draft brief")}:${uuidOf("Wireframes")}"]`)!;
      expect(path().getAttribute("d")).toMatch(/^M\d/);
      // Any redraw (expand / collapse, nav, a menu) replaces the svg; the step draws the new one.
      const svg = $("[data-tl-links]");
      await click(ws, "[data-tl-nav=today]");
      expect($("[data-tl-links]")).not.toBe(svg);
      expect(path().getAttribute("d")).toMatch(/^M\d/);
    } finally {
      boxes.mockRestore();
    }
  });

  it("a window resize redraws the paths without a render; stop() removes the listener", async () => {
    let boxes = fakeBoxes(100);
    try {
      const ws = await taskTimeline();
      const path = () => $(`[data-tl-link="${uuidOf("Draft brief")}:${uuidOf("Wireframes")}"]`)!;
      const before = path().getAttribute("d");
      boxes.mockRestore();
      boxes = fakeBoxes(300);
      const svg = $("[data-tl-links]");
      window.dispatchEvent(new Event("resize"));
      expect($("[data-tl-links]")).toBe(svg); // not re-rendered
      const after = path().getAttribute("d");
      expect(after).not.toBe(before);
      ws.stop();
      boxes.mockRestore();
      boxes = fakeBoxes(500);
      window.dispatchEvent(new Event("resize"));
      expect(path().getAttribute("d")).toBe(after);
    } finally {
      boxes.mockRestore();
    }
  });

  it("views without connectors measure nothing after a render", async () => {
    const boxes = fakeBoxes();
    try {
      const { ws } = await setup();
      await pickTag(ws, "Project");
      boxes.mockClear();
      await click(ws, "[data-tl-zoom=week]");
      expect(boxes).not.toHaveBeenCalled();
    } finally {
      boxes.mockRestore();
    }
  });
});


describe("views over several tags (N14)", () => {
  const check = (title: string) => $<HTMLInputElement>(`[data-tag-check="${tag(title).id}"]`)!;
  const tick = (ws: Workspace, title: string) => click(ws, `[data-tag-check="${tag(title).id}"]`);
  const pressed = () => $$("[data-tag-id][aria-pressed=true]").map((b) => b.textContent);
  const save = async (ws: Workspace, name: string) => {
    await click(ws, "[data-control=saved-views]");
    $<HTMLInputElement>("[data-field=view-name]")!.value = name;
    await click(ws, "[data-action=save-view]");
  };

  it("every tag row has a checkbox before its button, named for the tag; the selected tag is ticked and cannot be unticked", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    const row = $(`[data-tag-id="${tag("Project").id}"]`)!;
    expect(row.previousElementSibling).toBe(check("Project"));
    expect(check("Project").getAttribute("aria-label")).toBe("Include #Project");
    expect([check("Project").checked, check("Project").disabled]).toEqual([true, true]);
    expect([check("Meeting").checked, check("Meeting").disabled]).toEqual([false, false]);
  });

  it("ticking a second tag shows the union, reads #Project + #Meeting, presses both rows; unticking goes back", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    const project = shownNodes();
    await pickTag(ws, "Meeting");
    const meeting = shownNodes();
    await pickTag(ws, "Project");
    await tick(ws, "Meeting");
    expect(ws.config()!.tags).toEqual([tag("Project").ident, tag("Meeting").ident]);
    expect(text("[data-control=tag]")).toBe("#Project + #Meeting▾");
    expect(pressed()).toEqual(["#Meeting", "#Project"]);
    expect([check("Project").disabled, check("Meeting").disabled]).toEqual([false, false]);
    expect(shownNodes()).toBe(project + meeting);
    expect($(".pl-tl-rows")!.getAttribute("aria-label")).toContain("#Project + #Meeting timeline");

    await tick(ws, "Project");
    expect(ws.config()!.tags).toEqual([tag("Meeting").ident]);
    expect(text("[data-control=tag]")).toBe("#Meeting▾");
    expect(shownNodes()).toBe(meeting);
    expect(check("Meeting").disabled).toBe(true);
  });

  it("a change event on the last tag's box (disabled) changes nothing", async () => {
    const { ws } = await setup();
    const before = ws.config();
    const box = check("Meeting");
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await ws.idle();
    expect(ws.config()).toBe(before);
  });

  it("a click on a tag's name still switches to that tag alone; the Tag menu still picks one tag", async () => {
    const { ws } = await setup();
    await tick(ws, "Project");
    await pickTag(ws, "Project");
    expect(ws.config()!.tags).toEqual([tag("Project").ident]);
    await tick(ws, "Meeting");
    await click(ws, "[data-control=tag]");
    expect($$("[data-popover=tag] [aria-selected=true]")).toHaveLength(0);
    await click(ws, `[data-popover=tag] [data-option="${tag("Meeting").ident}"]`);
    expect(ws.config()!.tags).toEqual([tag("Meeting").ident]);
  });

  it("Dates: one control with a row per tag (its own Start and End); a pick changes that tag only and keeps the popover open", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    await tick(ws, "Meeting");
    expect($("[data-control=start]")).toBeNull();
    expect(text("[data-control=dates]")).toBe("Dates: 2 tags▾");
    await click(ws, "[data-control=dates]");
    expect($$("[data-popover=dates] [data-dates-row] legend").map((l) => l.textContent)).toEqual(["#Project", "#Meeting"]);
    const field = (t: string, f: string) => `[data-dates-tag="${tag(t).ident}"][data-dates-field="${f}"]`;
    expect($(`${field("Meeting", "start")} [aria-selected=true]`)!.textContent).toBe("Date (DateTime)");
    expect($(`${field("Project", "end")} [role=listbox]`)!.getAttribute("aria-label")).toBe("End property of #Project");
    await click(ws, `${field("Project", "start")} [data-option="${dateIdent(tag("Project"), "End")}"]`);
    expect(ws.config()!.dates).toEqual({
      [tag("Project").ident]: { start: dateIdent(tag("Project"), "End"), end: dateIdent(tag("Project"), "End") },
      [tag("Meeting").ident]: { start: dateIdent(tag("Meeting"), "Date"), end: null },
    });
    expect($("[data-popover=dates]")).not.toBeNull();
    expect(document.activeElement).toBe($(`${field("Project", "start")} [data-option="${dateIdent(tag("Project"), "End")}"]`));
    await click(ws, `${field("Project", "end")} [data-option=""]`);
    expect(ws.config()!.dates[tag("Project").ident].end).toBeNull();
  });

  it("filters: only the properties every tag has, and a Tag group that shows one tag", async () => {
    const { ws } = await setup({ dq: fixtureDq({ taskNodes: true }) });
    await pickTag(ws, "Project");
    expect($$("[data-filter-group]").map((g) => g.dataset.filterGroup)).toEqual(choiceIdents(tag("Project")));
    await tick(ws, "Task");
    const status = choice(tag("Project"), "Status");
    expect($$("[data-filter-group]").map((g) => g.dataset.filterGroup)).toEqual(["@tag", status.ident]);
    expect(text("[data-filter-group=\"@tag\"] legend")).toBe("Tag");
    const tagRow = (t: string) => $(`[data-filter-prop="@tag"][data-filter-value="${tag(t).ident}"]`)!.closest("label")!;
    expect(tagRow("Project").textContent).toBe("#Project4");
    expect(tagRow("Task").textContent).toBe("#Task6");
    const all = shownNodes();
    await click(ws, `[data-filter-prop="@tag"][data-filter-value="${tag("Task").ident}"]`);
    expect(ws.config()!.filters).toEqual({ "@tag": [tag("Task").ident] });
    expect(shownNodes()).toBe(6);
    expect(all).toBe(10);
    // Unticking Task drops the Tag filter (one tag left) and keeps the shared Status.
    await click(ws, `[data-filter-prop="${status.ident}"][data-filter-value=""]`);
    await tick(ws, "Task");
    expect(ws.config()!.filters).toEqual({ [status.ident]: [null] });
  });

  it("Kanban over both tags by the shared Status; with no shared choice property it says so for the tags", async () => {
    const { ws } = await setup({ dq: fixtureDq({ taskNodes: true }) });
    await pickTag(ws, "Project");
    await tick(ws, "Task");
    await click(ws, "[data-view-kind=kanban]");
    expect(ws.config()).toMatchObject({ columnProp: choice(tag("Project"), "Status").ident });
    expect($$("[data-kb-card]")).toHaveLength(10);
    await click(ws, "[data-control=kb-lane]");
    expect($$("[data-popover=kb-lane] [data-option]").map((o) => o.textContent)).toEqual(["None", "Tag"]);
    await pickTag(ws, "Project");
    await tick(ws, "Meeting");
    expect(text("[data-empty=no-choice]")).toContain("#Project + #Meeting share no choice property");
  });

  it("Timeline: the Arrange control shows with two tags only; By tag heads each tag's rows", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    expect($("[data-tl-arrange]")).toBeNull();
    await tick(ws, "Meeting");
    expect(ws.config()).toMatchObject({ arrange: "nested" });
    expect($$("[data-tl-arrange]").map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["By date", "false"], ["By tag", "false"], ["Nested", "true"]]);
    expect($("[data-tl-group]")).toBeNull();
    await click(ws, "[data-tl-arrange=tag]");
    expect(ws.config()).toMatchObject({ arrange: "tag" });
    const list = $$(".pl-tl-rows > li").map((li) => li.dataset.tlGroup ? `# ${li.dataset.tlGroup}` : li.querySelector(".pl-tl-name")!.textContent);
    expect(list[0]).toBe(`# ${tag("Project").ident}`);
    const meetingAt = list.indexOf(`# ${tag("Meeting").ident}`);
    expect(meetingAt).toBeGreaterThan(1);
    expect(list.slice(meetingAt + 1)).toEqual(["Kickoff", "Late review"]);
    expect(text(`[data-tl-group="${tag("Meeting").ident}"]`)).toBe("#Meeting");
  });

  it("a saved view over two tags round trips; the name suggestion is the first tag +N", async () => {
    const { ws, store } = await setup();
    await pickTag(ws, "Project");
    await tick(ws, "Meeting");
    await click(ws, "[data-control=saved-views]");
    expect($<HTMLInputElement>("[data-field=view-name]")!.value).toBe("Project +1 timeline");
    await click(ws, "[data-control=saved-views]");
    await save(ws, "Both");
    const saved = ws.config()!;
    await pickTag(ws, "Meeting");
    const id = (await store.list())[0].id;
    await click(ws, "[data-control=saved-views]");
    await click(ws, `[data-view-open="${id}"]`);
    expect(ws.config()).toEqual(saved);
    expect(text("[data-control=tag]")).toBe("#Project + #Meeting▾");
  });

  it("a view saved before N14 (tag, start, end) opens as that one tag", async () => {
    const p = tag("Project");
    const { tags: _t, dates: _d, arrange: _a, ...rest } = defaultViewConfig(p) as unknown as Record<string, unknown>;
    const old = JSON.stringify({ v: 1, config: { ...rest, tag: p.ident, start: dateIdent(p, "End"), end: null } });
    const { ws } = await setup({ storage: fakeStorage({ blocks: [{ uuid: "v1", name: "Old", config: old }] }) });
    await click(ws, "[data-control=saved-views]");
    await click(ws, "[data-view-open=v1]");
    expect(ws.config()).toMatchObject({ tags: [p.ident], dates: { [p.ident]: { start: dateIdent(p, "End"), end: null } }, arrange: "date" });
    expect($("[data-region=error]")).toBeNull();
    expect(text("[data-control=start]")).toContain("End");
  });

  it("a saved view naming a tag that is gone opens with the tags that are left", async () => {
    const p = tag("Project");
    const config = { ...defaultViewConfig([p, tag("Meeting")]), tags: [p.ident, ":user.class/Gone"], dates: { [p.ident]: defaultViewConfig(p).dates[p.ident], ":user.class/Gone": { start: null, end: null } } };
    const { ws } = await setup({ storage: fakeStorage({ blocks: [{ uuid: "v1", name: "Gone", config: serializeViewConfig(config) }] }) });
    await click(ws, "[data-control=saved-views]");
    await click(ws, "[data-view-open=v1]");
    expect(ws.config()).toMatchObject({ tags: [p.ident], dates: { [p.ident]: config.dates[p.ident] }, arrange: "date" });
    expect($("[data-region=error]")).toBeNull();
  });
});

const choiceIdents = (t: TagInfo) => t.choiceProps.map((p) => p.ident);

describe("nested: parents and children (N14 step 2)", () => {
  const DEPS = { Wireframes: ["Draft brief"] };
  const nameOf = (li: HTMLElement) => li.querySelector(".pl-tl-name")!.textContent!;
  const rowList = () => $$(".pl-tl-rows > li").map((li) => (li.dataset.tlChildOf ? `  ${nameOf(li)}` : li.dataset.tlTask ? `  - ${nameOf(li)}` : nameOf(li)));
  const uuidOf = (title: string) => $$("[data-tl-row] .pl-tl-name").find((e) => e.textContent!.startsWith(title))!.dataset.tlOpen!;
  const links = () => $$("[data-tl-links] [data-tl-link]").map((p) => p.getAttribute("data-tl-link"));

  /** #Project + #Task (fixture tasks as nodes, Wireframes depends on Draft brief), Timeline. */
  async function nested() {
    const { ws } = await setup({ dq: fixtureDq({ taskNodes: true, depends: DEPS }) });
    await pickTag(ws, "Project");
    await click(ws, `[data-tag-check="${tag("Task").id}"]`);
    return ws;
  }

  it("Nested is the default with two tags: each parent with its children as full rows under it, open by default", async () => {
    const ws = await nested();
    expect(ws.config()).toMatchObject({ arrange: "nested" });
    expect(ws.config()).not.toHaveProperty("dependsOn");
    expect(rowList()).toEqual(["Website relaunch", "  Draft brief Website relaunch", "Acme rollout", "  Acme contract", "Mobile app", "  Wireframes"]);
    const child = $$("[data-tl-child-of]").find((li) => nameOf(li) === "Wireframes")!;
    expect(child.dataset.tlChildOf).toBe(uuidOf("Mobile app"));
    expect(child.querySelector("[data-tl-point], [data-tl-bar]")).not.toBeNull(); // its own bar or point
    expect(child.classList.contains("pl-tl-child")).toBe(true);
    const toggle = $(`[data-tl-toggle="${$$("[data-tl-row]").find((li) => nameOf(li) === "Mobile app")!.dataset.tlRow}"]`)!;
    expect([toggle.hasAttribute("data-tl-nested"), toggle.getAttribute("aria-expanded"), toggle.getAttribute("aria-label")]).toEqual([true, "true", "Hide rows under Mobile app"]);
    expect($("[data-tl-task]")).toBeNull(); // no marker rows for blocks that are rows themselves
  });

  it("a parent's count is its children; collapsing it hides them (and their connector) and is kept for the session", async () => {
    const ws = await nested();
    const site = $$("[data-tl-row]").find((li) => nameOf(li) === "Website relaunch")!;
    expect(site.querySelector(".pl-tl-count")!.textContent).toBe("1/2");
    expect(links()).toEqual([`${uuidOf("Draft brief")}:${uuidOf("Wireframes")}`]);
    await click(ws, `[data-tl-toggle="${site.dataset.tlRow}"]`);
    expect(rowList()).toEqual(["Website relaunch", "Acme rollout", "  Acme contract", "Mobile app", "  Wireframes"]);
    expect(links()).toEqual([]);
    await click(ws, "[data-view-kind=agenda]");
    await click(ws, "[data-view-kind=timeline]");
    expect(rowList()).toEqual(["Website relaunch", "Acme rollout", "  Acme contract", "Mobile app", "  Wireframes"]);
    await click(ws, `[data-tl-toggle="${site.dataset.tlRow}"]`);
    expect(rowList()[1]).toBe("  Draft brief Website relaunch");
  });

  it("By date and By tag list every node as its own row again", async () => {
    const ws = await nested();
    await click(ws, "[data-tl-arrange=date]");
    expect($("[data-tl-child-of]")).toBeNull();
    expect(rowList()).toHaveLength(6);
    await click(ws, "[data-tl-arrange=tag]");
    expect($("[data-tl-child-of]")).toBeNull();
    expect($$("[data-tl-group]")).toHaveLength(2);
  });

  it("Agenda by node: children are entries of their parent's group, not groups of their own; Kanban and Calendar do not nest", async () => {
    const ws = await nested();
    await click(ws, "[data-view-kind=agenda]");
    const group = (title: string) => $$("[data-ag-group]").find((g) => g.querySelector(".pl-ag-node-line .pl-ag-title")!.textContent === title);
    expect([...group("Mobile app")!.querySelectorAll(".pl-ag-list [data-ag-entry]")].map((e) => [e.getAttribute("data-ag-entry"), e.querySelector(".pl-ag-title")!.textContent]))
      .toEqual([["node", "Wireframes"]]);
    expect(group("Wireframes")).toBeUndefined();
    await click(ws, "[data-view-kind=kanban]");
    expect($$("[data-kb-card]")).toHaveLength(10);
  });

  it("one tag: no nesting, no refs pulled, rows as before", async () => {
    const { ws } = await setup({ dq: fixtureDq({ taskNodes: true, depends: DEPS }) });
    await pickTag(ws, "Task");
    expect($("[data-tl-child-of]")).toBeNull();
    expect($("[data-tl-nested]")).toBeNull();
    expect(ws.config()).toMatchObject({ arrange: "date" });
  });
});
