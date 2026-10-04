// No SDK import: the `logseq` global comes from index.ts; importing the SDK here breaks unit tests (gotcha §11).
// Every SDK call and typing cast lives here.
import { isPropertyIdent, type Dq } from "./core/schema";
import { weekStartFromHost } from "./core/layout-common";
import type { HostDocument } from "./ui/host-keys";
import { CONFIG_KEY, configSchemaFor } from "./storage";
import type { AppDeps, ChangesSdk, Frame, KanbanWriteDeps, StorageDeps, ViewBlock } from "./types";

/**
 * The workspace frame (skill ui-positioning, recipe 3, minus the header): fixed over the host UI, but starting at the
 * host header's lower edge. The host header (`#head`, `--ls-headbar-height`, 3rem = 48 px) is the window's drag strip
 * on the desktop app: a frame over it either blocks clicks on Planner's top bar or, with `-webkit-app-region:
 * no-drag`, blocks moving the window (tasks.md N15). Below it, the header stays draggable and double-clickable, and
 * the window edges stay free for resizing.
 */
export const HEADBAR = "var(--ls-headbar-height, 3rem)";
export const WORKSPACE_FRAME: Frame = {
  position: "fixed", zIndex: "999", top: HEADBAR, left: "0", right: "auto", width: "100vw", height: `calc(100vh - ${HEADBAR})`,
};

/** The horizontal extent of a host element (`getBoundingClientRect()`, viewport px). */
export interface HostRect {
  left: number;
  right: number;
  width: number;
}

/** The gap left free right of the sidebar's resizer, so the host's width handle stays grabbable (prototype, N06a). */
const RESIZER_GAP = 2;

/**
 * The sidebar frame (N06a): Planner over Logseq's open right sidebar (`#right-sidebar`), from the resizer's right edge
 * + 2 px to the sidebar's right edge, under the host header like the workspace frame (`headbar` = its height as a CSS
 * length). Null when nothing of the sidebar is left beside its resizer (closed, zero width).
 */
export function sidebarFrame(sidebar: HostRect, resizer: HostRect, headbar: string): Frame | null {
  if (sidebar.width <= 0) return null;
  const left = resizer.right + RESIZER_GAP;
  const width = sidebar.right - left;
  if (width <= 0) return null;
  return { position: "fixed", zIndex: "999", top: headbar, height: `calc(100vh - ${headbar})`, left: `${left}px`, width: `${width}px`, right: "auto" };
}

/**
 * Styles the main-UI container directly (gotcha §15: a persisted layout makes the host drop position/size keys from
 * `setMainUIInlineStyle`). The container is only reachable when the frame is same-origin with the host; a cross-origin
 * frame (dev server, web app) falls back to `setMainUIInlineStyle`, which applies them while no layout is persisted.
 * Planner never sets `draggable`, so the host never persists one.
 */
