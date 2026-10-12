// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos, TAG_PROPERTIES_QUERY, TAGS_QUERY, type Dq } from "../core/schema";
import { defaultViewConfig, serializeViewConfig, type ViewConfig, type ViewKind } from "../core/view-config";
import { createViewStore, type ListedView } from "../storage";
import type { TagInfo, ViewBlock } from "../types";
import {
  createBlocks, failedViewBlock, findView, macroViewName, MAX_BLIND_SLOTS, OPEN_NODE, OPEN_VIEW, readOnly, unknownViewBlock, type BlockDeps,
} from "./block";
import { fakeStorage, fixtureDq } from "./test-fakes";

let tags: TagInfo[];
const tag = (title: string) => tags.find((t) => t.title === title)!;
const choiceIdent = (t: TagInfo, title: string) => t.choiceProps.find((p) => p.title === title)!.ident;

beforeEach(async () => {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
});

describe("macroViewName", () => {
  it("is Planner's macro only when the first argument is :planner", () => {
    expect(macroViewName([":h1", "hello"])).toBeNull();
    expect(macroViewName(["planner", "x"])).toBeNull();
    expect(macroViewName([])).toBeNull();
  });

  it("joins the rest with \", \" (names may contain commas) and trims", () => {
    expect(macroViewName([":planner", "Milestones with tasks"])).toBe("Milestones with tasks");
    expect(macroViewName([":planner", "Q1", "Q2 plan "])).toBe("Q1, Q2 plan");
    expect(macroViewName([":planner", "  Roadmap  "])).toBe("Roadmap");
    expect(macroViewName([":planner"])).toBe("");
    expect(macroViewName([":planner", ""])).toBe("");
  });
});

describe("findView", () => {
  const config = defaultViewConfig({ id: 1, uuid: "u", ident: ":user.class/A", title: "A", builtIn: false, parentIds: [], childIds: [], dateProps: [], choiceProps: [], nodeProps: [], fieldProps: [] });
  const views: ListedView[] = [
    { id: "1", name: "roadmap", config },
    { id: "2", name: "Roadmap", config },
    { id: "3", name: "Broken", invalid: "Unsupported view config version" },
  ];
  it("takes the exact name first, then ignores case", () => {
    expect(findView(views, "Roadmap")?.id).toBe("2");
    expect(findView(views, "roadmap")?.id).toBe("1");
    expect(findView(views, "ROADMAP")?.id).toBe("1");
    expect(findView(views, "broken")?.id).toBe("3");
    expect(findView(views, "Nope")).toBeNull();
  });
});

describe("message blocks", () => {
  it("unknown name: the message, then the names that exist", () => {
    const html = unknownViewBlock("Mileston<es>", [{ id: "1", name: "A & B", invalid: "x" }, { id: "2", name: "C", invalid: "y" }]);
    expect(html).toContain('class="planner-block"');
    expect(html).toContain("data-planner-message");
    expect(html).toContain("No saved Planner view named “Mileston&lt;es&gt;”. Saved views: “A &amp; B”, “C”.");
  });

  it("unknown name without any saved view: says to save one", () => {
    expect(unknownViewBlock("X", [])).toContain("No saved Planner view named “X”. Save a view in Planner first.");
  });

  it("a view that cannot be shown: its name and the reason, escaped", () => {
    expect(failedViewBlock("A<b>", "Unknown <tag>")).toContain("<b>“A&lt;b&gt;”</b> cannot be shown: Unknown &lt;tag&gt;");
  });
});

