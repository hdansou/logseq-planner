import { describe, expect, it } from "vitest";
import tagsFixture from "./core/__fixtures__/tags.json";
import propsFixture from "./core/__fixtures__/class-properties.json";
import { buildTagInfos } from "./core/schema";
import { defaultViewConfig, serializeViewConfig } from "./core/view-config";
import type { ViewConfig } from "./core/view-config";
import { configSchemaFor, createViewStore, PAGE_TITLE, sanitizeViewName } from "./storage";
import type { StorageDeps, ViewBlock } from "./types";
import { hostTags, hostTitle } from "./ui/test-fakes";

const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
const project = tags.find((t) => t.title === "Project")!;
const meeting = tags.find((t) => t.title === "Meeting")!;
const timeline = defaultViewConfig(project) as Extract<ViewConfig, { kind: "timeline" }>;
const calendar = defaultViewConfig(meeting, "calendar");

/** In-memory graph. `silent` makes the named writes resolve without changing anything, like the real API on failure. */
function fakeGraph(opts: { silent?: Array<"createPage" | "appendBlock" | "setConfig" | "removeBlock"> } = {}) {
  const log: string[] = [];
  const g = { page: null as string | null, blocks: [] as ViewBlock[], tags: new Map<string, number>(), n: 0, ensured: 0, onWrite: (_: string) => {} };
  const silent = (k: string) => (opts.silent ?? []).includes(k as never);
  const deps: StorageDeps = {
    findPage: async (title) => (log.push(`findPage ${title}`), g.page),
    createPage: async (title) => {
      log.push(`createPage ${title}`);
      g.onWrite("createPage");
      if (!silent("createPage")) g.page = "page-1";
    },
    ensureConfigProperty: async () => void (log.push("ensureProperty"), g.ensured++),
    listBlocks: async (p) => (log.push(`listBlocks ${p}`), g.blocks.map((b) => ({ ...b }))),
    readBlock: async (u) => (log.push(`readBlock ${u}`), g.blocks.find((b) => b.uuid === u) ?? null),
    appendBlock: async (p, name) => {
      log.push(`appendBlock ${p} ${name}`);
      g.onWrite("appendBlock");
      if (silent("appendBlock")) return "ghost";
      const uuid = `b-${++g.n}`;
      g.blocks.push({ uuid, name: hostTitle(name), config: null });
      g.tags.set(uuid, hostTags(name));
      return uuid;
    },
    blockTags: async (u) => (log.push(`blockTags ${u}`), g.tags.get(u) ?? 0),
    setConfig: async (u, text) => {
      log.push(`setConfig ${u}`);
      g.onWrite("setConfig");
      const b = g.blocks.find((x) => x.uuid === u);
      if (!silent("setConfig") && b) b.config = text;
    },
    removeBlock: async (u) => {
      log.push(`removeBlock ${u}`);
      g.onWrite("removeBlock");
      if (!silent("removeBlock")) g.blocks = g.blocks.filter((b) => b.uuid !== u);
    },
  };
  return { g, deps, log };
}

describe("configSchemaFor", () => {
  it("creates the property hidden when missing, only hides an existing one, nothing when hidden", () => {
    expect(configSchemaFor(null)).toEqual({ type: "string", hide: true });
    expect(configSchemaFor({ type: "default", hide: false })).toEqual({ hide: true });
    expect(configSchemaFor({ type: "string", hide: true })).toBeNull();
  });
});

