// In-page block (N06b): `{{renderer :planner, <saved view name>}}` in a page shows a read-only picture of that saved
// view, drawn by the same `renderViewArea` as the workspace's view area. The slot is ordinary host DOM: no script and no
// listener of ours runs there, so the markup is made read-only here and every click goes through `data-on-click` to a
// model handler (`OPEN_NODE`, `OPEN_VIEW`). `createBlocks` keeps the live slots and redraws them on graph changes.
import { loadTagInfos, tagsTitle, type Dq, type ViewTags } from "../core/schema";
import type { ZoneOffset } from "../core/normalize";
import { validateViewConfig, withKnownTags } from "../core/view-config";
import type { ListedView, SavedView, ViewStore } from "../storage";
import type { MacroSlotEvent, TagInfo } from "../types";
import { BLOCK_CLASS } from "./block-style";
import type { HostDocument } from "./host-keys";
import { esc } from "./html";
import { blockSession, readViewData, renderViewArea, type Now } from "./view-area";
import { localTime, localToday } from "./workspace";

/** The renderer macro's first argument. */
export const MACRO = ":planner";
/** What the slash command inserts; the user types the view's name after the comma. */
export const MACRO_TEXT = `{{renderer ${MACRO}, }}`;
/** Model handler: open the node whose uuid the clicked element carries (`data-uuid`). */
export const OPEN_NODE = "plannerOpenNode";
/** Model handler: open Planner on the saved view the clicked element carries (`data-view-id`). */
export const OPEN_VIEW = "plannerOpenView";
/** Without the host document (cross-origin) gone slots cannot be seen: at most this many are kept, the oldest dropped. */
export const MAX_BLIND_SLOTS = 20;

/**
 * The view name a renderer macro asks for: null when the macro is not Planner's (`arguments[0]` is not `:planner`),
 * else the other arguments joined with ", " (the host splits the macro at commas, and a name may contain them), trimmed.
 */
export function macroViewName(args: readonly string[]): string | null {
  if (args[0]?.trim() !== MACRO) return null;
  return args.slice(1).join(", ").trim();
}

/** The saved view named `name`: the exact name first, then ignoring case; null when none matches. */
export function findView(views: readonly ListedView[], name: string): ListedView | null {
  const lower = name.toLowerCase();
  return views.find((v) => v.name === name) ?? views.find((v) => v.name.toLowerCase() === lower) ?? null;
}

const root = (attrs: string, body: string) => `<div class="${BLOCK_CLASS}" data-planner-block${attrs}>${body}</div>`;
const quoted = (name: string) => `“${esc(name)}”`;

/** A block that shows a message instead of a view. `html` is already escaped. */
export const messageBlock = (html: string): string => root(" data-planner-message", `<p class="pl-block-message">${html}</p>`);

/** No saved view by that name: the message names the views that exist, or says to save one. */
export function unknownViewBlock(name: string, views: readonly ListedView[]): string {
  const names = views.map((v) => quoted(v.name)).join(", ");
  return messageBlock(`No saved Planner view named ${quoted(name)}. ${names ? `Saved views: ${names}.` : "Save a view in Planner first."}`);
}

/** A saved view that cannot be shown: its config does not parse, a tag or property is gone, or loading failed. */
export const failedViewBlock = (name: string, reason: string): string =>
  messageBlock(`<b>${quoted(name)}</b> cannot be shown: ${esc(reason)}`);

/** Elements that open a node in the workspace, by the attribute that carries the uuid. */
const OPEN_ATTRS = ["data-tl-open", "data-cal-open", "data-ag-open", "data-kb-open"];

/**
 * The view's HTML made read-only for the host page (no script runs there): connectors, the Kanban Move menus, drag,
 * workspace actions, Timeline toggles and the empty Kanban cell's "Drop here" are taken out (a toggle leaves the empty placeholder a row without one has);
 * the Timeline's earlier / later jumps and the Calendar's "+N more" become text; Agenda and Kanban "Show more" become
 * "N more"; folded Agenda buckets are closed (their entries are rendered, so the browser's own toggle shows them);
 * every element that opens a node gets `data-on-click` → `OPEN_NODE` with its uuid in `data-uuid`. `doc` parses it.
 */