describe("readOnly", () => {
  const ro = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = readOnly(html, document);
    return d;
  };

  it("gives every node opener data-on-click and the uuid", () => {
    const d = ro(`<button data-tl-open="u1"></button><button data-cal-open="u2"></button><button data-ag-open="u3"></button><button data-kb-open="u4"></button>`);
    expect([...d.querySelectorAll("[data-on-click]")].map((e) => [e.getAttribute("data-on-click"), e.getAttribute("data-uuid")]))
      .toEqual([[OPEN_NODE, "u1"], [OPEN_NODE, "u2"], [OPEN_NODE, "u3"], [OPEN_NODE, "u4"]]);
  });

  it("takes out connectors, Move menus, drag, workspace actions and Timeline toggles (a placeholder keeps the column)", () => {
    const d = ro(`<svg data-tl-links></svg><div data-kb-card="c" draggable="true"><span class="pl-anchor pl-kb-move-anchor"><button data-kb-move="c">⋯</button></span></div>`
      + `<button data-action="clear-filters">Clear filters</button><button class="pl-tl-toggle" data-tl-toggle="7" aria-expanded="true">▸</button>`
      + `<div class="pl-kb-cell"><span class="pl-kb-drop">Drop here</span></div>`);
    expect(d.querySelector("[data-tl-links], [data-kb-move], [draggable], [data-action], [data-tl-toggle]")).toBeNull();
    expect(d.querySelector(".pl-tl-toggle")!.outerHTML).toBe('<span class="pl-tl-toggle" aria-hidden="true"></span>');
    expect(d.querySelector(".pl-kb-drop")!.textContent).toBe("");
  });

  it("show more becomes \"N more\" text; jumps and +N more become text in place", () => {
    const d = ro(`<button data-ag-more="" data-rest="124">Show 100 more of 124</button><button data-kb-more="a|" data-rest="1071">Show 50 more of 1,071</button>`
      + `<button class="pl-link" data-tl-jump="earlier" data-tl-day="2026-01-01">3 earlier</button>`
      + `<button class="pl-cal-more" data-cal-more="2026-10-01" style="grid-column: 4; grid-row: 5">+2 more</button>`);
    expect([...d.querySelectorAll(".pl-block-more")].map((e) => e.textContent)).toEqual(["124 more", "1,071 more"]);
    expect(d.querySelector("button")).toBeNull();
    const jump = d.querySelector("[data-planner-text].pl-link")!;
    expect(jump.textContent).toBe("3 earlier");
    const more = d.querySelector("[data-planner-text].pl-cal-more")!;
    expect([more.tagName, more.textContent, more.getAttribute("style")]).toEqual(["SPAN", "+2 more", "grid-column: 4; grid-row: 5"]);
  });

  it("closes folded Agenda buckets (their entries stay, for the browser's own toggle)", () => {
    const d = ro(`<details data-ag-bucket="later" open><summary>Later</summary><ul><li><button data-ag-open="u"></button></li></ul></details>`);
    expect(d.querySelector("details")!.hasAttribute("open")).toBe(false);
    expect(d.querySelector("details [data-ag-open]")).not.toBeNull();
  });
});

// ---------------------------------------------------------------- createBlocks

const saved = (uuid: string, name: string, config: ViewConfig): ViewBlock => ({ uuid, name, config: serializeViewConfig(config) });

function setup(opts: { blocks?: ViewBlock[]; dq?: Dq; host?: boolean } = {}) {
  const shown = new Map<string, string>();
  const dq = vi.fn(opts.dq ?? fixtureDq());
  const provideUI = vi.fn((ui: { slot: string; template: string }) => {
    shown.set(ui.slot, ui.template);
    const el = document.getElementById(ui.slot);
    if (el) el.innerHTML = ui.template;
  });
  const deps: BlockDeps = {
    dq, views: createViewStore(fakeStorage({ blocks: opts.blocks ?? [] })), weekStart: vi.fn(async () => 0), zone: () => -300,
    today: () => "2026-10-03", time: () => "13:30", provideUI, host: opts.host === false ? null : document, doc: document,
  };
  const blocks = createBlocks(deps);
  /** A slot element in the "host" page, then the macro event for it. */
  const slot = async (id: string, args: string[], uuid = `block-${id}`) => {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
    await blocks.slotted({ slot: id, payload: { arguments: args, uuid } });
    await blocks.idle();
    return el;
  };
  /** Graph reads other than the tag schema: the view loads. */
  const loads = () => dq.mock.calls.filter(([q]) => q !== TAGS_QUERY && q !== TAG_PROPERTIES_QUERY).length;
  return { blocks, deps, shown, provideUI, slot, loads, dq };
}

