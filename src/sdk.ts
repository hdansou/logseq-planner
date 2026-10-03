// No SDK import: the `logseq` global comes from index.ts; importing the SDK here breaks unit tests (gotcha §11).
// Every SDK call and typing cast lives here.
import type { Dq } from "./core/schema";
import { weekStartFromHost } from "./core/layout-common";
import { CONFIG_KEY, configSchemaFor } from "./storage";
import type { AppDeps, KanbanWriteDeps, StorageDeps, ViewBlock } from "./types";

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
  kanban: kanbanWriteDeps(),
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT_RE = /^:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * The node's value of a choice property, pulled the way T01's read-backs were (scripts/probe.mjs `readOwner`): by
 * uuid, the uuid passed as an EDN `#uuid` input. The ident goes into the pull pattern, so it must be a full keyword.
 */
export function choiceReadQuery(ident: string): string {
  if (!IDENT_RE.test(ident)) throw new Error(`Not a full property ident: ${ident}`);
  return `[:find (pull ?b [:block/uuid {${ident} [:db/id :db/ident]}]) :in $ ?u :where [?b :block/uuid ?u]]`;
}

/**
 * The real SDK behind a Kanban move. Arguments go through unchanged: `writeMove` (src/core/kanban.ts) passes the key
 * and value in the forms T01 saw work live (full ident without the colon, closed value entity id). Both write calls
 * resolve null whether they worked or not; `readChoice` is the check. UNVERIFIED LIVE as a whole until T11's live pass.
 */
export const kanbanWriteDeps = (): KanbanWriteDeps => ({
  upsertBlockProperty: (uuid, key, valueId) => logseq.Editor.upsertBlockProperty(uuid, key, valueId),
  removeBlockProperty: (uuid, key) => logseq.Editor.removeBlockProperty(uuid, key),
  readChoice: async (uuid, ident) => {
    if (!UUID_RE.test(uuid)) throw new Error(`Not a block uuid: ${uuid}`);
    const rows = (await datascriptQuery(choiceReadQuery(ident), `#uuid "${uuid}"`)) as [Record<string, { id: number; ident?: string } | undefined>][];
    if (!rows.length) throw new Error(`Block ${uuid} not found when reading ${ident} back`);
    // Pull-map keys keep the full ident (with its colon); :db/id and :db/ident come back as `id` and `ident` (docs/probes.md).
    const v = rows[0][0]?.[ident];
    return v ? { id: v.id, ident: v.ident ?? null } : null;
  },
});
