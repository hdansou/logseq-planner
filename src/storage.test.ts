import { describe, expect, it } from "vitest";
import tagsFixture from "./core/__fixtures__/tags.json";
import propsFixture from "./core/__fixtures__/class-properties.json";
import { buildTagInfos } from "./core/schema";
import { defaultViewConfig, serializeViewConfig } from "./core/view-config";
import type { ViewConfig } from "./core/view-config";
import { configSchemaFor, createViewStore, PAGE_TITLE } from "./storage";
import type { StorageDeps, ViewBlock } from "./types";

const tags = buildTagInfos(tagsFixture.query.detail as unknown[], propsFixture.query.detail as unknown[]);
const project = tags.find((t) => t.title === "Project")!;
const meeting = tags.find((t) => t.title === "Meeting")!;
const timeline = defaultViewConfig(project) as Extract<ViewConfig, { kind: "timeline" }>;
const calendar = defaultViewConfig(meeting, "calendar");

/** In-memory graph. `silent` makes the named writes resolve without changing anything, like the real API on failure. */
function fakeGraph(opts: { silent?: Array<"createPage" | "appendBlock" | "setConfig" | "removeBlock"> } = {}) {
  const log: string[] = [];
  const g = { page: null as string | null, blocks: [] as ViewBlock[], n: 0, ensured: 0, onWrite: (_: string) => {} };
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
      g.blocks.push({ uuid, name, config: null });
      return uuid;
    },
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

describe("create", () => {
  it("creates the page, appends the block, ensures the schema right before the config write, reads back", async () => {
    const { g, deps, log } = fakeGraph();
    const store = createViewStore(deps);
    const view = await store.create("Roadmap", timeline);
    expect(view).toEqual({ id: "b-1", name: "Roadmap", config: timeline });
    expect(log).toEqual([
      `findPage ${PAGE_TITLE}`, // load
      `createPage ${PAGE_TITLE}`,
      `findPage ${PAGE_TITLE}`, // read-back of the page
      "appendBlock page-1 Roadmap",
      "ensureProperty",
      "setConfig b-1",
      "readBlock b-1",
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

  it("re-resolves the page when appending fails: a page recycled mid-session gets the Recycle guidance (T07 D5)", async () => {
    const { g, deps } = fakeGraph();
    const append = deps.appendBlock;
    // Appending to a page that is no longer live (moved to Recycle) returns no block, as observed live.
    deps.appendBlock = async (p, name) => (p === g.page ? append(p, name) : null);
    const store = createViewStore(deps);
    const first = await store.create("Roadmap", timeline);
    g.page = null; // moved to Recycle: findPage no longer sees it
    await expect(store.create("Meetings", calendar)).rejects.toThrow('Page "Planner views" could not be created. If it is in Recycle (More menu → Recycle), restore it or delete it there, then save again.');
    expect(store.cached()).toEqual([first]);
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
