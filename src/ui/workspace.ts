// The full-screen workspace shell: top bar (view switch, saved views, Close), settings bar (tag, child tags,
// Start, End, done values), tag tree and choice filters, a per-view toolbar slot and the main area.
// Renders the whole shell from `State` on every change (small pure render functions returning HTML) and
// handles every event by delegation on the root. No SDK: graph access arrives as `WorkspaceDeps`.
// The Timeline (T08) renders into the view area and the toolbar slot; the other kinds show a placeholder.
import { loadNodes, loadTasks } from "../core/queries";
import { filterNodes, isDone } from "../core/nodes";
import type { ZoneOffset } from "../core/normalize";
import type { Dq } from "../core/schema";
import { loadTagInfos } from "../core/schema";
import { defaultViewConfig, toChoiceFilters, validateViewConfig, VIEW_KINDS, type ViewConfig, type ViewKind } from "../core/view-config";
import { titlesByUuid } from "../core/display-title";
import { viewItems } from "../core/layout-common";
import { layoutTimeline, shiftAnchor, type TimelineLayout } from "../core/timeline-layout";
import type { SavedView, ViewStore } from "../storage";
import type { ChoiceProp, ClosedValue, PlannerNode, PlannerTask, TagInfo } from "../types";
import { renderTimeline, renderTimelineToolbar, timelineAction } from "./timeline";

export interface WorkspaceDeps {
  dq: Dq;
  views: ViewStore;
  /** Close button: the app hides the main UI. */
  onClose(): void;
  /** Local zone offset for DateTime values; defaults to the machine's. */
  zone?: ZoneOffset;
  /** Opens a node (page or block) by uuid: in the main area, or in the right sidebar with Shift. */
  openNode(uuid: string, opts: { sidebar: boolean }): void;
  /** Today as a local `YYYY-MM-DD`; defaults to the machine's clock. */
  today?: () => string;
  /** The host's first day of the week, 0 = Sunday … 6 = Saturday; read on every `open()`. */
  weekStart(): Promise<number>;
}

export interface Workspace {
  /** (Re)loads tags, saved views and the current view's nodes; call on every open. */
  open(): Promise<void>;
  /** Closes an open popover and returns true; false when there is nothing to close (the app then closes Planner). */
  escape(): boolean;
  /** Resolves when every queued action has finished (tests, focus after open). */
  idle(): Promise<void>;
  /** The current view config (null until a tag exists). */
  config(): ViewConfig | null;
}

type Popover = "tag" | "start" | "end" | "done" | "views";

interface State {
  loading: boolean;
  tags: TagInfo[];
  config: ViewConfig | null;
  nodes: PlannerNode[];
  tasks: PlannerTask[];
  views: SavedView[];
  /** The saved view the current config came from or was saved as. */
  viewId: string | null;
  popover: Popover | null;
  error: string | null;
  /** The built-in tags group of the tag tree is open (collapsed by default; opened when a built-in tag is selected). */
  builtInOpen: boolean;
  /** Timeline anchor day; null = today. Session state: never saved with a view. */
  anchor: string | null;
  /** Node ids whose task rows are expanded (Timeline). Session state. */
  expanded: Set<number>;
  /** The host's week start, read on every open; null before the first. */
  weekStart: number | null;
}

/** What the clock and the host week start say right now: injected so renders stay pure; asked only when a view needs it. */
interface Now {
  today: string;
  weekStart: number;
}

const KIND_LABEL: Record<ViewKind, string> = { timeline: "Timeline", calendar: "Calendar", agenda: "Agenda", kanban: "Kanban" };
const KIND_TASK: Record<ViewKind, string> = { timeline: "T08", calendar: "T09", agenda: "T10", kanban: "T11" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const byTitle = (a: TagInfo, b: TagInfo) => a.title.localeCompare(b.title);

// ---------------------------------------------------------------- pure helpers

/** Tags with no parent in `tags`, own first, by title: the top level of the tag tree. */
const rootsOf = (tags: TagInfo[]) => {
  const ids = new Set(tags.map((t) => t.id));
  return tags.filter((t) => !t.parentIds.some((id) => ids.has(id))).sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || byTitle(a, b));
};

