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

/** A saved-view block whose config cannot be read: listed with the reason so it can be deleted, never opened. */
export interface InvalidView {
  id: string;
  name: string;
  /** Why the config cannot be used (`parseViewConfig`'s message). */
  invalid: string;
}

/** What `list` returns: the readable views and, in page order among them, the unreadable ones. */
export type ListedView = SavedView | InvalidView;

/**
 * Schema to apply before every config write: create the property hidden when missing, only hide it when it
 * exists (never change an existing type), nothing when already hidden (gotcha §30; same rule as Query Builder).
 */
export function configSchemaFor(existing: { type?: string; hide?: boolean } | null): { type?: "string"; hide: true } | null {
  if (!existing) return { type: "string", hide: true };
  return existing.hide ? null : { hide: true };
}

/**
 * The name a saved view is written with and shown as. Rule: the characters `#`, `[`, `]`, `{` and `}` are dropped, runs
 * of `(` or `)` become one, and spaces are collapsed and trimmed. The host turns `#word` and `[[…]]` in a block's text
 * into tags and refs (seen live, T14 F3: "#Project kanban" tagged the view block #Project), `{{…}}` into a macro and
 * `((…))` into a block ref; without these characters none of that can happen.
 */
export const sanitizeViewName = (name: string): string =>
  name.replace(/[#[\]{}]/g, "").replace(/\(+/g, "(").replace(/\)+/g, ")").replace(/\s+/g, " ").trim();

const mismatch = (what: string, id: string) => new Error(`Saved view ${what} was not stored (read back differs) for block ${id}`);

/** The saved-views store the workspace uses. */
export type ViewStore = ReturnType<typeof createViewStore>;

export function createViewStore(deps: StorageDeps) {
  let cache: ListedView[] | null = null;
  let pageUuid: string | null = null;
  let pending = 0;

  /** One block → a view, or an invalid entry carrying the parse error: one bad block must not hide the others (T14). */
  const toView = (b: ViewBlock): ListedView => {
    try {
      return { id: b.uuid, name: b.name, config: parseViewConfig(b.config!) };
    } catch (e) {
      return { id: b.uuid, name: b.name, invalid: (e as Error).message };
    }
  };

  async function load(): Promise<ListedView[]> {
    if (cache) return cache;
    pageUuid = await deps.findPage(PAGE_TITLE);
    const blocks = pageUuid ? await deps.listBlocks(pageUuid) : [];
    cache = blocks.filter((b) => b.config !== null).map(toView);
    return cache;
  }

  const recycled = () => new Error(`Page "${PAGE_TITLE}" could not be created. If it is in Recycle (More menu → Recycle), restore it or delete it there, then save again.`);

  /**
   * The live views page, looked up right before every write and never taken from memory: the host appends into a
   * page that went to Recycle by its uuid without complaint (seen live, T07 D5). When the page is gone or replaced,
   * the cache is dropped (the next `list` re-reads the graph, which ignores a recycled page). With `create`, a
   * missing page is created; the host's createPage returns a same-titled recycled page and creates nothing, so a
   * page still missing afterwards means Recycle.
   */
  async function livePage(create: boolean): Promise<string> {
    let page = await deps.findPage(PAGE_TITLE);
    if (!page && create) {
      await deps.createPage(PAGE_TITLE);
      page = await deps.findPage(PAGE_TITLE);
    }
    if (page !== pageUuid && pageUuid !== null) cache = null;
    pageUuid = page;
    if (!page) {
      cache = null;
      throw recycled();
    }
    return page;
  }

  /** Writes `text` into the config property and checks the stored text is identical. */
  async function writeConfig(id: string, text: string) {
    await deps.ensureConfigProperty();
    await deps.setConfig(id, text);
    const stored = await deps.readBlock(id);
    if (stored?.config !== text) throw mismatch("config", id);
    return stored;
  }

  /** Removes a block `create` appended after `failure`; the error to throw (naming a failed removal as well). */
  async function removeAfter(id: string, failure: Error): Promise<Error> {
    try {
      await deps.removeBlock(id);
      if (await deps.readBlock(id)) throw new Error(`block ${id} still exists`);
      return failure;
    } catch (e) {
      return new Error(`${failure.message} The new block could not be removed: ${(e as Error).message}`);
    }
  }

  const find = (views: ListedView[], id: string) => {
    const i = views.findIndex((v) => v.id === id);
    if (i < 0) throw new Error(`Unknown saved view ${id}`);
    return i;
  };

  return {
    /** All saved views, in page order, unreadable ones as `InvalidView`. Reads the graph once, then serves the cache. */
    list: async (): Promise<ListedView[]> => [...(await load())],
    /** The cache as it is now (empty before the first `list`/write). */
    cached: (): ListedView[] => [...(cache ?? [])],

    /**
     * Saves a new view under `sanitizeViewName(name)`. After the block is appended, any failure (the config write, its
     * read-back, a block the host tagged or whose title differs) removes that block again, so no orphan is left; when
     * the removal fails too, the error says so.
     */
    async create(name: string, config: ViewConfig): Promise<SavedView> {
      const title = sanitizeViewName(name);
      if (!title) throw new Error("A saved view needs a name");
      const views = await load();
      const entry: SavedView = { id: `pending-${++pending}`, name: title, config };
      views.push(entry); // cache first
      try {
        const page = await livePage(true);
        const id = await deps.appendBlock(page, title);
        if (!id) throw new Error("appendBlock returned no block");
        try {
          const stored = await writeConfig(id, serializeViewConfig(config));
          if (stored.name !== title || (await deps.blockTags(id)) > 0) {
            throw new Error(`Saved view "${title}" was stored with tags or a changed title, so it was removed. Use a name without #, [[ ]], {{ }} or (( )).`);
          }
        } catch (e) {
          throw await removeAfter(id, e as Error);
        }
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
      const next: SavedView = { id, name: before.name, config };
      views[i] = next; // cache first
      try {
        await livePage(false);
        await writeConfig(id, serializeViewConfig(config));
        return next;
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
        await livePage(false);
        await deps.removeBlock(id);
        if (await deps.readBlock(id)) throw new Error(`Saved view block ${id} still exists after removal (read back)`);
      } catch (e) {
        views.splice(i, 0, before);
        throw e;
      }
    },
  };
}