describe("list", () => {
  it("is empty and creates nothing when the page does not exist", async () => {
    const { deps, log } = fakeGraph();
    const store = createViewStore(deps);
    expect(await store.list()).toEqual([]);
    expect(log).toEqual([`findPage ${PAGE_TITLE}`]);
  });

  it("reads the page once, skips blocks without config, then serves the cache", async () => {
    const { g, deps, log } = fakeGraph();
    g.page = "page-1";
    g.blocks = [
      { uuid: "x", name: "Roadmap", config: serializeViewConfig(timeline) },
      { uuid: "y", name: "stray note", config: null },
    ];
    const store = createViewStore(deps);
    expect(await store.list()).toEqual([{ id: "x", name: "Roadmap", config: timeline }]);
    await store.list();
    expect(log.filter((l) => l.startsWith("listBlocks"))).toHaveLength(1);
  });

  it("throws, naming the view, on a stored config it cannot parse", async () => {
    const { g, deps } = fakeGraph();
    g.page = "page-1";
    g.blocks = [{ uuid: "x", name: "Broken", config: "{nope" }];
    await expect(createViewStore(deps).list()).rejects.toThrow(/Broken/);
  });
});

describe("recycled page", () => {
  it("only a recycled page exists: findPage sees none, so list is empty and create calls createPage", async () => {
    const { g, deps, log } = fakeGraph();
    const view = { uuid: "old", name: "Old", config: serializeViewConfig(timeline) };
    g.blocks = [view];
    // the strict query ignores recycled pages, so the fake reports no page
    const store = createViewStore(deps);
    expect(await store.list()).toEqual([]);
    await store.create("New", timeline);
    expect(log).toContain(`createPage ${PAGE_TITLE}`);
  });
});

describe("saved-view names (T14, F3)", () => {
  it("sanitises: drops # [ ] { }, folds runs of ( or ) to one, collapses spaces", () => {
    expect(sanitizeViewName("#Project kanban")).toBe("Project kanban");
    expect(sanitizeViewName("  [[Roadmap]]  {{query x}} ((6a00)) ")).toBe("Roadmap query x (6a00)");
    expect(sanitizeViewName("Q3 (draft)")).toBe("Q3 (draft)");
    expect(sanitizeViewName("#[[]]")).toBe("");
  });

  it("writes and returns the sanitised name; the host cannot tag the block", async () => {
    const { g, deps } = fakeGraph();
    const store = createViewStore(deps);
    const view = await store.create("#Project kanban", timeline);
    expect(view.name).toBe("Project kanban");
    expect(g.blocks[0].name).toBe("Project kanban");
    expect(g.tags.get(view.id)).toBe(0);
    expect((await store.list())[0].name).toBe("Project kanban");
  });

  it("a name that is only markup is rejected before touching the graph", async () => {
    const { deps, log } = fakeGraph();
    await expect(createViewStore(deps).create("#[[]]", timeline)).rejects.toThrow(/needs a name/);
    expect(log).toEqual([]);
  });

  it("a block the host tagged anyway is removed and the error says why (no orphan)", async () => {
    const { g, deps } = fakeGraph();
    deps.blockTags = async () => 1;
    const store = createViewStore(deps);
    await expect(store.create("Roadmap", timeline)).rejects.toThrow('Saved view "Roadmap" was stored with tags or a changed title, so it was removed. Use a name without #, [[ ]], {{ }} or (( )).');
    expect(g.blocks).toEqual([]);
    expect(store.cached()).toEqual([]);
  });

  it("a block whose title the host rewrote is removed", async () => {
    const { g, deps } = fakeGraph();
    const append = deps.appendBlock;
    deps.appendBlock = async (p) => append(p, "#Other");
    await expect(createViewStore(deps).create("Roadmap", timeline)).rejects.toThrow(/stored with tags or a changed title/);
    expect(g.blocks).toEqual([]);
  });

  it("a failed config write removes the block it created", async () => {
    const { g, deps, log } = fakeGraph({ silent: ["setConfig"] });
    await expect(createViewStore(deps).create("Roadmap", timeline)).rejects.toThrow(/was not stored/);
    expect(log).toContain("removeBlock b-1");
    expect(g.blocks).toEqual([]);
  });

  it("a config write that throws removes the block too", async () => {
    const { g, deps } = fakeGraph();
    deps.ensureConfigProperty = async () => { throw new Error("schema refused"); };
    await expect(createViewStore(deps).create("Roadmap", timeline)).rejects.toThrow("schema refused");
    expect(g.blocks).toEqual([]);
  });

  it("when removing the block fails as well, the error says so", async () => {
    const { deps } = fakeGraph({ silent: ["setConfig", "removeBlock"] });
    await expect(createViewStore(deps).create("Roadmap", timeline)).rejects.toThrow(/was not stored.*could not be removed: block b-1 still exists/);
  });
});

