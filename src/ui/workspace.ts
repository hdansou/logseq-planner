// The full-screen workspace shell: top bar (view switch, saved views, Close), settings bar (tag, child tags,
// Start, End, done values), tag tree and choice filters, a per-view toolbar slot and the main area.
// Renders the whole shell from `State` on every change (small pure render functions returning HTML) and
// handles every event by delegation on the root. No SDK: graph access arrives as `WorkspaceDeps`.
import { loadNodes, loadTasks } from "../core/queries";
import { filterNodes, isDone } from "../core/nodes";
import type { ZoneOffset } from "../core/normalize";
import type { Dq } from "../core/schema";
import { loadTagInfos } from "../core/schema";
import { defaultViewConfig, toChoiceFilters, validateViewConfig, VIEW_KINDS, type ViewConfig, type ViewKind } from "../core/view-config";
import type { SavedView, ViewStore } from "../storage";
import type { ChoiceProp, PlannerNode, PlannerTask, TagInfo } from "../types";

export interface WorkspaceDeps {
  dq: Dq;
  views: ViewStore;
  /** Close button: the app hides the main UI. */
  onClose(): void;
  /** Local zone offset for DateTime values; defaults to the machine's. */
  zone?: ZoneOffset;
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
}

const KIND_LABEL: Record<ViewKind, string> = { timeline: "Timeline", calendar: "Calendar", agenda: "Agenda", kanban: "Kanban" };
const KIND_TASK: Record<ViewKind, string> = { timeline: "T08", calendar: "T09", agenda: "T10", kanban: "T11" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const byTitle = (a: TagInfo, b: TagInfo) => a.title.localeCompare(b.title);

// ---------------------------------------------------------------- pure helpers

/** The tag a fresh workspace shows: the first own tag (tree order) with a date property, else the first tag. */
export function initialTag(tags: TagInfo[]): TagInfo | null {
  const ordered = [...tags].sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || byTitle(a, b));
  return ordered.find((t) => !t.builtIn && t.dateProps.length > 0) ?? ordered[0] ?? null;
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
  const roots = s.tags.filter((t) => !t.parentIds.some((id) => byId.has(id))).sort(byTitle);
  const group = (key: string, title: string, list: TagInfo[]) =>
    list.length ? `<h2 class="pl-group-header">${title}</h2><ul class="pl-tree" data-tag-group="${key}">${list.map(item).join("")}</ul>` : "";
  return `<nav aria-label="Tags">${group("own", "Your tags", roots.filter((t) => !t.builtIn))}${group("built-in", "Built-in tags", roots.filter((t) => t.builtIn))}</nav>`;
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

/** The main area: loading, one of the empty states, or the placeholder for the view kind (views land in T08–T11). */
function renderView(s: State, tag: TagInfo | undefined): string {
  if (s.loading) return `<div class="pl-empty" data-region="loading"><span>Loading…</span></div>`;
  if (!s.tags.length) return empty("no-tags", "No tags in this graph", "Create a tag in Logseq (type #Project on a block, for example) and it shows up here.");
  if (!tag || !s.config) return "";
  const name = `#${esc(tag.title)}`;
  if (s.config.kind !== "kanban" && !tag.dateProps.length) {
    return empty("no-dates", `${name} has no date properties`, "Add a Date or DateTime property to the tag in Logseq and pick it as Start or End, or choose another tag.");
  }
  if (!s.nodes.length) return empty("no-nodes", `No ${name} nodes yet`, `Tag a page or block with ${name} and it shows up here.`);
  const shown = filterNodes(s.nodes, toChoiceFilters(s.config, tag));
  if (!shown.length) {
    return empty("no-matches", `No ${name} nodes match the filters`, "Change the filters in the left column.",
      `<button type="button" class="pl-btn" data-action="clear-filters">Clear filters</button>`);
  }
  const kind = KIND_LABEL[s.config.kind];
  return `<div class="pl-placeholder" data-region="view-placeholder"><b>${kind}</b>`
    + `<span>${plural(shown.length, "node")} · ${plural(s.tasks.length, "linked task")}. The ${kind} view arrives in ${KIND_TASK[s.config.kind]}.</span></div>`;
}

function renderWorkspace(s: State): string {
  const tag = s.config ? s.tags.find((t) => t.ident === s.config!.tag) : undefined;
  const error = s.error
    ? `<div class="pl-error" role="alert" data-region="error"><span>${esc(s.error)}</span><button type="button" class="pl-btn" data-action="dismiss-error">Dismiss</button></div>`
    : "";
  const kind = s.config?.kind ?? "";
  return `<div class="pl-ws">${renderTopBar(s)}${error}`
    + (tag ? renderSettings(s, tag) : `<div class="pl-settings" data-region="settings" aria-label="View settings"></div>`)
    + `<div class="pl-body"><aside class="pl-sidebar" data-region="sidebar">${renderTagTree(s, tag?.ident)}${tag ? renderFilters(s, tag) : ""}</aside>`
    + `<main class="pl-main" data-region="main"><div class="pl-view-toolbar" data-region="view-toolbar" data-view-kind="${kind}"></div>`
    + `<div class="pl-view" data-region="view">${renderView(s, tag)}</div></main></div></div>`;
}

// ---------------------------------------------------------------- controller

/** A selector that finds the same control after a re-render: its tag plus every `data-*` and `id` attribute. */
function selectorOf(el: Element): string {
  const attrs = [...el.attributes].filter((a) => a.name === "id" || a.name.startsWith("data-"));
  return el.tagName.toLowerCase() + attrs.map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join("");
}

export function createWorkspace(root: HTMLElement, deps: WorkspaceDeps): Workspace {
  const s: State = { loading: false, tags: [], config: null, nodes: [], tasks: [], views: [], viewId: null, popover: null, error: null };
  let queue: Promise<void> = Promise.resolve();

  const render = (focus?: string) => {
    const doc = root.ownerDocument;
    const active = doc.activeElement && root.contains(doc.activeElement) ? selectorOf(doc.activeElement) : null;
    root.innerHTML = renderWorkspace(s);
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
      return void run(async () => {
        await deps.views.remove(d.viewDelete!);
        s.views = await deps.views.list();
        if (s.viewId === d.viewDelete) s.viewId = null;
      }, () => "[data-field=view-name]");
    }
    switch (d.action) {
      case "close":
        s.popover = null;
        render();
        return deps.onClose();
      case "dismiss-error":
        return void run(() => void (s.error = null));
      case "clear-filters":
        return void run(() => setConfig({ ...s.config!, filters: {} }));
      case "save-view":
        return void save();
    }
  });

  const save = () => {
    const name = root.querySelector<HTMLInputElement>("[data-field=view-name]")!.value;
    return run(async () => {
      const created = await deps.views.create(name, s.config!);
      s.views = await deps.views.list();
      s.viewId = created.id;
      s.popover = null;
    }, () => trigger("views"));
  };

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