/**
 * The tag a fresh workspace shows: the first own root tag with a date property in tree order, else the first own
 * tag with one, else the first tag (T07 D3: a child tag sorting first alphabetically must not win).
 */
export function initialTag(tags: TagInfo[]): TagInfo | null {
  const hasDates = (t: TagInfo) => !t.builtIn && t.dateProps.length > 0;
  const ordered = [...tags].sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || byTitle(a, b));
  return rootsOf(tags).find(hasDates) ?? ordered.find(hasDates) ?? ordered[0] ?? null;
}

/** The nodes that pass the view's filters and the tasks linked to them: what a view is handed (T07 D4). */
export function visibleData(config: ViewConfig, tag: TagInfo, nodes: PlannerNode[], tasks: PlannerTask[]) {
  const shown = filterNodes(nodes, toChoiceFilters(config, tag));
  const ids = new Set(shown.map((n) => n.id));
  return { nodes: shown, tasks: tasks.filter((t) => t.nodeIds.some((id) => ids.has(id))) };
}

/** Keeps the shared fields (tag, dates, filters, done values) and takes the new kind's defaults for the rest. */
export function switchKind(config: ViewConfig, tag: TagInfo, kind: ViewKind): ViewConfig {
  const { tag: t, childTags, start, end, doneValues, filters } = config;
  return { ...defaultViewConfig(tag, kind), tag: t, childTags, start, end, doneValues, filters };
}

/** The choice property the done-values control is labelled with: Status, else the first one. */
const primaryChoice = (tag: TagInfo): ChoiceProp | undefined => tag.choiceProps.find((p) => p.title === "Status") ?? tag.choiceProps[0];

/** Uuids of `prop`'s values that count as done under `config` (saved override, else the default rule). */
const doneUuids = (config: ViewConfig, prop: ChoiceProp) => prop.values.filter((v) => isDone(v, config.doneValues[prop.ident])).map((v) => v.uuid);

const toggle = <T>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

/** The built-in Task Status values (their flags decide done); none in a graph without the Task tag, then every task is open. */
const taskStatusValues = (tags: TagInfo[]): ClosedValue[] =>
  tags.flatMap((t) => t.choiceProps).find((p) => p.ident === ":logseq.property/status")?.values ?? [];

/** The machine's local day as `YYYY-MM-DD` (the default `today`). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- render (pure: state → HTML)

/** A menu trigger plus, when open, its popover; both inside one positioned anchor. */
function menu(kind: Popover, s: State, label: string, buttonText: string, popover: () => string, control: string = kind): string {
  const open = s.popover === kind;
  const id = `pl-${kind}`;
  return `<span class="pl-anchor"><span class="pl-field-label" id="${id}-label">${esc(label)}</span>`
    + `<button type="button" class="pl-menu-btn" id="${id}-btn" data-control="${control}" aria-haspopup="true" aria-expanded="${open}" aria-labelledby="${id}-label ${id}-btn">${buttonText}<span class="pl-caret" aria-hidden="true">▾</span></button>`
    + (open ? `<div class="pl-popover" data-popover="${kind}">${popover()}</div>` : "")
    + `</span>`;
}

/** A single-choice listbox of buttons; `value` "" stands for none. */
function options(label: string, items: { value: string; text: string }[], current: string): string {
  return `<div role="listbox" aria-label="${esc(label)}">${items
    .map((o) => `<button type="button" role="option" class="pl-row" data-option="${esc(o.value)}" aria-selected="${o.value === current}">${esc(o.text)}</button>`)
    .join("")}</div>`;
}

