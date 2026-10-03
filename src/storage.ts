// Cache-first saved views on a plugin-owned page: one block per view, the config JSON in a hidden string
// property. No SDK import: the SDK arrives as `StorageDeps` (see `storageDeps` in src/sdk.ts).
// The write API resolves null on success AND on failure (docs/probes.md), so every write is read back.
import { parseViewConfig, serializeViewConfig } from "./core/view-config";
import type { ViewConfig } from "./core/view-config";
import type { StorageDeps, ViewBlock } from "./types";

export const PAGE_TITLE = "Planner views";
/** Property name: the host strips spaces and the name is its visible title, so it is specific and hyphenated (gotcha §29). */
export const CONFIG_KEY = "planner-view-config";

export interface SavedView {
  /** The block uuid. */
  id: string;
  name: string;
  config: ViewConfig;
}

/**
 * Schema to apply before every config write: create the property hidden when missing, only hide it when it
 * exists (never change an existing type), nothing when already hidden (gotcha §30; same rule as Query Builder).
 */
export function configSchemaFor(existing: { type?: string; hide?: boolean } | null): { type?: "string"; hide: true } | null {
  if (!existing) return { type: "string", hide: true };
  return existing.hide ? null : { hide: true };
}

const mismatch = (what: string, id: string) => new Error(`Saved view ${what} was not stored (read back differs) for block ${id}`);

/** The saved-views store the workspace uses. */
export type ViewStore = ReturnType<typeof createViewStore>;

export function createViewStore(deps: StorageDeps) {
  let cache: SavedView[] | null = null;
  let pageUuid: string | null = null;
  let pending = 0;

  const toView = (b: ViewBlock): SavedView => {
    try {
      return { id: b.uuid, name: b.name, config: parseViewConfig(b.config!) };
    } catch (e) {
      throw new Error(`Saved view "${b.name}": ${(e as Error).message}`);
    }
  };

  async function load(): Promise<SavedView[]> {
    if (cache) return cache;
    pageUuid = await deps.findPage(PAGE_TITLE);
    const blocks = pageUuid ? await deps.listBlocks(pageUuid) : [];
    cache = blocks.filter((b) => b.config !== null).map(toView);
    return cache;
  }

  async function ensurePage(): Promise<string> {
    if (pageUuid) return pageUuid;
    await deps.createPage(PAGE_TITLE);
    pageUuid = await deps.findPage(PAGE_TITLE);
    // Observed host behaviour: with a same-titled page in Recycle, createPage returns that recycled page and creates nothing.
    if (!pageUuid) throw new Error(`Page "${PAGE_TITLE}" could not be created. If it is in Recycle (More menu → Recycle), restore it or delete it there, then save again.`);
    return pageUuid;
  }

  /** Writes `text` into the config property and checks the stored text is identical. */
  async function writeConfig(id: string, text: string) {
    await deps.ensureConfigProperty();
    await deps.setConfig(id, text);
    const stored = await deps.readBlock(id);
    if (stored?.config !== text) throw mismatch("config", id);
    return stored;
  }

  const find = (views: SavedView[], id: string) => {
    const i = views.findIndex((v) => v.id === id);
    if (i < 0) throw new Error(`Unknown saved view ${id}`);
    return i;
  };

  return {
    /** All saved views, in page order. Reads the graph once, then serves the cache. */
    list: async (): Promise<SavedView[]> => [...(await load())],
    /** The cache as it is now (empty before the first `list`/write). */
    cached: (): SavedView[] => [...(cache ?? [])],

    async create(name: string, config: ViewConfig): Promise<SavedView> {
      const title = name.trim();
      if (!title) throw new Error("A saved view needs a name");
      const views = await load();
      const entry: SavedView = { id: `pending-${++pending}`, name: title, config };
      views.push(entry); // cache first
      try {
        const page = await ensurePage();
        const id = await deps.appendBlock(page, title);
        if (!id) throw new Error("appendBlock returned no block");
        const stored = await writeConfig(id, serializeViewConfig(config));
        if (stored.name.trim() !== title) throw mismatch("name", id);
        entry.id = id;
        return { ...entry };
      } catch (e) {
        views.splice(views.indexOf(entry), 1);
        throw e;
      }
    },

    /** Replaces the config of a saved view (the name stays). */
    async update(id: string, config: ViewConfig): Promise<SavedView> {
      const views = await load();
      const i = find(views, id);
      const before = views[i];
      views[i] = { ...before, config }; // cache first
      try {
        await writeConfig(id, serializeViewConfig(config));
        return views[i];
      } catch (e) {
        views[i] = before;
        throw e;
      }
    },

    async remove(id: string): Promise<void> {
      const views = await load();
      const i = find(views, id);
      const [before] = views.splice(i, 1); // cache first
      try {
        await deps.removeBlock(id);
        if (await deps.readBlock(id)) throw new Error(`Saved view block ${id} still exists after removal (read back)`);
      } catch (e) {
        views.splice(i, 0, before);
        throw e;
      }
    },
  };
}