const kinds: ViewKind[] = ["timeline", "calendar", "agenda", "kanban", "matrix"];

describe("createBlocks: a saved view in a page", () => {
  it.each(kinds)("draws the %s view under a header: name, tags, Open in Planner", async (kind) => {
    const { slot } = setup({ blocks: [saved("v-1", "Projects <all>", defaultViewConfig(tag("Project"), kind))] });
    const el = await slot("slot__a", [":planner", "Projects <all>"]);
    const block = el.querySelector<HTMLElement>(".planner-block[data-planner-block]")!;
    expect(block.dataset.viewKind).toBe(kind);
    expect(block.querySelector(".pl-block-name")!.textContent).toBe("Projects <all>");
    expect(block.querySelector(".pl-block-tags")!.textContent).toBe("#Project");
    const open = block.querySelector<HTMLElement>(`[data-on-click="${OPEN_VIEW}"]`)!;
    expect([open.textContent, open.dataset.viewId]).toEqual(["Open in Planner", "v-1"]);
    // The view itself, read-only: openers hooked, nothing to drag, no menus, no toolbar.
    expect(block.querySelector(`[data-on-click="${OPEN_NODE}"][data-uuid]`)).not.toBeNull();
    expect(block.querySelector("[draggable], [data-kb-move], [data-mx-move], [data-mx-more], [data-popover], [data-control], [data-tl-toggle], [data-tl-links], [data-action]")).toBeNull();
    expect(block.querySelector("[data-tl-nav], [data-cal-nav], [data-tl-zoom], [data-kb-sort], [data-ag-group-by], [data-mx-mode], [data-mx-show-done]")).toBeNull();
    // N64: no hint asks for a drag or a ⋯ menu the block does not have.
    expect(block.textContent).not.toMatch(/Drag a card|⋯ menu/);
    // N06c: never editable in a page: no Edit dates toggle, handles, edit marks or description.
    expect(block.querySelector("[data-tl-edit], [data-tl-handle], [data-tl-editable], [data-tl-locked], [data-tl-pending], [data-tl-edit-help], [aria-describedby]")).toBeNull();
  });

  it.each(kinds)("the %s view sits in its own wrapper beside the header, so only the view scrolls (N06b width fix)", async (kind) => {
    const { slot } = setup({ blocks: [saved("v-1", "P", defaultViewConfig(tag("Project"), kind))] });
    const block = (await slot("slot__a", [":planner", "P"])).querySelector<HTMLElement>(".planner-block")!;
    const [head, view] = [...block.children] as HTMLElement[];
    expect([head.className, view.className]).toEqual(["pl-block-head", "pl-block-view"]);
    expect(block.children).toHaveLength(2);
    expect(head.querySelector("[data-on-click]")).not.toBeNull();
    expect(view.querySelector(".pl-block-head, [data-on-click=\"" + OPEN_VIEW + "\"]")).toBeNull();
    expect(view.children.length).toBeGreaterThan(0);
  });

  it("Timeline nested: children render under their open parent; no toggles, no connectors, marker task rows folded", async () => {
    const config = { ...defaultViewConfig([tag("Project"), tag("Task")], "timeline"), arrange: "nested" as const };
    const { slot } = setup({ blocks: [saved("v-1", "Nested", config)], dq: fixtureDq({ taskNodes: true, depends: { Wireframes: ["Draft brief"] } }) });
    const el = await slot("slot__a", [":planner", "Nested"]);
    const names = [...el.querySelectorAll<HTMLElement>(".pl-tl-rows > li")].map((li) => (li.dataset.tlChildOf ? "  " : "") + li.querySelector(".pl-tl-name")!.textContent);
    expect(names).toEqual(["Website relaunch", "  Draft brief Website relaunch", "Acme rollout", "  Acme contract", "Mobile app", "  Wireframes"]);
    expect(el.querySelector("[data-tl-toggle], [data-tl-links], [data-tl-link]")).toBeNull();
  });

  it("Timeline of one tag: the rows' task rows stay folded (they open only by a toggle)", async () => {
    const { slot } = setup({ blocks: [saved("v-1", "Projects", defaultViewConfig(tag("Project")))] });
    const el = await slot("slot__a", [":planner", "Projects"]);
    expect(el.querySelector("[data-tl-row] .pl-tl-count")).not.toBeNull(); // rows that have tasks
    expect(el.querySelector("[data-tl-task]")).toBeNull();
  });

  it("Kanban: hidden columns stay hidden; a long cell ends in \"N more\" text", async () => {
    const status = choiceIdent(tag("Project"), "Status");
    const base = defaultViewConfig(tag("Project"), "kanban");
    if (base.kind !== "kanban") throw new Error("kanban config expected");
    const first = tag("Project").choiceProps.find((p) => p.ident === status)!.values[0].uuid;
    const { slot } = setup({ blocks: [saved("v-1", "Board", { ...base, hiddenColumns: { [status]: [first] } })], dq: fixtureDq({ projectCopies: 120 }) });
    const el = await slot("slot__a", [":planner", "Board"]);
    expect(el.querySelector(`[data-kb-column="${first}"]`)).toBeNull();
    expect([...el.querySelectorAll(".pl-block-more")].map((e) => e.textContent)).toEqual(["71 more"]);
    expect(el.querySelector("[data-kb-more]")).toBeNull();
  });

  it("Agenda by node: the groups past the first page are \"N more\" text", async () => {
    const { slot } = setup({ blocks: [saved("v-1", "Agenda", defaultViewConfig(tag("Project"), "agenda"))], dq: fixtureDq({ projectCopies: 220 }) });
    const el = await slot("slot__a", [":planner", "Agenda"]);
    expect([...el.querySelectorAll(".pl-block-more")].map((e) => e.textContent)).toEqual(["124 more"]);
  });

  it("ignores other renderer macros", async () => {
    const { slot, provideUI, blocks } = setup();
    await slot("slot__a", [":h1", "hello"]);
    expect(provideUI).not.toHaveBeenCalled();
    expect(blocks.slots()).toEqual([]);
  });

  it("unknown name: the message with the saved names; case-insensitive match shows the view", async () => {
    const { slot } = setup({ blocks: [saved("v-1", "Roadmap", defaultViewConfig(tag("Project")))] });
    expect((await slot("slot__a", [":planner", "Road map"])).textContent).toBe("No saved Planner view named “Road map”. Saved views: “Roadmap”.");
    expect((await slot("slot__b", [":planner", "roadmap"])).querySelector("[data-timeline]")).not.toBeNull();
  });

  it("an unreadable saved view shows its parse error", async () => {
    const { slot } = setup({ blocks: [{ uuid: "v-1", name: "Old", config: "{not json" }] });
    const el = await slot("slot__a", [":planner", "Old"]);
    expect(el.textContent).toMatch(/^“Old” cannot be shown: .+/);
  });

  it("a load failure becomes the block's message, never a rejection", async () => {
    const dq: Dq = async (q) => {
      if (q === TAGS_QUERY) throw new Error("worker gone");
      return fixtureDq()(q);
    };
    const { slot } = setup({ blocks: [saved("v-1", "Roadmap", defaultViewConfig(tag("Project")))], dq });
    expect((await slot("slot__a", [":planner", "Roadmap"])).textContent).toBe("Planner could not load: worker gone");
  });
});

