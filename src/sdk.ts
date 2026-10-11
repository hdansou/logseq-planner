// No SDK import: the `logseq` global comes from index.ts; importing the SDK here breaks unit tests (gotcha §11).
// Every SDK call and typing cast lives here.
import { isPropertyIdent, type Dq } from "./core/schema";
import { weekStartFromHost } from "./core/layout-common";
import type { HostDocument } from "./ui/host-keys";
import { CONFIG_KEY, configSchemaFor, PAGE_TITLE, STATE_KEY, STATE_PAGE_TITLE } from "./storage";
import type { GraphStateDeps, UiStateDeps } from "./ui-state";
import type { AppDeps, ChangesSdk, DateWriteDeps, Frame, KanbanWriteDeps, StorageDeps, ViewBlock } from "./types";

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

/** N40: the docked width in px: its minimum, and the room the page keeps beside it (the page next to a docked Planner). */
export const DOCK_MIN_PX = 320;
export const DOCK_PAGE_MIN_PX = 360;
/** Planner starts at this share of the window; the owner widens or narrows it with the handle (kept per device). */
const DOCK_SHARE = 0.4;
export const DOCK_STYLE_KEY = "planner-dock";

export const defaultDockWidth = (viewport: number): number => Math.round(viewport * DOCK_SHARE);

/** A width kept between the minimum and the window less the page's room; when the window is too small for both, the minimum. */
export const clampDockWidth = (px: number, viewport: number): number =>
  Math.max(DOCK_MIN_PX, Math.min(Math.round(px), viewport - DOCK_PAGE_MIN_PX));

/**
 * The sidebar surface (N40): Planner on the window's right edge, under the host header like the workspace frame, `width`
 * px wide. It sits BESIDE Logseq's right sidebar, not over it: `dockHostStyle` reserves its strip in the host layout.
 */
export const dockFrame = (width: number, headbar: string, offset = 0): Frame =>
  ({ position: "fixed", zIndex: "999", top: headbar, height: `calc(100vh - ${headbar})`, right: offset ? `${offset}px` : "0", left: "auto", width: `${width}px` });

/**
 * Host CSS that makes room for the docked frame (the approach of the Outline Canvas plugin, "mirror" mode): the app's
 * wrapper gets `margin-right`, and Logseq's right sidebar, which lives inside it, opens to the left of Planner and
 * closes on its own button without moving Planner. Applies only while Planner's container is visible, so a hidden
 * Planner gives the room back. `animate` false while the width is being dragged, so the host follows the pointer 1:1.
 */