function renderTopBar(s: State): string {
  const kind = s.config?.kind;
  const seg = VIEW_KINDS.map((k) => `<button type="button" data-view-kind="${k}" aria-pressed="${k === kind}"${s.config ? "" : " disabled"}>${KIND_LABEL[k]}</button>`).join("");
  const current = s.views.find((v) => v.id === s.viewId);
  const viewsPopover = () => {
    const rows = s.views.length
      ? `<ul class="pl-view-list" aria-label="Saved views">${s.views
          .map((v) => `<li><button type="button" class="pl-row" data-view-open="${esc(v.id)}"${v.id === s.viewId ? ' aria-current="true"' : ""}>${esc(v.name)}</button>`
            + `<button type="button" class="pl-icon-btn" data-view-delete="${esc(v.id)}" aria-label="Delete saved view ${esc(v.name)}">×</button></li>`)
          .join("")}</ul>`
      : `<p class="pl-hint">No saved views yet.</p>`;
    const tag = s.config ? s.tags.find((t) => t.ident === s.config!.tag) : undefined;
    const suggestion = tag && s.config ? `#${tag.title} ${KIND_LABEL[s.config.kind].toLowerCase()}` : "";
    const save = s.config
      ? `<div class="pl-save"><label for="pl-view-name">Name</label><input id="pl-view-name" class="pl-input" data-field="view-name" value="${esc(suggestion)}" autocomplete="off">`
        + `<button type="button" class="pl-btn pl-btn-primary" data-action="save-view">Save current view</button></div>`
      : "";
    return rows + save;
  };
  return `<header class="pl-top" data-region="topbar"><h1 class="pl-title">Planner</h1>`
    + `<div class="pl-seg" role="group" aria-label="View">${seg}</div><span class="pl-spacer"></span>`
    + menu("views", s, "Saved views", current ? esc(current.name) : "None", viewsPopover, "saved-views")
    + `<button type="button" class="pl-btn" data-action="close">Close</button></header>`;
}

function renderSettings(s: State, tag: TagInfo): string {
  const c = s.config!;
  const tagOptions = () => options("Tags", [...s.tags].sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || byTitle(a, b))
    .map((t) => ({ value: t.ident, text: `#${t.title}${t.builtIn ? " (built-in)" : ""}` })), c.tag);
  let html = menu("tag", s, "Tag", `#${esc(tag.title)}`, tagOptions);

  const children = tag.childIds.map((id) => s.tags.find((t) => t.id === id)).filter((t): t is TagInfo => !!t);
  if (children.length) {
    html += `<span class="pl-check"><input type="checkbox" id="pl-child-tags" data-control="child-tags"${c.childTags ? " checked" : ""}>`
      + `<label for="pl-child-tags">Include ${children.map((t) => `#${esc(t.title)}`).join(", ")}</label></span>`;
  }

  if (tag.dateProps.length) {
    const dateTitle = (ident: string | null) => tag.dateProps.find((p) => p.ident === ident)?.title ?? "None";
    const dateItems = tag.dateProps.map((p) => ({ value: p.ident, text: `${p.title} (${p.type === "date" ? "Date" : "DateTime"})` }));
    html += menu("start", s, "Start", esc(dateTitle(c.start)), () => options("Start property", dateItems, c.start ?? ""));
    html += menu("end", s, "End", esc(dateTitle(c.end)), () => options("End property", [{ value: "", text: "None" }, ...dateItems], c.end ?? ""));
  } else {
    html += `<span class="pl-hint">No date properties on this tag</span>`;
  }

  const primary = primaryChoice(tag);
  if (primary) {
    const titles = primary.values.filter((v) => doneUuids(c, primary).includes(v.uuid)).map((v) => v.title);
    const popover = () => tag.choiceProps.map((p) => {
      const done = doneUuids(c, p);
      return `<fieldset><legend>${esc(p.title)}</legend>${p.values.map((v) =>
        `<label class="pl-row"><input type="checkbox" data-done-prop="${esc(p.ident)}" data-done-value="${esc(v.uuid)}"${done.includes(v.uuid) ? " checked" : ""}> ${esc(v.title)}</label>`).join("")}</fieldset>`;
    }).join("") + `<p class="pl-hint">${primary.values.some((v) => v.ident !== null) && !c.doneValues[primary.ident] ? "Built-in values use their Done and Canceled flags." : "Saved with the view."}</p>`;
    html += menu("done", s, "Done when", `${esc(primary.title)} is ${esc(titles.join(", ") || "nothing")}`, popover, "done-values");
  }
  return `<div class="pl-settings" data-region="settings" aria-label="View settings">${html}</div>`;
}

