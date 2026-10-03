// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import tagsFixture from "../core/__fixtures__/tags.json";
import propsFixture from "../core/__fixtures__/class-properties.json";
import nodesFixture from "../core/__fixtures__/nodes.json";
import datesFixture from "../core/__fixtures__/dates.json";
import tasksFixture from "../core/__fixtures__/tasks.json";
import { loadTagInfos, TAG_PROPERTIES_QUERY, TAGS_QUERY, type Dq } from "../core/schema";
import { JOURNAL_DAYS_QUERY, NODES_QUERY, TASKS_QUERY } from "../core/queries";
import { defaultViewConfig, serializeViewConfig } from "../core/view-config";
import { createViewStore } from "../storage";
import type { StorageDeps, TagInfo, ViewBlock } from "../types";
import { createWorkspace, type Workspace } from "./workspace";

/** Answers the real loaders' queries from the T01 fixtures; nodes exist for Project (+ Client project) and Meeting only. */
const fixtureDq = (opts: { noTags?: boolean } = {}): Dq => async (query, ...inputs) => {
  if (query === TAGS_QUERY) return opts.noTags ? [] : (tagsFixture.query.detail as unknown[]);
  if (query === TAG_PROPERTIES_QUERY) return opts.noTags ? [] : (propsFixture.query.detail as unknown[]);
  if (query === NODES_QUERY) {
    if (inputs[0] === "Project") return nodesFixture.projectWithExtends.detail as unknown[];
    if (inputs[0] === "Meeting") return nodesFixture.meeting.detail as unknown[];
    return [];
  }
  if (query === JOURNAL_DAYS_QUERY) return datesFixture.date.detail as unknown[];
  if (query === TASKS_QUERY) return tasksFixture.taskRefs.detail as unknown[];
  throw new Error(`unexpected query ${query}`);
};

/** In-memory saved-views graph; `silent` writes resolve without storing anything, like the real API on failure. */
function fakeStorage(opts: { silent?: boolean; blocks?: ViewBlock[] } = {}): StorageDeps {
  let page: string | null = opts.blocks ? "page-1" : null;
  let blocks: ViewBlock[] = opts.blocks ?? [];
  let n = 0;
  return {
    findPage: async () => page,
    createPage: async () => void (page = "page-1"),
    ensureConfigProperty: async () => {},
    listBlocks: async () => blocks.map((b) => ({ ...b })),
    readBlock: async (u) => blocks.find((b) => b.uuid === u) ?? null,
    appendBlock: async (_p, name) => {
      if (opts.silent) return "ghost";
      const uuid = `b-${++n}`;
      blocks.push({ uuid, name, config: null });
      return uuid;
    },
    setConfig: async (u, text) => {
      const b = blocks.find((x) => x.uuid === u);
      if (b) b.config = text;
    },
    removeBlock: async (u) => void (blocks = blocks.filter((b) => b.uuid !== u)),
  };
}

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
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;

async function setup(opts: { dq?: Dq; storage?: StorageDeps } = {}) {
  const store = createViewStore(opts.storage ?? fakeStorage());
  const onClose = vi.fn();
  const ws = createWorkspace(root, { dq: opts.dq ?? fixtureDq(), views: store, onClose, zone: () => -300 });
  await ws.open();
  return { ws, store, onClose };
}
async function click(ws: Workspace, sel: string) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.click();
  await ws.idle();
}
const pickTag = (ws: Workspace, title: string) => click(ws, `[data-tag-id="${tag(title).id}"]`);

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

  it("shows a placeholder with the node count when there are nodes", async () => {
    const { ws } = await setup();
    await pickTag(ws, "Project");
    expect($("[data-empty]")).toBeNull();
    expect(text("[data-region=view-placeholder]")).toContain("4 nodes");
    expect(text("[data-region=view-placeholder]")).toContain("Timeline");
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
    expect(text("[data-region=view-placeholder]")).toContain("3 nodes");
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
    expect(text("[data-region=view-placeholder]")).toContain("3 nodes");
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

describe("tag tree", () => {
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
    expect(text("[data-region=view-placeholder]")).toContain("Kanban");
    expect($("[data-region=view-toolbar]")!.dataset.viewKind).toBe("kanban");
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
