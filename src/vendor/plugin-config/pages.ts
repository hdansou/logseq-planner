import { propertyText } from "./json";
import { pageTitle } from "./names";
import { propertySchemaFor, type PropertyType } from "./schema";

/** The SDK calls the helpers need; the plugin passes thin wrappers over `logseq.Editor` / `logseq.DB`, tests pass fakes. */
export interface ConfigSdk {
  /** uuid of the live page with exactly this title (a strict query, not `getPage`), or null. */
  findPage(title: string): Promise<string | null>;
  createPage(title: string): Promise<void>;
  /** The DB host renames by page uuid; a title fails with "Invalid page uuid". Throws when refused. */
  renamePage(uuid: string, title: string): Promise<void>;
  getProperty(key: string): Promise<{ type?: string; hide?: boolean } | null>;
  upsertProperty(key: string, schema: unknown): Promise<void>;
  getBlockProperty(uuid: string, key: string): Promise<unknown>;
  upsertBlockProperty(uuid: string, key: string, value: unknown): Promise<void>;
  removeBlockProperty(uuid: string, key: string): Promise<void>;
}

/** The host's checkbox that hides a page (and its blocks) from All pages and search. */
export const HIDE_PAGE_KEY = ":logseq.property/hide?";

export async function ensureHiddenProperty(sdk: ConfigSdk, key: string, type: PropertyType): Promise<void> {
  const schema = propertySchemaFor(await sdk.getProperty(key).catch(() => null), type);
  if (schema) await sdk.upsertProperty(key, schema);
}

/** The page under `title`; a page still under one of `oldTitles` is renamed first (the host keeps its blocks), else used as it is. */
export async function findOrRenamePage(sdk: Pick<ConfigSdk, "findPage" | "renamePage">, title: string, oldTitles: string[]): Promise<string | null> {
  const page = await sdk.findPage(title);
  if (page) return page;
  for (const old of oldTitles) {
    const uuid = await sdk.findPage(old);
    if (!uuid) continue;
    try {
      await sdk.renamePage(uuid, title);
    } catch {
      return uuid;
    }
    return (await sdk.findPage(title)) ?? uuid;
  }
  return null;
}

/**
 * Machine state that follows the graph, on the plugin's hidden `Plugin state: <plugin>` page. `legacyPages` are titles an
 * earlier version kept it on: a read falls back to them, a write removes it there once the new copy reads back.
 */
export function createStateStore(sdk: ConfigSdk, opts: { plugin: string; key: string; legacyPages?: string[] }) {
  const title = pageTitle("state", opts.plugin);
  const legacy = opts.legacyPages ?? [];
  const readFrom = async (t: string) => {
    const page = await sdk.findPage(t);
    return page ? propertyText(await sdk.getBlockProperty(page, opts.key)) : null;
  };
  return {
    read: async (): Promise<string | null> => {
      for (const t of [title, ...legacy]) {
        const v = await readFrom(t);
        if (v !== null) return v;
      }
      return null;
    },
    write: async (text: string): Promise<void> => {
      let page = await sdk.findPage(title);
      if (!page) {
        await sdk.createPage(title);
        page = await sdk.findPage(title);
      }
      if (!page) throw new Error(`Page "${title}" could not be created (is it in Recycle?)`);
      await ensureHiddenProperty(sdk, opts.key, "string");
      await sdk.upsertBlockProperty(page, HIDE_PAGE_KEY, true);
      await sdk.upsertBlockProperty(page, opts.key, text);
      if (propertyText(await sdk.getBlockProperty(page, opts.key)) !== text) throw new Error("The state was not stored (read back differs)");
      for (const t of legacy) {
        const old = await sdk.findPage(t);
        if (old && propertyText(await sdk.getBlockProperty(old, opts.key)) !== null) await sdk.removeBlockProperty(old, opts.key);
      }
    },
  };
}