function renderTagTree(s: State, selected: string | undefined): string {
  const byId = new Map(s.tags.map((t) => [t.id, t]));
  const seen = new Set<number>();
  const item = (t: TagInfo): string => {
    if (seen.has(t.id)) return "";
    seen.add(t.id);
    const kids = t.childIds.map((id) => byId.get(id)).filter((k): k is TagInfo => !!k && k.parentIds[0] === t.id).sort(byTitle);
    return `<li><button type="button" class="pl-row" data-tag-id="${t.id}" aria-pressed="${t.ident === selected}"><span class="pl-hash">#</span>${esc(t.title)}</button>`
      + (kids.length ? `<ul>${kids.map(item).join("")}</ul>` : "") + `</li>`;
  };
  // A root has no parent in the list; a tag with several parents is listed under its first one.
  const roots = rootsOf(s.tags);
  const list = (key: string, items: TagInfo[], hidden = false) =>
    `<ul class="pl-tree" id="pl-tags-${key}" data-tag-group="${key}"${hidden ? " hidden" : ""}>${items.map(item).join("")}</ul>`;
  const own = roots.filter((t) => !t.builtIn);
  const builtIn = roots.filter((t) => t.builtIn);
  // Built-in tags start collapsed so "Your tags" and the filters fit without scrolling (T07 D6).
  return `<nav aria-label="Tags">`
    + (own.length ? `<h2 class="pl-group-header">Your tags</h2>${list("own", own)}` : "")
    + (builtIn.length ? `<h2 class="pl-group-header"><button type="button" class="pl-disclosure" data-action="toggle-built-in" aria-expanded="${s.builtInOpen}" aria-controls="pl-tags-built-in">Built-in tags</button></h2>${list("built-in", builtIn, !s.builtInOpen)}` : "")
    + `</nav>`;
}

function renderFilters(s: State, tag: TagInfo): string {
  const c = s.config!;
  return tag.choiceProps.map((p) => {
    const selected = c.filters[p.ident] ?? [];
    const count = (id: number | null) => s.nodes.filter((n) => (n.choices[p.ident]?.id ?? null) === id).length;
    const row = (uuid: string | null, title: string, id: number | null) =>
      `<label class="pl-row"><input type="checkbox" data-filter-prop="${esc(p.ident)}" data-filter-value="${esc(uuid ?? "")}"${selected.includes(uuid) ? " checked" : ""}>`
      + `<span class="pl-filter-title">${esc(title)}</span><span class="pl-count">${count(id)}</span></label>`;
    return `<fieldset class="pl-filter" data-filter-group="${esc(p.ident)}"><legend class="pl-group-header">${esc(p.title)}</legend>`
      + p.values.map((v) => row(v.uuid, v.title, v.id)).join("") + row(null, "No value", null) + `</fieldset>`;
  }).join("");
}

const empty = (key: string, title: string, body: string, action = "") =>
  `<div class="pl-empty" data-empty="${key}"><b>${title}</b><span>${body}</span>${action}</div>`;

/** The Timeline layout for the visible nodes. */
function timelineLayout(s: State, now: Now, shown: { nodes: PlannerNode[]; tasks: PlannerTask[] }): TimelineLayout {
  const c = s.config!;
  if (c.kind !== "timeline") throw new Error(`timelineLayout called for a ${c.kind} view`);
  const statusValues = taskStatusValues(s.tags);
  return layoutTimeline({
    items: viewItems(shown.nodes, shown.tasks, c.start, c.end, statusValues),
    zoom: c.zoom, anchor: s.anchor ?? now.today, today: now.today, weekStart: now.weekStart, statusValues,
    titles: titlesByUuid(s.nodes),
  });
}