export function dockHostStyle(pluginId: string, width: number, animate: boolean, offset = 0, rank = 0): string {
  // N44: `offset` = the room another plugin's docked frame takes; the strip is both widths, and `:root` makes this
  // rule outrank the other plugin's own margin rule on the same wrapper (a tie goes to the later rule), one more for
  // every frame docked before this one, so the innermost plugin, whose strip is the widest, wins.
  return `${":root".repeat(rank + 1)} body:has(.lsp-iframe-sandbox-container.visible[data-pid="${pluginId}"]) #app-container-wrapper {\n`
    + `  margin-right: ${offset + width}px !important;\n  transition: ${animate ? "margin-right 0.2s ease" : "none"};\n}`;
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
  pluginId: () => logseq.baseInfo.id,
  dockWidth: {
    read: () => {
      const v = (logseq.settings as Record<string, unknown> | undefined)?.dockWidth;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    },
    write: (px) => void logseq.updateSettings({ dockWidth: px }),
  },
  hideMainUI: () => logseq.hideMainUI({ restoreEditingCursor: true }),
  // The page route takes a uuid for pages and blocks alike (Query Builder src/nav.ts, verified there live).
  openPage: (uuid) => void logseq.App.pushState("page", { name: uuid }),
  openInSidebar: (uuid) => logseq.Editor.openInRightSidebar(uuid),
  later: (fn, ms) => void setTimeout(fn, ms),
  weekStart: () => hostWeekStart(),
  dq: (query, ...inputs) => datascriptQuery(query, ...inputs),
  storage: storageDeps(),
  prefs: uiStateDeps(),
  graphState: graphStateDeps(),
  kanban: kanbanWriteDeps(),
  dates: dateWriteDeps(),
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
  onGraphChanged: (cb) => logseq.App.onCurrentGraphChanged(() => cb()),
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
/** The plugin-settings key holding the per-graph UI state (N21): `{ [graph url]: UiPrefs }`. */
export const UI_STATE_KEY = "uiState";

/**
 * N21: per-graph UI state lives in the plugin's settings (per device, never in the graph). `updateSettings` merges
 * deeply, so writing one graph's entry leaves the others; the graph key is its url (`logseq_db_<name>`), else its name.
 */
export const uiStateDeps = (): UiStateDeps => ({
  graph: async () => {
    const g = await logseq.App.getCurrentGraph();
    return g?.url ?? g?.name ?? null;
  },
  read: () => (logseq.settings as Record<string, unknown> | undefined)?.[UI_STATE_KEY],
  write: (graph, prefs) => logseq.updateSettings({ [UI_STATE_KEY]: { [graph]: prefs } }),
});

/** Makes sure `key` exists as a hidden string property (never changes an existing type); before every write of it. */
async function ensureHiddenString(key: string): Promise<void> {
  const existing = (await logseq.Editor.getProperty(key).catch(() => null)) as Record<string, unknown> | null;
  const schema = configSchemaFor(existing ? { type: existing.type as string | undefined, hide: existing["hide?"] === true || existing.hide === true } : null);
  // Host `upsert_property` takes these keys; the typings are narrower (Query Builder src/sdk.ts).
  if (schema) await logseq.Editor.upsertProperty(key, schema as never);
}

/**
 * N41 / N50: the UI state that follows the graph, a hidden string property on the plugin's own hidden page
 * (`STATE_PAGE_TITLE`, `:logseq.property/hide?`; docs/plugin-config.md), apart from the user's saved views. Before N50 it
 * lived on the "Planner views" page: a read falls back to that value, a write moves it. The page entity takes
 * `upsertBlockProperty` by uuid (probed live on the nightly 2026-10-09 and 2026-10-11). Written only after a change, read back every time.
 */
export const HIDE_KEY = ":logseq.property/hide?";
export const graphStateDeps = (): GraphStateDeps => {
  const find = async (title: string) => {
    const rows = (await datascriptQuery(pageQuery(title))) as unknown[][];
    return rows.length > 0 ? String(rows[0][0]) : null;
  };
  const readFrom = async (title: string) => {
    const page = await find(title);
    const raw = page ? await logseq.Editor.getBlockProperty(page, STATE_KEY) : null;
    return typeof raw === "string" ? raw : null;
  };
  return {
    read: async () => (await readFrom(STATE_PAGE_TITLE)) ?? (await readFrom(PAGE_TITLE)),
    write: async (text) => {
      let page = await find(STATE_PAGE_TITLE);
      if (!page) {
        await logseq.Editor.createPage(STATE_PAGE_TITLE, {}, { redirect: false, createFirstBlock: false });
        page = await find(STATE_PAGE_TITLE);
      }
      if (!page) throw new Error(`Page "${STATE_PAGE_TITLE}" could not be created (is it in Recycle?)`);
      await ensureHiddenString(STATE_KEY);
      await logseq.Editor.upsertBlockProperty(page, HIDE_KEY, true);
      await logseq.Editor.upsertBlockProperty(page, STATE_KEY, text);
      if ((await logseq.Editor.getBlockProperty(page, STATE_KEY) as unknown) !== text) throw new Error("UI state was not stored (read back differs)");
      const old = await find(PAGE_TITLE);
      if (old && typeof (await logseq.Editor.getBlockProperty(old, STATE_KEY)) === "string") await logseq.Editor.removeBlockProperty(old, STATE_KEY);
    },
  };
};

export const storageDeps = (): StorageDeps => ({
  // Strict lookup (gotcha §4): title match plus Page class membership, never getPage; recycled pages are excluded.
  findPage: async (title) => {
    const rows = (await datascriptQuery(pageQuery(title))) as unknown[][];
    return rows.length > 0 ? String(rows[0][0]) : null;
  },
  createPage: async (title) => void (await logseq.Editor.createPage(title, {}, { redirect: false, createFirstBlock: false })),
  ensureConfigProperty: () => ensureHiddenString(CONFIG_KEY),
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

/**
 * The node's value of a Date or DateTime property, pulled by uuid with a `#uuid` input as `readChoice` does: a Date
 * (a journal page ref) with the page's id and journal day, the way the node query pulls it; a DateTime as is (epoch ms).
 */
export function dateReadQuery(ident: string, type: "date" | "datetime"): string {
  if (!isPropertyIdent(ident)) throw new Error(`Not a full property ident: ${ident}`);
  const attr = type === "date" ? `{${ident} [:db/id :block/journal-day]}` : ident;
  return `[:find (pull ?b [:block/uuid ${attr}]) :in $ ?u :where [?b :block/uuid ?u]]`;
}

/** The journal day (`20261005`) of `createJournalPage`'s argument (`YYYY-MM-DD…`, `journalArg` in core/date-edit.ts). */
export function journalDayOfArg(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) throw new Error(`Not a journal date: ${date}`);
  return Number(m[1] + m[2] + m[3]);
}

/** The journal page(s) of one journal day, by db id. */
export function journalPageQuery(journalDay: number): string {
  if (!Number.isInteger(journalDay) || journalDay < 10000101 || journalDay > 99991231) throw new Error(`Not a journal day: ${journalDay}`);
  return `[:find ?p :where [?p :block/journal-day ${journalDay}]]`;
}

/** After asking the host to create a journal page: how often, and how far apart, the page is looked for. */
const JOURNAL_PAGE_TRIES = 10;
const JOURNAL_PAGE_WAIT_MS = 100;

/**
 * The real SDK behind a Timeline date edit (N06c). Write probe on the desktop app (2026-10-04, tasks.md N06c): a
 * DateTime takes epoch ms; a Date takes the db id of the day's journal page, which `createJournalPage` returns (existing
 * or created) when given local noon. The arguments go through unchanged (`writeDates` builds them); `readDate` is the check.
 */
export const dateWriteDeps = (): DateWriteDeps => ({
  upsertBlockProperty: (uuid, key, value) => logseq.Editor.upsertBlockProperty(uuid, key, value),
  // N19: the day's journal page is looked up by its journal day, never taken from `createJournalPage`'s return value. On
  // the stable desktop app (b09316a) that call returned null for local noon, for a page that exists and for one it had
  // just created, while the nightly (8ffbb22) returned the page. The call is only made to create a missing page.
  createJournalPage: async (date) => {
    const day = journalDayOfArg(date);
    const find = async () => {
      const rows = (await datascriptQuery(journalPageQuery(day))) as [number][];
      return rows.length ? { id: Math.min(...rows.map(([id]) => id)) } : null;
    };
    const existing = await find();
    if (existing) return existing;
    await logseq.Editor.createJournalPage(date);
    for (let i = 0; i < JOURNAL_PAGE_TRIES; i++) {
      const created = await find();
      if (created) return created;
      await new Promise((r) => setTimeout(r, JOURNAL_PAGE_WAIT_MS));
    }
    return null;
  },
  readDate: async (uuid, ident, type) => {
    if (!UUID_RE.test(uuid)) throw new Error(`Not a block uuid: ${uuid}`);
    const rows = (await datascriptQuery(dateReadQuery(ident, type), `#uuid "${uuid}"`)) as [Record<string, unknown> | null][];
    if (!rows.length) throw new Error(`Block ${uuid} not found when reading ${ident} back`);
    const v = rows[0][0]?.[ident];
    if (v === undefined || v === null) return null;
    if (type === "datetime") return v as number;
    const ref = v as { id: number; "journal-day"?: number };
    return { id: ref.id, journalDay: ref["journal-day"] ?? NaN }; // no journal day: not a journal page (never equal)
  },
});