describe("create", () => {
  it("creates the page, appends the block, ensures the schema right before the config write, reads back", async () => {
    const { g, deps, log } = fakeGraph();
    const store = createViewStore(deps);
    const view = await store.create("Roadmap", timeline);
    expect(view).toEqual({ id: "b-1", name: "Roadmap", config: timeline });
    expect(log).toEqual([
      `findPage ${PAGE_TITLE}`, // load
      `findPage ${PAGE_TITLE}`, // live page, looked up right before the append
      `createPage ${PAGE_TITLE}`,
      `findPage ${PAGE_TITLE}`, // read-back of the page
      "appendBlock page-1 Roadmap",
      "ensureProperty",
      "setConfig b-1",
      "readBlock b-1",
      "blockTags b-1",
    ]);
    expect(g.blocks[0].config).toBe(serializeViewConfig(timeline));
    expect(await store.list()).toEqual([view]);
  });

  it("updates the cache before any write is sent", async () => {
    const { g, deps } = fakeGraph();
    const store = createViewStore(deps);
    const seen: Record<string, number> = {};
    g.onWrite = (w) => void (seen[w] = store.cached().length);
    await store.create("Roadmap", timeline);
    expect(seen).toEqual({ createPage: 1, appendBlock: 1, setConfig: 1 });
  });

  it("reuses an existing page and keeps existing views", async () => {
    const { g, deps, log } = fakeGraph();
    g.page = "page-1";
    g.blocks = [{ uuid: "x", name: "Old", config: serializeViewConfig(timeline) }];
    const store = createViewStore(deps);
    await store.create("New", calendar);
    expect(log.some((l) => l.startsWith("createPage"))).toBe(false);
    expect((await store.list()).map((v) => v.name)).toEqual(["Old", "New"]);
  });

  it("throws and rolls the cache back when the config write is silently dropped", async () => {
    const { deps } = fakeGraph({ silent: ["setConfig"] });
    const store = createViewStore(deps);
    await expect(store.create("Roadmap", timeline)).rejects.toThrow(/read back|stored/i);
    expect(store.cached()).toEqual([]);
  });

  it("throws when the block was not really created", async () => {
    const { deps } = fakeGraph({ silent: ["appendBlock"] });
    const store = createViewStore(deps);
    await expect(store.create("Roadmap", timeline)).rejects.toThrow(/read back|stored/i);
    expect(store.cached()).toEqual([]);
  });

  it("throws when the page was not really created", async () => {
    const { deps } = fakeGraph({ silent: ["createPage"] });
    const store = createViewStore(deps);
    await expect(store.create("Roadmap", timeline)).rejects.toThrow('Page "Planner views" could not be created. If it is in Recycle (More menu → Recycle), restore it or delete it there, then save again.');
    expect(store.cached()).toEqual([]);
  });

  it("looks the live page up before every append: a page recycled mid-session is never written to (T07 D5)", async () => {
    // The host's createPage returns a same-titled recycled page and creates nothing; appending by uuid into it works.
    const { g, deps, log } = fakeGraph({ silent: ["createPage"] });
    g.page = "page-1";
    const store = createViewStore(deps);
    await store.create("Roadmap", timeline);
    g.page = null; // moved to Recycle: findPage no longer sees it, appendBlock("page-1") would still succeed
    await expect(store.create("Meetings", calendar)).rejects.toThrow('Page "Planner views" could not be created. If it is in Recycle (More menu → Recycle), restore it or delete it there, then save again.');
    expect(log.filter((l) => l.startsWith("appendBlock"))).toHaveLength(1);
    expect(store.cached()).toEqual([]); // the views on the recycled page are gone from the cache too
    expect(await store.list()).toEqual([]);
  });

  it.each(["update", "remove"] as const)("%s refuses a view whose page went to Recycle (T07 D5)", async (op) => {
    const { g, deps, log } = fakeGraph();
    const store = createViewStore(deps);
    const v = await store.create("Roadmap", timeline);
    g.page = null; // recycled; the block itself would still accept writes by uuid
    const call = op === "update" ? store.update(v.id, calendar) : store.remove(v.id);
    await expect(call).rejects.toThrow(/could not be created\. If it is in Recycle/);
    expect(log.filter((l) => l.startsWith("setConfig"))).toHaveLength(1); // only the create's write
    expect(log.filter((l) => l.startsWith("removeBlock"))).toHaveLength(0);
    expect(store.cached()).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it("still says the block was not created when the page is live", async () => {
    const { g, deps } = fakeGraph();
    g.page = "page-1";
    deps.appendBlock = async () => null;
    await expect(createViewStore(deps).create("Roadmap", timeline)).rejects.toThrow("appendBlock returned no block");
  });

  it("rejects an empty name before touching the graph", async () => {
    const { deps, log } = fakeGraph();
    await expect(createViewStore(deps).create("  ", timeline)).rejects.toThrow(/name/i);
    expect(log).toEqual([]);
  });
});

describe("update", () => {
  it("replaces the config, cache first, and reads back", async () => {
    const { g, deps } = fakeGraph();
    const store = createViewStore(deps);
    const v = await store.create("Roadmap", timeline);
    const next = { ...timeline, zoom: "quarter" as const };
    let cachedAtWrite: unknown;
    g.onWrite = () => void (cachedAtWrite = store.cached()[0].config);
    await store.update(v.id, next);
    expect(cachedAtWrite).toEqual(next);
    expect(JSON.parse(g.blocks[0].config!).config.zoom).toBe("quarter");
    expect(g.ensured).toBe(2);
  });

  it("throws and restores the cache when the write is dropped", async () => {
    const { g, deps } = fakeGraph();
    const store = createViewStore(deps);
    const v = await store.create("Roadmap", timeline);
    const dropping: StorageDeps = { ...deps, setConfig: async () => {} };
    const store2 = createViewStore(dropping);
    await store2.list();
    await expect(store2.update(v.id, { ...timeline, zoom: "week" })).rejects.toThrow(/read back|stored/i);
    expect(store2.cached()[0].config).toEqual(timeline);
    expect(g.blocks[0].config).toBe(serializeViewConfig(timeline));
  });

  it("throws on an unknown id", async () => {
    const { deps } = fakeGraph();
    await expect(createViewStore(deps).update("nope", timeline)).rejects.toThrow(/unknown saved view/i);
  });
});

describe("remove", () => {
  it("drops the view from the cache first, then deletes and checks the block is gone", async () => {
    const { g, deps } = fakeGraph();
    const store = createViewStore(deps);
    const v = await store.create("Roadmap", timeline);
    let cachedAtWrite = -1;
    g.onWrite = () => void (cachedAtWrite = store.cached().length);
    await store.remove(v.id);
    expect(cachedAtWrite).toBe(0);
    expect(g.blocks).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it("throws and restores the view when the block is still there", async () => {
    const { deps } = fakeGraph({ silent: ["removeBlock"] });
    const store = createViewStore(deps);
    const v = await store.create("Roadmap", timeline);
    await expect(store.remove(v.id)).rejects.toThrow(/still exists|read back/i);
    expect(store.cached().map((x) => x.id)).toEqual([v.id]);
  });
});
