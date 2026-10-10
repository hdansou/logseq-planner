/**
 * Other plugins docked on the window's right edge (N44). Logseq has no dock slot for plugins, so two that pin their
 * frame to `right: 0` cover each other and the one host margin each reserves is not the sum. Planner measures what is
 * there, docks to the left of it and reserves both strips; nothing is asked of the other plugin.
 */
export interface EdgeRect {
  left: number;
  right: number;
}

/** A pixel or two of rounding at the window's edge still counts as touching it. */
const EDGE_SLACK_PX = 2;

/** How far in from the right edge the widest frame sitting on it reaches; full-screen and floating frames do not count. */
export function neighbourOffset(rects: EdgeRect[], viewport: number): number {
  let offset = 0;
  for (const r of rects) {
    if (r.right < viewport - EDGE_SLACK_PX || r.left <= 0 || r.left >= viewport - EDGE_SLACK_PX) continue;
    offset = Math.max(offset, Math.round(viewport - r.left));
  }
  return offset;
}

const SELECTOR = ".lsp-iframe-sandbox-container";

export interface Neighbours {
  /** The room other plugins' frames take on the right edge now, px. */
  offset(): number;
  stop(): void;
}

/**
 * Measures the visible frames of other plugins (`pluginId` is left out) against `viewport()` and calls `onChange` when
 * one shows, hides, resizes or is added. Only the other frames are watched (class / style), so Planner's own frame
 * changes never wake it.
 */
export function installNeighbours(host: Pick<Document, "body" | "querySelector" | "querySelectorAll"> & { defaultView: { MutationObserver: typeof MutationObserver } | null }, pluginId: string, viewport: () => number, onChange: () => void): Neighbours {
  const Observer = host.defaultView?.MutationObserver ?? MutationObserver;
  const others = () => [...host.querySelectorAll<HTMLElement>(SELECTOR)].filter((el) => el.dataset.pid !== pluginId);
  const attrs = new Observer(() => onChange());
  const watched = new Set<Element>();
  const watch = () => {
    for (const el of others()) {
      if (watched.has(el)) continue;
      watched.add(el);
      attrs.observe(el, { attributes: true, attributeFilter: ["class", "style"] });
    }
  };
  const added = new Observer(() => (watch(), onChange()));
  watch();
  added.observe(host.body, { childList: true });
  const first = host.querySelector(SELECTOR)?.parentElement;
  if (first && first !== host.body) added.observe(first, { childList: true });
  return {
    offset: () => neighbourOffset(others().filter((el) => el.classList.contains("visible")).map((el) => el.getBoundingClientRect()), viewport()),
    stop: () => (attrs.disconnect(), added.disconnect()),
  };
}