export function readOnly(html: string, doc: Document): string {
  const t = doc.createElement("template");
  t.innerHTML = html;
  const all = (sel: string) => [...t.content.querySelectorAll<HTMLElement>(sel)];
  const el = (tag: string, attrs: Record<string, string>, text: string) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.textContent = text;
    return e;
  };
  all("[data-tl-links], .pl-kb-move-anchor, [data-action]").forEach((e) => e.remove());
  all("[draggable]").forEach((e) => e.removeAttribute("draggable"));
  all(".pl-kb-drop").forEach((e) => (e.textContent = "")); // "Drop here": nothing can be dropped in a block
  all("details[open]").forEach((e) => e.removeAttribute("open"));
  all("[data-tl-toggle]").forEach((e) => e.replaceWith(el("span", { class: "pl-tl-toggle", "aria-hidden": "true" }, "")));
  all("[data-tl-jump], [data-cal-more]").forEach((e) =>
    e.replaceWith(el("span", { class: e.className, style: e.getAttribute("style") ?? "", "data-planner-text": "" }, e.textContent ?? "")));
  all("[data-ag-more], [data-kb-more]").forEach((e) =>
    e.replaceWith(el("p", { class: "pl-block-more", "data-planner-text": "" }, `${Number(e.dataset.rest).toLocaleString("en-US")} more`)));
  for (const attr of OPEN_ATTRS) {
    all(`[${attr}]`).forEach((e) => {
      e.setAttribute("data-on-click", OPEN_NODE);
      e.setAttribute("data-uuid", e.getAttribute(attr)!);
    });
  }
  return t.innerHTML;
}

/** A saved view's block: the header (name, tags, Open in Planner) and the read-only view. */
export function viewBlock(saved: SavedView, view: ViewTags, viewHtml: string, doc: Document): string {
  const head = `<div class="pl-block-head"><b class="pl-block-name">${esc(saved.name)}</b><span class="pl-block-tags">${esc(tagsTitle(view.tags))}</span>`
    + `<button type="button" class="pl-btn" data-on-click="${OPEN_VIEW}" data-view-id="${esc(saved.id)}">Open in Planner</button></div>`;
  return root(` data-view-kind="${saved.config.kind}"`, head + `<div class="pl-block-view">${readOnly(viewHtml, doc)}</div>`);
}

/** The SDK and graph access the blocks need; `src/app.ts` wires the real ones. */
export interface BlockDeps {
  dq: Dq;
  views: ViewStore;
  /** The host's first day of the week, 0 = Sunday; read on every pass. */
  weekStart(): Promise<number>;
  zone?: ZoneOffset;
  /** Today as a local `YYYY-MM-DD`; defaults to the machine's clock. */
  today?: () => string;
  /** The local time as `HH:MM`; defaults to the machine's clock. */
  time?: () => string;
  /** `logseq.provideUI`: draws `template` into the host slot. */
  provideUI(ui: { key: string; slot: string; reset: true; template: string }): void;
  /** The host document when it is reachable (desktop app), else null: then gone slots cannot be told apart. */
  host: HostDocument | null;
  /** The plugin frame's document (parses the view HTML for `readOnly`). */
  doc: Document;
}

export interface Blocks {
  /** A renderer macro was drawn: when it is Planner's, its slot is kept and drawn (with any other slot waiting). */
  slotted(e: MacroSlotEvent): Promise<void>;
  /** The graph changed: every kept slot is drawn again. Never rejects. */
  refresh(): Promise<void>;
  /** Resolves when no draw is running or owed (tests). */
  idle(): Promise<void>;
  /** The kept slots, oldest first (tests). */
  slots(): string[];
}

