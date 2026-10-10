import { clampDockWidth, defaultDockWidth, DOCK_STYLE_KEY, dockFrame, dockHostStyle, HEADBAR, WORKSPACE_FRAME } from "./sdk";
import { createViewStore } from "./storage";
import { createUiStore } from "./ui-state";
import { createBlocks, MACRO_TEXT, OPEN_NODE, OPEN_VIEW } from "./ui/block";
import { blockStyle } from "./ui/block-style";
import { createChanges, shareFeed } from "./ui/changes";
import { installDockResize } from "./ui/dock-resize";
import { installHostKeys } from "./ui/host-keys";
import type { AppDeps, ModelEvent, Surface } from "./types";
import { watchTheme } from "./ui/theme";
import { createWorkspace, type Timing } from "./ui/workspace";

const OPEN = "planner-open";
const OPEN_HANDLER = "openPlanner";
/** Planner's glyph: three staggered bars (a small Gantt), the same shape as icon.svg; the calendar icons are taken by other plugins. */
const TOOLBAR_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h8M9 12h11M6 18h7"/></svg>';
/**
 * Free in the host keymap (src/main/frontend/modules/shortcut/config.cljs on upstream master 2026-10-03 and on
 * d2ab7726ab; gotcha §33): the "g …" chords are navigation (g a/f/g/h/j/n/p/s/t, g shift+g) and nothing binds
 * "g shift+p"; mod+shift+p (command palette) is a different chord. Non-editing, so typing never triggers it.
 */
export const OPEN_KEYBINDING = { binding: "g shift+p", mode: "non-editing" } as const;
/** The host focuses the frame asynchronously after showing it (gotcha §32): pull focus in while it settles. */
const FOCUS_RETRIES_MS = [50, 300, 800];

/**
 * Click opens a node in the main area and hides Planner; Shift+click opens it in the right sidebar and keeps Planner
 * open (REQUIREMENTS: Click).
 */
export const nodeOpener = (deps: AppDeps) => (uuid: string, opts: { sidebar: boolean }): void => {
  if (opts.sidebar) return deps.openInSidebar(uuid);
  deps.openPage(uuid);
  deps.hideMainUI();
};

/** The in-page block's slash command (N06b). */
export const SLASH_COMMAND = "Planner view";

/** A `data-*` value the clicked element must carry (camelCased dataset key); throws without it. */
function datasetValue(e: ModelEvent, key: string, what: string): string {
  const v = e.dataset?.[key];
  if (!v) throw new Error(`Planner: the clicked element carries no ${what} (data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`);
  return v;
}

/**
 * Renders the workspace into `root`, wires Escape (an open popover first, then Planner) and Close, and
 * defers the toolbar button and command palette entry that open it. `timing` is the dev-only recorder (src/dev-timings.ts).
 */
