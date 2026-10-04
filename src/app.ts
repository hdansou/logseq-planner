import { createViewStore } from "./storage";
import { createChanges } from "./ui/changes";
import { installHostKeys } from "./ui/host-keys";
import type { AppDeps } from "./types";
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

/**
 * Renders the workspace into `root`, wires Escape (an open popover first, then Planner) and Close, and
 * defers the toolbar button and command palette entry that open it. `timing` is the dev-only recorder (src/dev-timings.ts).
 */
export function registerApp(deps: AppDeps, root: HTMLElement, timing?: Timing): void {
  const doc = root.ownerDocument;
  let changes: ReturnType<typeof createChanges> | null = null; // created with the deferred registrations
  let visible = false; // the frame is shown: set by open / close and by the host's visibility event
  const close = () => {
    visible = false;
    deps.hideMainUI();
    changes?.setVisible(false);
  };
  const workspace = createWorkspace(root, { dq: deps.dq, views: createViewStore(deps.storage), onClose: close, openNode: nodeOpener({ ...deps, hideMainUI: close }), weekStart: deps.weekStart, kanban: deps.kanban, timing });
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
    deps.showMainUI();
    const shownBefore = loaded;
    changes?.setVisible(true);
    if (shownBefore) void workspace.showViews(); // the first show lists them as part of the load
    for (const ms of FOCUS_RETRIES_MS) deps.later(focusIn, ms);
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
  const offHostKeys = installHostKeys(doc, deps.hostDocument(), { isVisible: () => visible, focusFrame: () => doc.defaultView?.focus() });

  deps.defer(() => {
    changes = createChanges({ subscribe: deps.changes.subscribe, later: deps.changes.later, refresh });
    const offVisible = deps.changes.onVisibleChanged((shown) => ((visible = shown), changes?.setVisible(shown)));
    const offTheme = watchTheme(deps.theme, doc);
    deps.changes.onUnload(() => {
      changes?.stop();
      workspace.stop();
      offVisible();
      offHostKeys();
      void offTheme.then((off) => off());
    });
    deps.provideModel({ [OPEN_HANDLER]: toggle });
    deps.registerUIItem("toolbar", {
      key: OPEN,
      template: `<a class="button" data-on-click="${OPEN_HANDLER}" title="Planner">${TOOLBAR_ICON}</a>`,
    });
    deps.registerCommandPalette({ key: OPEN, label: "Planner: open", keybinding: OPEN_KEYBINDING }, open);
  });
}