/**
 * The live in-page blocks. A registry of slots (slot id → view name and block uuid, oldest first); a pass draws the
 * slots asked for: it reads the week start, the tags and the saved views once, loads each saved view once however many
 * blocks show it, and draws every slot. One pass at a time; slots asked for meanwhile are drawn together by the next.
 * Before each pass, slots whose element is gone from the host document are dropped; cross-origin they cannot be seen,
 * so the registry keeps the newest `MAX_BLIND_SLOTS`.
 */
export function createBlocks(deps: BlockDeps): Blocks {
  const registry = new Map<string, { name: string; uuid: string }>();
  let owed: Set<string> | null = null;
  let running: Promise<void> | null = null;

  const show = (slot: string, template: string) => deps.provideUI({ key: `planner-block-${slot}`, slot, reset: true, template });
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const prune = () => {
    const host = deps.host;
    if (!host) return;
    for (const slot of [...registry.keys()]) if (!host.querySelector(`#${CSS.escape(slot)}`)) registry.delete(slot);
  };

  /** One saved view's block HTML; any failure becomes the block's message. */
  async function draw(saved: SavedView, tags: TagInfo[], now: Now): Promise<string> {
    try {
      const config = withKnownTags(saved.config, tags);
      const view = validateViewConfig(config, tags);
      const data = await readViewData(deps.dq, config, tags, deps.zone);
      const area = renderViewArea({ tags, config, view, ...data, session: blockSession() }, () => now);
      return viewBlock(saved, view, area.view, deps.doc);
    } catch (e) {
      return failedViewBlock(saved.name, message(e));
    }
  }

  async function pass(asked: Set<string>) {
    prune();
    const targets = [...asked].filter((s) => registry.has(s));
    if (!targets.length) return;
    let tags: TagInfo[];
    let views: ListedView[];
    let now: Now;
    try {
      deps.views.invalidate(); // views saved or deleted since the last pass (another device, the workspace)
      const [weekStart, t, v] = await Promise.all([deps.weekStart(), loadTagInfos(deps.dq), deps.views.list()]);
      [tags, views, now] = [t, v, { today: (deps.today ?? localToday)(), time: (deps.time ?? localTime)(), weekStart }];
    } catch (e) {
      const html = messageBlock(`Planner could not load: ${esc(message(e))}`);
      return targets.forEach((s) => show(s, html));
    }
    const loads = new Map<string, Promise<string>>(); // by saved view id: one load per view per pass
    await Promise.all(targets.map(async (slot) => {
      const name = registry.get(slot)!.name;
      const found = findView(views, name);
      const html = !found ? unknownViewBlock(name, views)
        : "invalid" in found ? failedViewBlock(found.name, found.invalid)
        : await (loads.get(found.id) ?? loads.set(found.id, draw(found, tags, now)).get(found.id)!);
      if (registry.has(slot)) show(slot, html);
    }));
  }

  /** Starts the next pass when none runs and slots are owed; the promise ends when nothing is owed any more. */
  const kick = (): Promise<void> => {
    if (running) return running;
    if (!owed) return Promise.resolve();
    const asked = owed;
    owed = null;
    running = pass(asked).catch((e: unknown) => console.error("Planner in-page block:", e)).finally(() => (running = null)).then(kick);
    return running;
  };
  const request = (slots: Iterable<string>) => {
    owed ??= new Set();
    for (const s of slots) owed.add(s);
    return kick();
  };

  return {
    slotted({ slot, payload }) {
      const name = macroViewName(payload.arguments);
      if (name === null) return Promise.resolve();
      registry.delete(slot); // re-inserted as the newest
      registry.set(slot, { name, uuid: payload.uuid });
      if (!deps.host) while (registry.size > MAX_BLIND_SLOTS) registry.delete(registry.keys().next().value!);
      return request([slot]);
    },
    refresh: () => request(registry.keys()),
    async idle() {
      while (running) await running;
    },
    slots: () => [...registry.keys()],
  };
}