describe("createBlocks: registry and refresh", () => {
  it("two blocks of the same view share one load per pass", async () => {
    const view = saved("v-1", "Roadmap", defaultViewConfig(tag("Project")));
    const one = setup({ blocks: [view] });
    await one.slot("slot__a", [":planner", "Roadmap"]);
    await one.blocks.refresh();
    const single = one.loads();

    document.body.innerHTML = "";
    const two = setup({ blocks: [view] });
    for (const id of ["slot__a", "slot__b"]) {
      const el = document.createElement("div");
      el.id = id;
      document.body.append(el);
    }
    await two.blocks.slotted({ slot: "slot__a", payload: { arguments: [":planner", "Roadmap"], uuid: "b1" } });
    await two.blocks.slotted({ slot: "slot__b", payload: { arguments: [":planner", "roadmap"], uuid: "b2" } }); // asked during the first pass
    await two.blocks.idle();
    two.dq.mockClear();
    await two.blocks.refresh();
    expect(two.provideUI).toHaveBeenCalledTimes(4); // a, b; then both again
    expect(two.loads()).toBe(single / 2); // one refresh with two blocks loads what one block loads per pass
  });

  it("refresh redraws every live slot and drops the ones whose element is gone", async () => {
    const { slot, blocks, provideUI } = setup({ blocks: [saved("v-1", "Roadmap", defaultViewConfig(tag("Project")))] });
    const a = await slot("slot__a", [":planner", "Roadmap"]);
    await slot("slot__b", [":planner", "Roadmap"]);
    a.remove();
    provideUI.mockClear();
    await blocks.refresh();
    expect(provideUI.mock.calls.map(([ui]) => ui.slot)).toEqual(["slot__b"]);
    expect(blocks.slots()).toEqual(["slot__b"]);
  });

  it("each slot gets its own provideUI key, replacing what it showed", async () => {
    const { slot, provideUI } = setup({ blocks: [saved("v-1", "Roadmap", defaultViewConfig(tag("Project")))] });
    await slot("slot__a", [":planner", "Roadmap"]);
    expect(provideUI).toHaveBeenCalledWith(expect.objectContaining({ key: "planner-block-slot__a", slot: "slot__a", reset: true }));
  });

  it("cross-origin: every kept slot is redrawn, and only the newest 20 are kept", async () => {
    const { blocks, provideUI } = setup({ blocks: [saved("v-1", "Roadmap", defaultViewConfig(tag("Project")))], host: false });
    for (let i = 0; i < MAX_BLIND_SLOTS + 3; i++) await blocks.slotted({ slot: `slot__${i}`, payload: { arguments: [":planner", "Roadmap"], uuid: `b${i}` } });
    await blocks.idle();
    expect(blocks.slots()).toHaveLength(MAX_BLIND_SLOTS);
    expect(blocks.slots()[0]).toBe("slot__3");
    provideUI.mockClear();
    await blocks.refresh();
    expect(provideUI).toHaveBeenCalledTimes(MAX_BLIND_SLOTS);
  });

  it("a refresh with no blocks reads nothing", async () => {
    const { blocks, dq } = setup();
    await blocks.refresh();
    expect(dq).not.toHaveBeenCalled();
  });

  it("reads the saved views afresh on every pass (a view saved meanwhile shows)", async () => {
    const storage = fakeStorage({ blocks: [] });
    const { deps } = setup();
    deps.views = createViewStore(storage);
    const blocks = createBlocks(deps);
    const el = document.createElement("div");
    el.id = "slot__a";
    document.body.append(el);
    await blocks.slotted({ slot: "slot__a", payload: { arguments: [":planner", "Later"], uuid: "b" } });
    await blocks.idle();
    expect(el.textContent).toContain("Save a view in Planner first.");
    await deps.views.create("Later", defaultViewConfig(tag("Project")));
    await blocks.refresh();
    expect(el.querySelector("[data-timeline]")).not.toBeNull();
  });
});
