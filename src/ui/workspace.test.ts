// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos, type Dq } from "../core/schema";
import { defaultViewConfig, serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { StorageDeps, TagInfo } from "../types";
import { createWorkspace, initialTag, visibleData, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq, noWrites } from "./test-fakes";
import { loadNodes, loadNodesAndTasks, TITLES_QUERY } from "../core/queries";
import workspaceCss from "./workspace.css?inline";

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

async function setup(opts: { dq?: Dq; storage?: StorageDeps; weekStart?: () => Promise<number> } = {}) {
  const store = createViewStore(opts.storage ?? fakeStorage());
  const onClose = vi.fn();
  const ws = createWorkspace(root, { dq: opts.dq ?? fixtureDq(), views: store, onClose, openNode: vi.fn(), zone: () => -300, today: () => "2026-10-03", kanban: noWrites, weekStart: opts.weekStart ?? (async () => 0) });
  await ws.open();
  return { ws, store, onClose };
}
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

beforeEach(async () => {
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
    expect(ws.config()).toMatchObject({ tag: tag("Project").ident, start: dateIdent(tag("Project"), "Start"), end: dateIdent(tag("Project"), "End") });
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
    expect(ws.config()).toMatchObject({ tag: tag("Meeting").ident, start: dateIdent(tag("Meeting"), "Date"), end: null, filters: {}, doneValues: {} });
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
    expect(ws.config()!.end).toBeNull();
    expect(text("[data-control=end]")).toContain("None");
    await click(ws, "[data-control=start]");
    await click(ws, `[data-popover=start] [data-option="${dateIdent(tag("Project"), "End")}"]`);
    expect(ws.config()!.start).toBe(dateIdent(tag("Project"), "End"));
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

describe("initial tag (T07 D3)", () => {
  it("opens on the first own root tag with dates in tree order: Meeting, not the child Client project", async () => {
    const { ws } = await setup();
    expect(ws.config()!.tag).toBe(tag("Meeting").ident);
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
    const nodes = (await loadNodes(fixtureDq(), tags, tag("Project"), { childTags: true, zone })).filter((n) => n.choices[owner.ident]?.id === alice.id);
    const ids = new Set(nodes.map((n) => n.id));
    const loaded = await loadNodesAndTasks(fixtureDq(), tags, tag("Project"), { childTags: true, zone });
    const expected = loaded.tasks.filter((t) => t.nodeIds.some((id) => ids.has(id))).length;
    expect(expected).toBeLessThan(loaded.tasks.length);
    const config = { ...defaultViewConfig(tag("Project")), filters: { [owner.ident]: [alice.uuid] } };
    const shown = visibleData(config, tag("Project"), loaded.nodes, loaded.tasks);
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

  it("runs the left column to the bottom of the window (T07 open item; stylesheet, happy-dom does not lay out)", () => {
    // The body takes the remaining height whether or not the error row is present, and the sidebar stretches in it.
    expect(workspaceCss).toMatch(/\.pl-ws\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100vh/);
    expect(workspaceCss).toMatch(/\.pl-body\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0/);
    expect(workspaceCss).not.toMatch(/\.pl-sidebar\s*\{[^}]*align-self:/);
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

describe("view switch", () => {
  it("updates the config kind and keeps the tag mapping", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    await click(ws, "[data-view-kind=kanban]");
    expect(ws.config()).toMatchObject({ kind: "kanban", tag: tag("Project").ident, start: dateIdent(tag("Project"), "Start"), columnProp: choice(tag("Project"), "Status").ident });
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
    expect(text("[data-control=saved-views]")).toContain("Roadmap");

    await pickTag(ws, "Meeting");
    await click(ws, "[data-control=saved-views]");
    const id = (await store.list())[0].id;
    expect(text(`[data-view-open="${id}"]`)).toBe("Roadmap");
    await click(ws, `[data-view-open="${id}"]`);
    expect(ws.config()!.tag).toBe(tag("Project").ident);
    expect(text("[data-control=tag]")).toContain("#Project");

    await click(ws, "[data-control=saved-views]");
    await click(ws, `[data-view-delete="${id}"]`);
    expect(remove).toHaveBeenCalledWith(id);
    expect($(`[data-view-open="${id}"]`)).toBeNull();
    expect(text("[data-popover=views]")).toContain("No saved views");
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
    expect(text("[data-control=saved-views]")).toContain("None");
  });

  it("shows a validation error for a saved view that names an unknown property", async () => {
    const bad = { ...defaultViewConfig(tags.find((t) => t.title === "Project")!), start: ":user.property/gone" };
    const { ws } = await setup({ storage: fakeStorage({ blocks: [{ uuid: "v1", name: "Broken", config: serializeViewConfig(bad) }] }) });
    await pickTag(ws, "Meeting");
    await click(ws, "[data-control=saved-views]");
    await click(ws, "[data-view-open=v1]");
    expect(text("[data-region=error]")).toContain("unknown date property");
    expect(ws.config()!.tag).toBe(tag("Meeting").ident); // the current view stays
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
