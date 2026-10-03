// No SDK import: the `logseq` global comes from index.ts; importing the SDK here breaks unit tests (gotcha §11).
// Every SDK call and typing cast lives here.
import type { Dq } from "./core/schema";
import { weekStartFromHost } from "./core/layout-common";
import { CONFIG_KEY, configSchemaFor } from "./storage";
import type { AppDeps, StorageDeps, ViewBlock } from "./types";

/** Full-screen recipe (skill ui-positioning, recipe 3): the frame covers the whole window above the host UI. */
const FULL_SCREEN: Record<string, string> = {
  position: "fixed", zIndex: "999", top: "0", left: "0", right: "auto", width: "100vw", height: "100vh",
};

/**
 * Styles the main-UI container directly (gotcha §15: a persisted layout makes the host drop position/size keys from
 * `setMainUIInlineStyle`). The container is only reachable when the frame is same-origin with the host; a cross-origin
 * frame (dev server, web app) falls back to `setMainUIInlineStyle`, which applies them while no layout is persisted.
 * Planner never sets `draggable`, so the host never persists one.
 */
function setContainerStyle(style: Record<string, string>): void {
  let el: HTMLElement | null = null;
  try {
    el = parent.document.querySelector<HTMLElement>(`.lsp-iframe-sandbox-container[data-pid="${logseq.baseInfo.id}"]`);
  } catch {
    // cross-origin: parent.document is not readable
  }
  if (!el) return logseq.setMainUIInlineStyle(style as never);
  delete el.dataset.inited_layout;
  for (const [k, v] of Object.entries(style)) el.style.setProperty(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v, "important");
}

/** The real SDK behind `registerApp`. */
export const appDeps = (): AppDeps => ({
  registerUIItem: (type, item) => logseq.App.registerUIItem(type, item),
  registerCommandPalette: (command, action) => logseq.App.registerCommandPalette(command, action),
  provideModel: (model) => logseq.provideModel(model),
  showMainUI: () => {
    setContainerStyle(FULL_SCREEN);
    logseq.showMainUI({ autoFocus: true });
  },
  hideMainUI: () => logseq.hideMainUI({ restoreEditingCursor: true }),
  // The page route takes a uuid for pages and blocks alike (Query Builder src/nav.ts, verified there live).
  openPage: (uuid) => void logseq.App.pushState("page", { name: uuid }),
  openInSidebar: (uuid) => logseq.Editor.openInRightSidebar(uuid),
  later: (fn, ms) => void setTimeout(fn, ms),
  weekStart: () => hostWeekStart(),
  macWindowButtons: /Mac/.test(navigator.platform) && /Electron/.test(navigator.userAgent),
  dq: (query, ...inputs) => datascriptQuery(query, ...inputs),
  storage: storageDeps(),
  theme: {
    later: (fn, ms) => void setTimeout(fn, ms),
    getUserConfigs: () => logseq.App.getUserConfigs(),
    resolveThemeCssPropsVals: (names) => logseq.UI.resolveThemeCssPropsVals(names),
    onThemeModeChanged: (cb) => void logseq.App.onThemeModeChanged(cb),
    onThemeChanged: (cb) => void logseq.App.onThemeChanged(cb),
  },
  defer: (fn) => void setTimeout(fn, 0),
});

/**
 * The host's first day of the week as 0 = Sunday … 6 = Saturday. `preferredStartOfWeek` is typed as a string in the SDK
 * but arrives as a number (0–6 = Monday–Sunday, default 6; seen live 2026-10-03); `weekStartFromHost` takes either and
 * throws on anything else.
 */
export const hostWeekStart = async (): Promise<number> =>
  weekStartFromHost(((await logseq.App.getUserConfigs()) as { preferredStartOfWeek?: unknown }).preferredStartOfWeek);

/** `logseq.DB.datascriptQuery` as the injectable `Dq` the core takes (string inputs are EDN-read; see CLAUDE.md). */
export const datascriptQuery: Dq = (query, ...inputs) => logseq.DB.datascriptQuery(query, ...inputs);

/** Escapes a string for use inside a datascript string literal. */
const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Live page with exactly this title; a page in the recycle bin keeps its title and tag but has `deleted-at`. */
export const pageQuery = (title: string) =>
  `[:find ?u :where [?p :block/title ${quote(title)}] [?p :block/tags ?t] [?t :db/ident :logseq.class/Page] (not [?p :logseq.property/deleted-at _]) [?p :block/uuid ?u]]`;

const toViewBlock = async (b: { uuid: string; content?: string; title?: string }): Promise<ViewBlock> => {
  const raw = await logseq.Editor.getBlockProperty(b.uuid, CONFIG_KEY);
  return { uuid: b.uuid, name: b.content ?? b.title ?? "", config: typeof raw === "string" ? raw : null };
};

/**
 * The real SDK behind `createViewStore`. UNVERIFIED LIVE: the shapes below follow Query Builder's proven
 * state property code and the SDK typings; the write calls resolve null on failure, which the store catches by reading back.
 */
export const storageDeps = (): StorageDeps => ({
  // Strict lookup (gotcha §4): title match plus Page class membership, never getPage; recycled pages are excluded.
  findPage: async (title) => {
    const rows = (await datascriptQuery(pageQuery(title))) as unknown[][];
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
