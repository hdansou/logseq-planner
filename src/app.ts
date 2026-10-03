import { createViewStore } from "./storage";
import type { AppDeps } from "./types";
import { watchTheme } from "./ui/theme";
import { createWorkspace } from "./ui/workspace";

const OPEN = "planner-open";
const OPEN_HANDLER = "openPlanner";
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
 * defers the toolbar button and command palette entry that open it.
 */
export function registerApp(deps: AppDeps, root: HTMLElement): void {
  const doc = root.ownerDocument;
  const close = () => deps.hideMainUI();
  const workspace = createWorkspace(root, { dq: deps.dq, views: createViewStore(deps.storage), onClose: close, openNode: nodeOpener(deps), weekStart: deps.weekStart, kanban: deps.kanban });
  doc.documentElement.classList.toggle("pl-mac-desktop", deps.macWindowButtons);

  const focusIn = () => {
    if (root.contains(doc.activeElement)) return;
    doc.defaultView?.focus();
    root.querySelector<HTMLElement>("[data-view-kind][aria-pressed=true], [data-action=close]")?.focus();
  };
  const open = () => {
    deps.showMainUI();
    void workspace.open();
    for (const ms of FOCUS_RETRIES_MS) deps.later(focusIn, ms);
  };

  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !workspace.escape()) close();
  });

  deps.defer(() => {
    void watchTheme(deps.theme, doc);
    deps.provideModel({ [OPEN_HANDLER]: open });
    deps.registerUIItem("toolbar", {
      key: OPEN,
      template: `<a class="button" data-on-click="${OPEN_HANDLER}" title="Planner"><i class="ti ti-calendar-event"></i></a>`,
    });
    deps.registerCommandPalette({ key: OPEN, label: "Planner: open", keybinding: OPEN_KEYBINDING }, open);
  });
}
