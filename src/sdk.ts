// No SDK import: the `logseq` global comes from index.ts; importing the SDK here breaks unit tests (gotcha §11).
// Every SDK call and typing cast lives here. No casts are needed yet.
import type { Dq } from "./core/schema";
import { CONFIG_KEY, configSchemaFor } from "./storage";
import type { AppDeps, StorageDeps, ViewBlock } from "./types";

/** The real SDK behind `registerApp`. */
export const appDeps = (): AppDeps => ({
  registerUIItem: (type, item) => logseq.App.registerUIItem(type, item),
  registerCommandPalette: (command, action) => logseq.App.registerCommandPalette(command, action),
  provideModel: (model) => logseq.provideModel(model),
  showMainUI: () => logseq.showMainUI(),
  hideMainUI: () => logseq.hideMainUI(),
  theme: {
    later: (fn, ms) => void setTimeout(fn, ms),
    getUserConfigs: () => logseq.App.getUserConfigs(),
    resolveThemeCssPropsVals: (names) => logseq.UI.resolveThemeCssPropsVals(names),
    onThemeModeChanged: (cb) => void logseq.App.onThemeModeChanged(cb),
    onThemeChanged: (cb) => void logseq.App.onThemeChanged(cb),
  },
  defer: (fn) => void setTimeout(fn, 0),
});

/** `logseq.DB.datascriptQuery` as the injectable `Dq` the core takes (string inputs are EDN-read; see CLAUDE.md). */
export const datascriptQuery: Dq = (query, ...inputs) => logseq.DB.datascriptQuery(query, ...inputs);

/** Escapes a string for use inside a datascript string literal. */
const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const toViewBlock = async (b: { uuid: string; content?: string; title?: string }): Promise<ViewBlock> => {
  const raw = await logseq.Editor.getBlockProperty(b.uuid, CONFIG_KEY);
  return { uuid: b.uuid, name: b.content ?? b.title ?? "", config: typeof raw === "string" ? raw : null };
};

/**
 * The real SDK behind `createViewStore`. UNVERIFIED LIVE: the shapes below follow Query Builder's proven
 * state property code and the SDK typings; the write calls resolve null on failure, which the store catches by reading back.
 */
export const storageDeps = (): StorageDeps => ({
  // Strict lookup (gotcha §4): title match plus Page class membership, never getPage.
  findPage: async (title) => {
    const rows = (await datascriptQuery(
      `[:find ?u :where [?p :block/title ${quote(title)}] [?p :block/tags ?t] [?t :db/ident :logseq.class/Page] [?p :block/uuid ?u]]`,
    )) as unknown[][];
    return rows.length > 0 ? String(rows[0][0]) : null;
  },
  createPage: async (title) => void (await logseq.Editor.createPage(title, {}, { redirect: false, createFirstBlock: false })),
  ensureConfigProperty: async () => {
    const existing = (await logseq.Editor.getProperty(CONFIG_KEY).catch(() => null)) as Record<string, unknown> | null;
    const schema = configSchemaFor(existing ? { type: existing.type as string | undefined, hide: existing["hide?"] === true || existing.hide === true } : null);
    // Host `upsert_property` takes these keys; the typings are narrower (Query Builder src/sdk.ts).
    if (schema) await logseq.Editor.upsertProperty(CONFIG_KEY, schema as never);
  },
  listBlocks: async (pageUuid) => {
    const tree = (await logseq.Editor.getPageBlocksTree(pageUuid)) ?? [];
    return Promise.all(tree.map((b) => toViewBlock(b as never)));
  },
  readBlock: async (uuid) => {
    const b = await logseq.Editor.getBlock(uuid);
    return b ? toViewBlock(b as never) : null;
  },
  appendBlock: async (pageUuid, name) => (await logseq.Editor.appendBlockInPage(pageUuid, name))?.uuid ?? null,
  setConfig: async (uuid, text) => void (await logseq.Editor.upsertBlockProperty(uuid, CONFIG_KEY, text)),
  removeBlock: async (uuid) => void (await logseq.Editor.removeBlock(uuid)),
});
