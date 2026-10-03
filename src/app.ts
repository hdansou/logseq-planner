import type { AppDeps } from "./types";
import { watchTheme } from "./ui/theme";

const OPEN = "planner-open";
const OPEN_HANDLER = "openPlanner";

/**
 * Renders the (empty) workspace into `root`, wires Escape and Close to hide it, and defers the
 * toolbar button and command palette entry that open it.
 */
export function registerApp(deps: AppDeps, root: HTMLElement): void {
  const open = () => deps.showMainUI();
  const close = () => deps.hideMainUI();

  root.innerHTML = `<header><h1>Planner</h1><button type="button" class="pl-btn" data-action="close">Close</button></header>`;
  root.querySelector("[data-action=close]")!.addEventListener("click", close);
  root.ownerDocument.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  deps.defer(() => {
    void watchTheme(deps.theme, root.ownerDocument);
    deps.provideModel({ [OPEN_HANDLER]: open });
    deps.registerUIItem("toolbar", {
      key: OPEN,
      template: `<a class="button" data-on-click="${OPEN_HANDLER}" title="Planner"><i class="ti ti-calendar-event"></i></a>`,
    });
    deps.registerCommandPalette({ key: OPEN, label: "Planner: open" }, open);
  });
}