/** The main area (loading, an empty state, the Timeline or the placeholder for a kind not built yet) and its toolbar. */
function renderView(s: State, tag: TagInfo | undefined, now: () => Now): { view: string; toolbar: string } {
  const view = (html: string) => ({ view: html, toolbar: "" });
  if (s.loading) return view(`<div class="pl-empty" data-region="loading"><span>Loading…</span></div>`);
  if (!s.tags.length) return view(empty("no-tags", "No tags in this graph", "Create a tag in Logseq (type #Project on a block, for example) and it shows up here."));
  if (!tag || !s.config) return view("");
  const name = `#${esc(tag.title)}`;
  if (s.config.kind !== "kanban" && !tag.dateProps.length) {
    return view(empty("no-dates", `${name} has no date properties`, "Add a Date or DateTime property to the tag in Logseq and pick it as Start or End, or choose another tag."));
  }
  if (!s.nodes.length) return view(empty("no-nodes", `No ${name} nodes yet`, `Tag a page or block with ${name} and it shows up here.`));
  const shown = visibleData(s.config, tag, s.nodes, s.tasks);
  if (!shown.nodes.length) {
    return view(empty("no-matches", `No ${name} nodes match the filters`, "Change the filters in the left column.",
      `<button type="button" class="pl-btn" data-action="clear-filters">Clear filters</button>`));
  }
  if (s.config.kind === "timeline") {
    const layout = timelineLayout(s, now(), shown);
    return { view: renderTimeline(layout, `#${tag.title}`, s.expanded), toolbar: renderTimelineToolbar(layout) };
  }
  const kind = KIND_LABEL[s.config.kind];
  return view(`<div class="pl-placeholder" data-region="view-placeholder"><b>${kind}</b>`
    + `<span>${plural(shown.nodes.length, "node")} · ${plural(shown.tasks.length, "linked task")}. The ${kind} view arrives in ${KIND_TASK[s.config.kind]}.</span></div>`);
}

function renderWorkspace(s: State, now: () => Now): string {
  const tag = s.config ? s.tags.find((t) => t.ident === s.config!.tag) : undefined;
  const error = s.error
    ? `<div class="pl-error" role="alert" data-region="error"><span>${esc(s.error)}</span><button type="button" class="pl-btn" data-action="dismiss-error">Dismiss</button></div>`
    : "";
  const kind = s.config?.kind ?? "";
  const main = renderView(s, tag, now);
  return `<div class="pl-ws">${renderTopBar(s)}${error}`
    + (tag ? renderSettings(s, tag) : `<div class="pl-settings" data-region="settings" aria-label="View settings"></div>`)
    + `<div class="pl-body"><aside class="pl-sidebar" data-region="sidebar">${renderTagTree(s, tag?.ident)}${tag ? renderFilters(s, tag) : ""}</aside>`
    + `<main class="pl-main" data-region="main"><div class="pl-view-toolbar" data-region="view-toolbar" data-view-kind="${kind}">${main.toolbar}</div>`
    + `<div class="pl-view" data-region="view">${main.view}</div></main></div></div>`;
}

// ---------------------------------------------------------------- controller

/** A selector that finds the same control after a re-render: its tag plus every `data-*` and `id` attribute. */
function selectorOf(el: Element): string {
  const attrs = [...el.attributes].filter((a) => a.name === "id" || a.name.startsWith("data-"));
  return el.tagName.toLowerCase() + attrs.map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join("");
}