function setContainerStyle(style: Frame): void {
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

/** The host document, or null when the frame is cross-origin (reading `parent.document` throws). */
export function hostDocument(): HostDocument | null {
  try {
    return parent.document.defaultView ? parent.document : null;
  } catch {
    return null;
  }
}

/** The real SDK behind `registerApp`. */
export const appDeps = (): AppDeps => ({
  registerUIItem: (type, item) => logseq.App.registerUIItem(type, item),
  registerCommandPalette: (command, action) => logseq.App.registerCommandPalette(command, action),
  provideModel: (model) => logseq.provideModel(model),
  // N06b, probed live on the desktop app (tasks.md): the event carries `slot` and `payload.arguments`; `provideUI` into
  // that slot renders in the page; `data-on-click` calls the model with the element's dataset.
  onMacroRendererSlotted: (cb) => logseq.App.onMacroRendererSlotted(cb as never),
  provideUI: (ui) => void logseq.provideUI(ui),
  // The typings say StyleString; the host takes `{ key, style }` too and keeps one <style> per key (LSPlugin.core.ts).
  provideStyle: (style) => void logseq.provideStyle(style as never),
  registerSlashCommand: (label, action) => void logseq.Editor.registerSlashCommand(label, async () => action()),
  insertAtCursor: (text) => logseq.Editor.insertAtEditingCursor(text),
  setFrame: (style) => setContainerStyle(style),
  showMainUI: () => logseq.showMainUI({ autoFocus: true }),
  setRightSidebarVisible: (visible) => logseq.App.setRightSidebarVisible(visible),
  hideMainUI: () => logseq.hideMainUI({ restoreEditingCursor: true }),
  // The page route takes a uuid for pages and blocks alike (Query Builder src/nav.ts, verified there live).
  openPage: (uuid) => void logseq.App.pushState("page", { name: uuid }),
  openInSidebar: (uuid) => logseq.Editor.openInRightSidebar(uuid),
  later: (fn, ms) => void setTimeout(fn, ms),
  weekStart: () => hostWeekStart(),
  dq: (query, ...inputs) => datascriptQuery(query, ...inputs),
  storage: storageDeps(),
  kanban: kanbanWriteDeps(),
  changes: changesSdk(),
  theme: {
    later: (fn, ms) => void setTimeout(fn, ms),
    getUserConfigs: () => logseq.App.getUserConfigs(),
    resolveThemeCssPropsVals: (names) => logseq.UI.resolveThemeCssPropsVals(names),
    onThemeModeChanged: (cb) => logseq.App.onThemeModeChanged(cb),
    onThemeChanged: (cb) => logseq.App.onThemeChanged(cb),
  },
  defer: (fn) => void setTimeout(fn, 0),
  hostDocument,
});

/**
 * The real SDK behind live updates. `DB.onChanged` returns its unsubscribe (typed `IUserOffHook`); its payload is ignored
 * on purpose (docs/probes.md). `ui:visible:changed` carries `{ visible }` (LSPluginUserEvents).
 */
export const changesSdk = (): ChangesSdk => ({
  subscribe: (cb) => logseq.DB.onChanged(() => cb()),
  later: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
  // `logseq` is an EventEmitter (eventemitter3): `off` with the same handler unsubscribes.
  onVisibleChanged: (cb) => {
    const handler = (e: { visible: boolean }) => cb(e.visible);
    logseq.on("ui:visible:changed", handler);
    return () => void logseq.off("ui:visible:changed", handler);
  },
  onUnload: (cb) => logseq.beforeunload(async () => cb()),
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tags of one block, pulled by uuid (`#uuid` input). */
export const BLOCK_TAGS_QUERY = `[:find (pull ?b [:block/uuid {:block/tags [:db/id]}]) :in $ ?u :where [?b :block/uuid ?u]]`;

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
 * The real SDK behind `createViewStore`. Verified live in T06 (create, update, list from a fresh store, remove, reload
 * round trip on `plugin-test`) and T07 (recycled page). `blockTags` (T14) is not verified live yet. The write calls
 * resolve null on failure, which the store catches by reading back.
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
  // Pull by `#uuid` input, as `readChoice` (verified live in T11); `:block/tags` comes back as `tags: [{id}]`.
  blockTags: async (uuid) => {
    if (!UUID_RE.test(uuid)) throw new Error(`Not a block uuid: ${uuid}`);
    const rows = (await datascriptQuery(BLOCK_TAGS_QUERY, `#uuid "${uuid}"`)) as [{ tags?: unknown[] } | null][];
    if (!rows.length) throw new Error(`Block ${uuid} not found when reading its tags back`);
    return rows[0][0]?.tags?.length ?? 0;
  },
  removeBlock: async (uuid) => void (await logseq.Editor.removeBlock(uuid)),
});


/**
 * The node's value of a choice property, pulled the way T01's read-backs were (scripts/probe.mjs `readOwner`): by
 * uuid, the uuid passed as an EDN `#uuid` input. The ident goes into the pull pattern, so it must be a full keyword.
 */
export function choiceReadQuery(ident: string): string {
  if (!isPropertyIdent(ident)) throw new Error(`Not a full property ident: ${ident}`);
  return `[:find (pull ?b [:block/uuid {${ident} [:db/id :db/ident]}]) :in $ ?u :where [?b :block/uuid ?u]]`;
}

/**
 * The real SDK behind a Kanban move. Arguments go through unchanged: `writeMove` (src/core/kanban.ts) passes the key
 * and value in the forms T01 saw work live (full ident without the colon, closed value entity id). Both write calls
 * resolve null whether they worked or not; `readChoice` is the check. Verified live in T11 (every move read back from
 * the graph, host calls logged).
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
