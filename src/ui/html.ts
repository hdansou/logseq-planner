// Small HTML helpers shared by the view renderers (pure strings, no DOM).

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** ` name` when `on`, else "": a boolean attribute. */
export const flag = (name: string, on: boolean): string => (on ? ` ${name}` : "");

/**
 * Prev / range label / next / Today for a view toolbar. Hooks: `data-<prefix>-nav="prev|next|today"` and
 * `data-<prefix>-range` (e.g. `tl`, `cal`).
 */
export function viewNav(prefix: string, label: string): string {
  return `<div class="pl-nav">`
    + `<button type="button" class="pl-btn pl-nav-step" data-${prefix}-nav="prev" aria-label="Previous">‹</button>`
    + `<b class="pl-nav-range" data-${prefix}-range aria-live="polite">${esc(label)}</b>`
    + `<button type="button" class="pl-btn pl-nav-step" data-${prefix}-nav="next" aria-label="Next">›</button>`
    + `<button type="button" class="pl-btn" data-${prefix}-nav="today">Today</button></div>`;
}

/** A segmented control of `[value, text]` buttons carrying `data-<attr>="value"`, the current one pressed. */
export function segmented(label: string, attr: string, items: [string, string][], current: string): string {
  return `<div class="pl-seg" role="group" aria-label="${esc(label)}">${items
    .map(([value, text]) => `<button type="button" data-${attr}="${value}" aria-pressed="${value === current}">${esc(text)}</button>`).join("")}</div>`;
}
