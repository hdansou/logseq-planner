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

/** A pill button that is on or off (`aria-pressed`), carrying the boolean attribute `data-<attr>`. */
export function toggleButton(label: string, attr: string, pressed: boolean): string {
  return `<button type="button" class="pl-btn pl-toggle" data-${attr} aria-pressed="${pressed}">${esc(label)}</button>`;
}

/**
 * A menu trigger plus, when `open`, its popover; both inside one positioned anchor. `buttonText` is HTML (escape it).
 * Hooks: the trigger carries `data-control="<control>"`, the popover `data-popover="<id>"`.
 */
export function menu(id: string, open: boolean, label: string, buttonText: string, popover: () => string, control: string = id): string {
  const el = `pl-${id}`;
  return `<span class="pl-anchor"><span class="pl-field-label" id="${el}-label">${esc(label)}</span>`
    + `<button type="button" class="pl-menu-btn" id="${el}-btn" data-control="${control}" aria-haspopup="true" aria-expanded="${open}" aria-labelledby="${el}-label ${el}-btn">${buttonText}<span class="pl-caret" aria-hidden="true">▾</span></button>`
    + (open ? `<div class="pl-popover" data-popover="${id}">${popover()}</div>` : "")
    + `</span>`;
}

/** A single-choice listbox of buttons carrying `data-option`; `value` "" stands for none. */
export function options(label: string, items: { value: string; text: string }[], current: string): string {
  return `<div role="listbox" aria-label="${esc(label)}">${items
    .map((o) => `<button type="button" role="option" class="pl-row" data-option="${esc(o.value)}" aria-selected="${o.value === current}">${esc(o.text)}</button>`)
    .join("")}</div>`;
}
