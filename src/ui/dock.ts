/**
 * The sidebar surface (N06a): keeps Planner's frame laid over Logseq's right sidebar. Watches `#right-sidebar` in the
 * host document with the host window's own `ResizeObserver` (its width: Logseq's resizer, the window) and
 * `MutationObserver` (its `class`: `open` / `closed`), plus the host window's `resize` event.
 */
import type { HostDocument } from "./host-keys";

export interface DockHooks {
  /** The open sidebar and its resizer as measured now (`getBoundingClientRect()`); the app turns them into the frame. */
  place(sidebar: DOMRect, resizer: DOMRect): void;
  /** The sidebar went from open to `closed` (the user closed it): the app hides Planner. */
  onClosed(): void;
}

/**
 * Starts following the sidebar and places the frame at once when it is open (a closed one is waited for: Planner asked
 * the host to open it). Fails fast when the host has no `#right-sidebar` or an open one has no `.resizer`. Returns the
 * stop function, which disconnects both observers and removes the resize listener.
 */
export function startDock(host: HostDocument, hooks: DockHooks): () => void {
  const win = host.defaultView;
  if (!win) throw new Error("The host document has no window");
  const sidebar = host.querySelector<HTMLElement>("#right-sidebar");
  if (!sidebar) throw new Error("Logseq's right sidebar (#right-sidebar) is not in the host document");
  const isOpen = () => sidebar.classList.contains("open");
  const measure = () => {
    if (!isOpen()) return;
    const resizer = sidebar.querySelector<HTMLElement>(".resizer");
    if (!resizer) throw new Error("Logseq's right sidebar has no .resizer");
    hooks.place(sidebar.getBoundingClientRect(), resizer.getBoundingClientRect());
  };
  let wasOpen = isOpen();
  const sizes = new win.ResizeObserver(measure);
  const classes = new win.MutationObserver(() => {
    const open = isOpen();
    if (open) measure();
    else if (wasOpen && sidebar.classList.contains("closed")) hooks.onClosed();
    wasOpen = open;
  });
  sizes.observe(sidebar);
  classes.observe(sidebar, { attributes: true, attributeFilter: ["class"] });
  win.addEventListener("resize", measure);
  measure();
  return () => {
    sizes.disconnect();
    classes.disconnect();
    win.removeEventListener("resize", measure);
  };
}