export function createWorkspace(root: HTMLElement, deps: WorkspaceDeps): Workspace {
  const s: State = { loading: false, tags: [], config: null, nodes: [], tasks: [], views: [], viewId: null, popover: null, error: null, builtInOpen: false,
    anchor: null, expanded: new Set(), weekStart: null };
  const now = (): Now => {
    if (s.weekStart === null) throw new Error("Week start not read yet: the workspace renders a view only after open()");
    return { today: (deps.today ?? localToday)(), weekStart: s.weekStart };
  };
  let queue: Promise<void> = Promise.resolve();

  const render = (focus?: string) => {
    const doc = root.ownerDocument;
    const active = doc.activeElement && root.contains(doc.activeElement) ? selectorOf(doc.activeElement) : null;
    root.innerHTML = renderWorkspace(s, now);
    const target = focus ?? active;
    if (target) root.querySelector<HTMLElement>(target)?.focus();
  };

  const tagOf = (config: ViewConfig) => validateViewConfig(config, s.tags);

  /** Queues `fn`; an error lands in the visible message, never swallowed. */
  const run = (fn: () => Promise<void> | void, focus?: () => string | undefined) => {
    queue = queue.then(fn).catch((e: unknown) => {
      s.error = e instanceof Error ? e.message : String(e);
    }).then(() => render(focus?.()));
    return queue;
  };

  async function loadData() {
    const config = s.config!;
    const tag = tagOf(config);
    if (tag.builtIn) s.builtInOpen = true; // every tag change passes here
    s.loading = true;
    render();
    try {
      s.nodes = await loadNodes(deps.dq, s.tags, tag, { childTags: config.childTags, zone: deps.zone });
      s.tasks = await loadTasks(deps.dq, s.nodes, deps.zone);
    } finally {
      s.loading = false;
    }
  }

  /** Applies a config change that keeps the loaded nodes valid (dates, done values, filters, kind). */
  const setConfig = (next: ViewConfig) => {
    tagOf(next);
    s.config = next;
  };

  const selectTag = async (tag: TagInfo) => {
    s.config = defaultViewConfig(tag, s.config?.kind);
    s.viewId = null;
    s.nodes = [];
    s.tasks = [];
    await loadData();
  };

  const trigger = (p: Popover) => `[data-control="${p === "views" ? "saved-views" : p === "done" ? "done-values" : p}"]`;
  const firstInPopover = (p: Popover) => `[data-popover="${p}"] ${p === "views" ? "[data-field=view-name]" : p === "done" ? "input" : "[aria-selected=true]"}`;

  async function open() {
    return run(async () => {
      s.loading = true;
      s.popover = null;
      render();
      try {
        s.weekStart = await deps.weekStart();
        s.tags = await loadTagInfos(deps.dq);
      } finally {
        s.loading = false;
      }
      try {
        s.views = await deps.views.list();
      } catch (e) {
        s.error = (e as Error).message;
      }
      if (s.config) {
        try {
          tagOf(s.config);
        } catch (e) {
          s.error = `${(e as Error).message}. Showing the default view instead.`;
          s.config = null;
          s.viewId = null;
        }
      }
      if (!s.config) {
        const t = initialTag(s.tags);
        if (!t) return;
        s.config = defaultViewConfig(t);
      }
      await loadData();
    });
  }

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    // A click outside the open popover's anchor closes it (and still does what it was meant to do).
    if (s.popover && !t.closest(".pl-anchor")) {
      s.popover = null;
      if (!t.closest("button, input, label")) return void run(() => {});
    }
    const tl = timelineAction(t);
    if (tl) return void timeline(tl, (e as MouseEvent).shiftKey);
    const ctl = t.closest<HTMLElement>("[data-control]");
    if (ctl && ctl.tagName === "BUTTON") {
      const p = ({ tag: "tag", start: "start", end: "end", "done-values": "done", "saved-views": "views" } as const)[ctl.dataset.control as string];
      if (p) {
        s.popover = s.popover === p ? null : p;
        return void run(() => {}, () => (s.popover ? firstInPopover(s.popover) : trigger(p)));
      }
    }
    const opt = t.closest<HTMLElement>("[data-popover] [data-option]");
    if (opt && s.popover) {
      const p = s.popover;
      const value = opt.dataset.option!;
      s.popover = null;
      if (p === "tag") return void run(() => selectTag(s.tags.find((x) => x.ident === value)!), () => trigger("tag"));
      if (p === "start") return void run(() => setConfig({ ...s.config!, start: value }), () => trigger("start"));
      if (p === "end") return void run(() => setConfig({ ...s.config!, end: value || null }), () => trigger("end"));
    }
    const el = t.closest<HTMLElement>("[data-tag-id], [data-view-kind], [data-view-open], [data-view-delete], [data-action]");
    if (!el) return;
    const d = el.dataset;
    if (d.tagId) return void run(() => selectTag(s.tags.find((x) => x.id === Number(d.tagId))!));
    if (d.viewKind) return void run(() => setConfig(switchKind(s.config!, tagOf(s.config!), d.viewKind as ViewKind)));
    if (d.viewOpen) {
      return void run(async () => {
        const v = s.views.find((x) => x.id === d.viewOpen)!;
        tagOf(v.config); // throws before anything changes
        s.popover = null;
        s.config = v.config;
        s.viewId = v.id;
        await loadData();
      }, () => trigger("views"));
    }
    if (d.viewDelete) {
      return void run(() => viewsWrite(() => deps.views.remove(d.viewDelete!)), () => "[data-field=view-name]");
    }
    switch (d.action) {
      case "close":
        s.popover = null;
        render();
        return deps.onClose();
      case "toggle-built-in":
        return void run(() => void (s.builtInOpen = !s.builtInOpen));
      case "dismiss-error":
        return void run(() => void (s.error = null));
      case "clear-filters":
        return void run(() => setConfig({ ...s.config!, filters: {} }));
      case "save-view":
        return void save();
    }
  });

  /** Timeline controls: zoom is view config (saved with a view); the anchor and expanded rows are session state. */
  function timeline(a: NonNullable<ReturnType<typeof timelineAction>>, shift: boolean) {
    const c = s.config!;
    if (c.kind !== "timeline") throw new Error(`Timeline control in a ${c.kind} view`);
    switch (a.type) {
      case "open":
        return deps.openNode(a.uuid, { sidebar: shift });
      case "zoom":
        return void run(() => setConfig({ ...c, zoom: a.zoom }));
      case "nav":
        return void run(() => void (s.anchor = shiftAnchor(s.anchor ?? now().today, c.zoom, a.dir)));
      case "today":
        return void run(() => void (s.anchor = null));
      case "toggle":
        return void run(() => void (s.expanded.has(a.nodeId) ? s.expanded.delete(a.nodeId) : s.expanded.add(a.nodeId)));
    }
  }

  const save = () => {
    const name = root.querySelector<HTMLInputElement>("[data-field=view-name]")!.value;
    return run(() => viewsWrite(async () => {
      s.viewId = (await deps.views.create(name, s.config!)).id;
      s.popover = null;
    }), () => trigger("views"));
  };

  /**
   * A saved-views write, then the list re-read from the store whether it worked or not: a failed write can drop
   * views from the store (their page went to Recycle, T07 D5), and the list must not keep showing them.
   * The write's error is the one shown.
   */
  async function viewsWrite(write: () => Promise<void>) {
    try {
      await write();
    } finally {
      s.views = await deps.views.list().catch(() => s.views);
      if (!s.views.some((v) => v.id === s.viewId)) s.viewId = null;
    }
  }

  root.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && t.dataset.field === "view-name") {
      e.preventDefault();
      void save();
    }
    // Arrow keys move between the options of an open listbox.
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && t.closest("[role=listbox]")) {
      e.preventDefault();
      const items = [...t.closest("[role=listbox]")!.querySelectorAll<HTMLElement>("[role=option]")];
      const i = items.indexOf(t);
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });

  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    const d = t.dataset;
    if (d.control === "child-tags") {
      return void run(async () => {
        s.config = { ...s.config!, childTags: t.checked };
        await loadData();
      });
    }
    if (d.filterProp) {
      const value = d.filterValue || null;
      return void run(() => {
        const filters = { ...s.config!.filters };
        const next = toggle(filters[d.filterProp!] ?? [], value);
        if (next.length) filters[d.filterProp!] = next;
        else delete filters[d.filterProp!];
        setConfig({ ...s.config!, filters });
      });
    }
    if (d.doneProp) {
      return void run(() => {
        const prop = tagOf(s.config!).choiceProps.find((p) => p.ident === d.doneProp)!;
        setConfig({ ...s.config!, doneValues: { ...s.config!.doneValues, [prop.ident]: toggle(doneUuids(s.config!, prop), d.doneValue!) } });
      });
    }
  });

  render();
  return {
    open,
    escape() {
      if (!s.popover) return false;
      const p = s.popover;
      s.popover = null;
      render(trigger(p));
      return true;
    },
    idle: () => queue,
    config: () => s.config,
  };
}
