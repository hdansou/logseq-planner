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

/**
 * The shared dock order: a plugin that docks on the right edge puts this attribute on its own container, a number one
 * above every stamp on the page, and takes it off when it stops docking. A plugin sits to the left of every visible frame
 * stamped lower than its own or not stamped at all (a plugin that does not know the contract), and ignores higher ones:
 * whoever docked first keeps the edge.
 */
export const DOCK_SEQ_ATTR = "data-dock-seq";

export interface Neighbours {
  /** The room the frames docked before this one take on the right edge now, px. */
  offset(): number;
  /** How many frames are docked before this one (the host rule's specificity steps up with it). */
  rank(): number;
  /** Takes the next place in the dock order. */
  stamp(): void;
  /** Gives the place up. */
  unstamp(): void;
  stop(): void;
}

/**
 * Measures the visible frames of other plugins (`pluginId` is left out) against `viewport()` and calls `onChange` when
 * one shows, hides, resizes or is added. Only the other frames are watched (class / style), so Planner's own frame
 * changes never wake it.
 */
export function installNeighbours(host: Pick<Document, "body" | "querySelector" | "querySelectorAll"> & { defaultView: { MutationObserver: typeof MutationObserver } | null }, pluginId: string, viewport: () => number, onChange: () => void): Neighbours {
  const Observer = host.defaultView?.MutationObserver ?? MutationObserver;
  const all = () => [...host.querySelectorAll<HTMLElement>(SELECTOR)];
  const others = () => all().filter((el) => el.dataset.pid !== pluginId);
  const own = () => all().find((el) => el.dataset.pid === pluginId);
  const seqOf = (el: Element | undefined) => {
    const n = Number(el?.getAttribute(DOCK_SEQ_ATTR));
    return Number.isFinite(n) && el?.hasAttribute(DOCK_SEQ_ATTR) ? n : null;
  };
  /** The visible frames this one yields to. */
  const before = () => {
    const mine = seqOf(own());
    return others().filter((el) => el.classList.contains("visible") && (mine === null || (seqOf(el) ?? -1) < mine));
  };
  const attrs = new Observer(() => onChange());
  const watched = new Set<Element>();
  const watch = () => {
    for (const el of others()) {
      if (watched.has(el)) continue;
      watched.add(el);
      attrs.observe(el, { attributes: true, attributeFilter: ["class", "style", DOCK_SEQ_ATTR] });
    }
  };
  const added = new Observer(() => (watch(), onChange()));
  watch();
  added.observe(host.body, { childList: true });
  const first = host.querySelector(SELECTOR)?.parentElement;
  if (first && first !== host.body) added.observe(first, { childList: true });
  return {
    offset: () => neighbourOffset(before().map((el) => el.getBoundingClientRect()), viewport()),
    rank: () => before().length,
    stamp() {
      const el = own();
      if (el) el.setAttribute(DOCK_SEQ_ATTR, String(Math.max(0, ...all().map((e) => seqOf(e) ?? 0)) + 1));
    },
    unstamp: () => own()?.removeAttribute(DOCK_SEQ_ATTR),
    stop: () => (attrs.disconnect(), added.disconnect()),
  };
}