export function registerApp(deps: AppDeps, root: HTMLElement, timing?: Timing): void {
  const doc = root.ownerDocument;
  let changes: ReturnType<typeof createChanges> | null = null; // created with the deferred registrations
  let visible = false; // the frame is shown: set by open / close and by the host's visibility event
  const host = deps.hostDocument(); // null when cross-origin: no host keys, no sidebar surface
  /** Where Planner shows (N06a); the workspace restores the graph's last one through `setSurface` on its first load (N21). */
  let surface: Surface = "workspace";
  /**
   * The sidebar surface (N40): the frame on the window's right edge and its strip reserved in the host layout, so Logseq's
   * own right sidebar opens beside it and neither moves the other. `docked`: the strip is reserved now; `shownPx`: the
   * width applied now; `keptPx`: the width this session settled on (else the settings', else 40% of the window).
   */
  let docked = false;
  let shownPx = 0;
  let keptPx: number | null = null;
  const viewport = () => host?.defaultView?.innerWidth ?? 0;
  const dockWidth = () => clampDockWidth(keptPx ?? deps.dockWidth.read() ?? defaultDockWidth(viewport()), viewport());
  const applyDock = (px: number, animate: boolean) => {
    shownPx = px;
    deps.setFrame(dockFrame(px, HEADBAR));
    deps.provideStyle({ key: DOCK_STYLE_KEY, style: dockHostStyle(deps.pluginId(), px, animate) });
  };
  const onHostResize = () => applyDock(dockWidth(), false); // a smaller window pulls a too wide Planner in
  const dock = () => {
    if (!docked) host!.defaultView?.addEventListener("resize", onHostResize);
    docked = true;
    applyDock(dockWidth(), true);
  };
  /** Gives the reserved strip back (the host layout returns to normal); the mode is kept by the caller. */
  const stopDock = () => {
    if (!docked) return;
    docked = false;
    host!.defaultView?.removeEventListener("resize", onHostResize);
    deps.provideStyle({ key: DOCK_STYLE_KEY, style: "" });
  };
  const stopResize = installDockResize(root, {
    width: () => shownPx,
    viewport,
    host: host?.defaultView ?? undefined,
    frameLeft: () => host?.querySelector(`.lsp-iframe-sandbox-container[data-pid="${deps.pluginId()}"]`)?.getBoundingClientRect().left ?? null,
    apply: (px, animate) => docked && applyDock(px, animate),
    commit: (px) => {
      if (!docked) return;
      keptPx = px;
      deps.dockWidth.write(px);
      applyDock(px, true);
    },
  });
  /** Hides Planner; in the sidebar mode the host's sidebar stays as it is (its own content shows again). The mode is kept. */
  const close = () => {
    visible = false;
    stopDock();
    deps.hideMainUI();
    changes?.setVisible(false);
  };
  const setSurface = (next: Surface) => {
    if (next === surface) return;
    surface = next;
    if (next === "sidebar") return dock();
    stopDock();
    deps.setFrame(WORKSPACE_FRAME); // the host's sidebar is left as it is
  };
  const views = createViewStore(deps.storage); // one store for the workspace and the in-page blocks
  const openNode = nodeOpener({ ...deps, hideMainUI: close });
  const workspace = createWorkspace(root, { dq: deps.dq, views, onClose: close, openNode, weekStart: deps.weekStart, kanban: deps.kanban, dates: deps.dates, timing, setSurface: host ? setSurface : undefined, prefs: createUiStore(deps.prefs, deps.graphState) });
  // N06b: read-only views in pages, drawn into host slots; they redraw on graph changes whether Planner is shown or not.
  const blocks = createBlocks({ dq: deps.dq, views, weekStart: deps.weekStart, provideUI: deps.provideUI, host, doc });
  // The first show loads the workspace; every later refresh is the quiet reload (src/ui/changes.ts decides when).
  let loaded = false;
  const refresh = () => (loaded ? workspace.refresh() : ((loaded = true), workspace.open()));

  const focusIn = () => {
    if (root.contains(doc.activeElement)) return;
    doc.defaultView?.focus();
    root.querySelector<HTMLElement>("[data-view-kind][aria-pressed=true], [data-action=close]")?.focus();
  };
  const open = () => {
    visible = true;
    if (surface === "sidebar") dock();
    else deps.setFrame(WORKSPACE_FRAME);
    deps.showMainUI();
    const shownBefore = loaded;
    changes?.setVisible(true);
    if (shownBefore) void workspace.showViews(); // the first show lists them as part of the load
    for (const ms of FOCUS_RETRIES_MS) deps.later(focusIn, ms);
  };

  /** "Open in Planner" on an in-page block (N06b): Planner in the workspace mode, on that saved view. */
  const openView = (id: string) => {
    if (surface === "sidebar") {
      surface = "workspace";
      stopDock();
    }
    open();
    void workspace.openView(id);
  };

  /** The toolbar button: hides Planner while it is shown (the host header stays usable under it), else opens it. The palette command only opens. */
  const toggle = () => (visible ? close() : open());

  // Escape is always Planner's (a popover, then the panel drawer at narrow widths, else the workspace), so it never reaches the host. Registered before the
  // host-key forwarder so `defaultPrevented` is set when that one looks.
  doc.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (!workspace.escape()) close();
  });
  const offHostKeys = installHostKeys(doc, host, { isVisible: () => visible, focusFrame: () => doc.defaultView?.focus() });

  deps.defer(() => {
    const feed = shareFeed(deps.changes.subscribe); // one DB.onChanged for the workspace and the blocks
    changes = createChanges({ subscribe: feed, later: deps.changes.later, refresh });
    // The blocks are always "visible": a pass with no block on screen reads nothing.
    const blockChanges = createChanges({ subscribe: feed, later: deps.changes.later, refresh: blocks.refresh });
    blockChanges.setVisible(true);
    const offVisible = deps.changes.onVisibleChanged((shown) => ((visible = shown), changes?.setVisible(shown)));
    // N04: nothing of the old graph survives a switch: the workspace state, the views cache, the in-page slots. Shown, Planner
    // loads the new graph at once; hidden, the next show does (`invalidate` marks the data stale, `loaded` makes it a first load).
    const offGraph = deps.changes.onGraphChanged(() => {
      loaded = false;
      views.invalidate();
      blocks.reset();
      void workspace.reset();
      changes?.invalidate();
    });
    const offTheme = watchTheme(deps.theme, doc);
    deps.changes.onUnload(() => {
      changes?.stop();
      blockChanges.stop();
      stopDock();
      stopResize();
      workspace.stop();
      offVisible();
      offGraph();
      offHostKeys();
      void offTheme.then((off) => off());
    });
    deps.provideModel({
      [OPEN_HANDLER]: toggle,
      [OPEN_NODE]: (e) => openNode(datasetValue(e, "uuid", "node uuid"), { sidebar: false }),
      [OPEN_VIEW]: (e) => openView(datasetValue(e, "viewId", "saved view id")),
    });
    deps.provideStyle({ key: "planner-block", style: blockStyle() });
    deps.onMacroRendererSlotted((e) => void blocks.slotted(e));
    deps.registerSlashCommand(SLASH_COMMAND, () => void deps.insertAtCursor(MACRO_TEXT));
    deps.registerUIItem("toolbar", {
      key: OPEN,
      template: `<a class="button" data-on-click="${OPEN_HANDLER}" title="Planner">${TOOLBAR_ICON}</a>`,
    });
    deps.registerCommandPalette({ key: OPEN, label: "Planner: open", keybinding: OPEN_KEYBINDING }, open);
  });
}
