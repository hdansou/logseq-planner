// Shared types. No SDK import and no runtime code.
import type { HostDocument } from "./ui/host-keys";

/** The SDK calls `registerApp` needs; `src/sdk.ts` supplies the real ones, tests pass fakes. */
export interface AppDeps {
  /** Per-graph UI state in the plugin's settings (N21, `uiStateDeps()` in src/sdk.ts). */
  prefs: import("./ui-state").UiStateDeps;
  /** The part of the UI state that follows the graph (N41): the view on screen and the title column width. */
  graphState: import("./ui-state").GraphStateDeps;
  registerUIItem(type: "toolbar", item: { key: string; template: string }): void;
  registerCommandPalette(
    command: { key: string; label: string; keybinding?: { binding: string; mode: "global" | "non-editing" | "editing" } },
    action: () => void,
  ): void;
  /** Handlers named by `data-on-click`; a handler gets the clicked element's `data-*` attributes (`ModelEvent`). */
  provideModel(model: Record<string, (e: ModelEvent) => void>): void;
  /** `logseq.App.onMacroRendererSlotted`: a `{{renderer …}}` macro was drawn in a page (N06b). */
  onMacroRendererSlotted(cb: (e: MacroSlotEvent) => void): void;
  /** `logseq.provideUI` into a host slot (N06b in-page blocks). */
  provideUI(ui: { key: string; slot: string; reset: true; template: string }): void;
  /** `logseq.provideStyle` with a key: the host keeps one `<style>` per key (N06b in-page blocks). */
  provideStyle(style: { key: string; style: string }): void;
  /** `logseq.Editor.registerSlashCommand` with a callback (the host clears the typed command first). */
  registerSlashCommand(label: string, action: () => void): void;
  /** `logseq.Editor.insertAtEditingCursor`: inserts text at the caret of the block being edited. */
  insertAtCursor(text: string): Promise<void>;
  /**
   * Styles the main-UI container (camelCase keys, written directly with `important` when same-origin, see CLAUDE.md):
   * `WORKSPACE_FRAME`, or `dockFrame(…)` while docked (N40).
   */
  setFrame(style: Frame): void;
  /** Shows the main UI in the frame last set by `setFrame`. */
  showMainUI(): void;
  /** The plugin's id: what the host rule that reserves the docked strip names (`data-pid`, N40). */
  pluginId(): string;
  /** The docked width in px kept in the plugin's settings (per device, N40); null when never set. */
  dockWidth: { read(): number | null; write(px: number): void };
  hideMainUI(): void;
  /** Routes the main area to a node (page or block) by uuid. */
  openPage(uuid: string): void;
  /** Opens a node by uuid in the right sidebar. */
  openInSidebar(uuid: string): void;
  theme: ThemeDeps;
  /** Runs `fn` after `main()` returns, so registrations do not delay the ready handshake (gotcha §18). */
  defer(fn: () => void): void;
  /** Runs `fn` after `ms` milliseconds (setTimeout in production). */
  later(fn: () => void, ms: number): void;
  /** The host's first day of the week (Logseq `preferredStartOfWeek`), 0 = Sunday … 6 = Saturday; throws on an invalid value. */
  weekStart(): Promise<number>;
  /** `logseq.DB.datascriptQuery` for the loaders (the `Dq` of src/core/schema.ts). */
  dq(query: string, ...inputs: unknown[]): Promise<unknown[]>;
  /** The SDK behind the saved-views store. */
  storage: StorageDeps;
  /** The SDK behind Kanban moves. */
  kanban: KanbanWriteDeps;
  /** The SDK behind Timeline date edits (N06c). */
  dates: DateWriteDeps;
  /** The SDK behind live updates (T12). */
  changes: ChangesSdk;
  /** The host's document when the frame is same-origin with it (desktop app), else null (web app, dev server): where unused keys are forwarded (N16). */
  hostDocument(): HostDocument | null;
}

/** What a `data-on-click` model handler receives (the host copies the clicked element's `dataset`, camelCased keys). */
export interface ModelEvent {
  dataset?: Record<string, string | undefined>;
}

/** `onMacroRendererSlotted`'s event: the slot element's id and the macro's arguments (`{{renderer a, b}}` → `["a", "b"]`). */
export interface MacroSlotEvent {
  slot: string;
  payload: { arguments: string[]; uuid: string };
}

/** Where Planner shows (N06a): the workspace under the header, or docked on the window's right edge, beside Logseq's right sidebar (N40). Session state. */
export type Surface = "workspace" | "sidebar";

/** A main-UI container style: CSS properties in camelCase. */
export type Frame = Record<string, string>;

/** The SDK and timer calls `createChanges` and `registerApp` need for live updates; `src/sdk.ts` supplies the real ones. */
export interface ChangesSdk {
  /** `DB.onChanged`: the callback gets no data (the payload is unusable, docs/probes.md). Returns the unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** setTimeout that returns its cancel function. */
  later(fn: () => void, ms: number): () => void;
  /** The host's `ui:visible:changed` event: Planner shown or hidden by any means. Returns the unsubscribe. */
  onVisibleChanged(cb: (visible: boolean) => void): () => void;
  /** `App.onCurrentGraphChanged`: the host opened another graph. Returns the unsubscribe. */
  onGraphChanged(cb: () => void): () => void;
  /** Runs `cb` when the plugin unloads. */
  onUnload(cb: () => void): void;
}

/** The SDK calls `watchTheme` needs; `src/sdk.ts` supplies the real ones, tests pass fakes. */
export interface ThemeDeps {
  /** Runs `fn` after `ms` milliseconds (setTimeout in production). */
  later(fn: () => void, ms: number): void;
  getUserConfigs(): Promise<{ preferredThemeMode?: string } | undefined>;
  resolveThemeCssPropsVals(names: string[]): Promise<Record<string, string | undefined> | null | undefined>;
  /** Returns the unsubscribe (`IUserOffHook`). */
  onThemeModeChanged(cb: (e: { mode: string }) => void): () => void;
  /** Returns the unsubscribe (`IUserOffHook`). */
  onThemeChanged(cb: () => void): () => void;
}

/** A closed value of a choice property (`:block/_closed-value-property` entity). */
export interface ClosedValue {
  id: number;
  uuid: string;
  title: string;
  /** Only built-in values carry one (`:logseq.property.status/…`); user choices have none. */
  ident: string | null;
  /** Fractional-index sort key; values are listed in this order. */
  order: string;
  /** `:logseq.property/choice-checkbox-state`: true = Done, false = Todo, null = no checkbox state. */
  checkbox: boolean | null;
  /** Canceled has no checkbox state; it is recognised by its ident. */
  canceled: boolean;
}

/** A Date or DateTime property available on a tag (own or inherited). */
export interface DateProp {
  id: number;
  ident: string;
  title: string;
  type: "date" | "datetime";
}

/** A property of type `default` with closed values (own or inherited). */
export interface ChoiceProp {
  id: number;
  ident: string;
  title: string;
  values: ClosedValue[];
}

/** A node-typed property available on a tag (own or inherited), any cardinality: its values point at other nodes (N12). */
export interface NodeProp {
  id: number;
  ident: string;
  title: string;
}

/** What a property holds, as far as a card can show it (N42): `choice` = a closed-value property with one value. */
export type FieldType = "choice" | "text" | "number" | "checkbox" | "url" | "node" | "date" | "datetime";

/** Any property of a tag a Kanban card can show (N42): own or inherited, never a hidden one. */
export interface FieldProp {
  id: number;
  ident: string;
  title: string;
  type: FieldType;
  /** More than one value possible (cardinality many). */
  many: boolean;
}

/** One tag with the properties Planner can map, inherited ones included. */
export interface TagInfo {
  id: number;
  uuid: string;
  ident: string;
  title: string;
  /** True for Logseq's own tags (Task, Page, …); false for user tags. */
  builtIn: boolean;
  /** Direct parents via `:logseq.property.class/extends`, Root Tag excluded. */
  parentIds: number[];
  /** Direct children: tags whose `parentIds` contain this id. */
  childIds: number[];
  /** Own properties first, then inherited ones, each ident once. */
  dateProps: DateProp[];
  choiceProps: ChoiceProp[];
  /** Node-typed properties: the choices of the "Depends on" setting (N12). */
  nodeProps: NodeProp[];
  /** Every property a card can show, in the same order (N42). */
  fieldProps: FieldProp[];
}

/** A local calendar day, with the wall-clock time for DateTime values (`time` is null for Date values). */
export interface LocalDate {
  /** `YYYY-MM-DD` in the local zone. */
  day: string;
  /** `HH:MM` in the local zone; only DateTime values have one. */
  time: string | null;
}

/** A node of a tag (or of a tag extending it) with its mapped property values. */
export interface PlannerNode {
  id: number;
  uuid: string;
  title: string;
  /** Ids of the tags the node carries. */
  tagIds: number[];
  /**
   * Ident of the view's tag the node belongs to (N14): the first selected tag, in selection order, that it carries
   * directly or (with child tags on) through a tag extending it. Its Start / End mapping, its Tag filter value and its
   * heading when the Timeline is arranged by tag.
   */
  tag: string;
  /** Date/DateTime values by property ident; a property the node has no value for is absent. */
  dates: Record<string, LocalDate>;
  /** Choice values by property ident; a property the node has no value for is absent. */
  choices: Record<string, ClosedValue>;
  /**
   * The values of the card fields that need their own attribute (N42: text, number, checkbox, url, node / page), by
   * property ident, each as a list (a ref by its title); a property with no value is absent. Only what the view asked for.
   */
  extras?: Record<string, (string | number | boolean)[]>;
  /** Entity ids of the nodes it depends on through the view's dependency property (N12); [] without one. */
  dependsOn: number[];
  /**
   * Entity ids of the other loaded nodes it references (`:block/refs`: inline links and node-property values), except
   * the nodes it depends on through the view's dependency property (N12 rule): its candidate parents for nesting (N14).
   * Pulled only for a view over two or more tags; [] otherwise.
   */
  links: number[];
}

/** The Status of a #Task block, as the query returns it. */
export interface TaskStatus {
  ident: string;
  title: string;
}

/** A #Task block that references at least one loaded node. */
export interface PlannerTask {
  id: number;
  uuid: string;
  title: string;
  /** Null when the block has no Status value. */
  status: TaskStatus | null;
  /**
   * Ids of the loaded nodes it references (inline `[[uuid]]` refs and node-property links alike), except the nodes it
   * depends on through the view's dependency property (N12: a dependent is not a task of its dependency).
   */
  nodeIds: number[];
  /**
   * The block is itself a loaded node of the view (N14: #Task is one of the view's tags): it counts in its nodes'
   * rollups and spans like any linked task, but it is never listed as a task row or entry of another node.
   */
  isNode: boolean;
  /** The task's built-in Deadline (DateTime) as a local date; null when unset. */
  deadline: LocalDate | null;
  /** The task's built-in Scheduled (DateTime) as a local date; null when unset. */
  scheduled: LocalDate | null;
}

/** How a node sits on the time axis. */
export type SpanKind =
  /** Both mapped Start and End. */
  | "mapped"
  /** No mapped date: earliest to latest Scheduled/Deadline of its linked tasks (drawn dashed). */
  | "derived"
  /** One date (mapped): a point; `start` and `end` are equal. */
  | "point"
  /** No date at all: listed apart; `start` and `end` are null. */
  | "undated";

export interface NodeSpan {
  kind: SpanKind;
  start: LocalDate | null;
  end: LocalDate | null;
}

/** Selected choice values by property ident: closed-value ids, `null` = "No value". Absent or empty = no filter. */
export type ChoiceFilters = Record<string, (number | null)[]>;

/** Done / (all − canceled) over a node's tasks. */
export interface Rollup {
  done: number;
  total: number;
}

/** One saved-view block on the plugin page; `config` is null when the block has no config property. */
export interface ViewBlock {
  uuid: string;
  /** The block's text = the view's name. */
  name: string;
  /** The raw config string (hidden property), unparsed. */
  config: string | null;
}

/**
 * The SDK calls `createViewStore` needs; `src/sdk.ts` supplies the real ones, tests pass fakes. The write
 * API resolves null on success and on failure, so the store never trusts a write: it reads back.
 */
export interface StorageDeps {
  /** uuid of the page with exactly this title (strict datascript query), or null. */
  findPage(title: string): Promise<string | null>;
  createPage(title: string): Promise<void>;
  /** Makes sure the hidden string config property exists; called right before every config write. */
  ensureConfigProperty(): Promise<void>;
  /** Top-level blocks of the page, in order, each with its raw config property. */
  listBlocks(pageUuid: string): Promise<ViewBlock[]>;
  /** One block by uuid, or null when it does not exist. */
  readBlock(uuid: string): Promise<ViewBlock | null>;
  /** Appends a block with `name` as text; the new uuid, or null when the SDK returned nothing. */
  appendBlock(pageUuid: string, name: string): Promise<string | null>;
  setConfig(uuid: string, text: string): Promise<void>;
  /** How many tags the block carries (0 for a saved-view block the host did not tag, T14 F3). */
  blockTags(uuid: string): Promise<number>;
  removeBlock(uuid: string): Promise<void>;
}

/**
 * The SDK calls a Kanban move needs; `src/sdk.ts` supplies the real ones, tests pass fakes. Observed live (T01,
 * docs/probes.md): both write calls resolve null on success AND on failure, so every write is read back.
 */
export interface KanbanWriteDeps {
  /** `logseq.Editor.upsertBlockProperty(uuid, key, valueId)`: `key` = full ident without the leading colon, `valueId` = the closed value's entity id. */
  upsertBlockProperty(uuid: string, key: string, valueId: number): Promise<unknown>;
  /** `logseq.Editor.removeBlockProperty(uuid, key)`: `key` = full ident without the leading colon. */
  removeBlockProperty(uuid: string, key: string): Promise<unknown>;
  /**
   * The entity the node's property `ident` (with its leading colon) points at now (`ident` is null for user values), or
   * null when the attribute is absent. After removing a built-in property it can be the empty placeholder (seen live).
   */
  readChoice(uuid: string, ident: string): Promise<{ id: number; ident: string | null } | null>;
}

/**
 * The SDK calls a Timeline date edit needs (N06c); `src/sdk.ts` supplies the real ones, tests pass fakes. Write probe
 * (2026-10-04, desktop app): a DateTime property takes epoch ms and reads back the same number; a Date property takes
 * the db id of the day's journal page (a journal day number, an ISO string or ms are rejected). Every write is read back.
 */
export interface DateWriteDeps {
  /** `logseq.Editor.upsertBlockProperty(uuid, key, value)`: `key` = full ident without the leading colon; `value` = epoch ms (DateTime) or the journal page's db id (Date). */
  upsertBlockProperty(uuid: string, key: string, value: number): Promise<unknown>;
  /**
   * `logseq.Editor.createJournalPage(date)`: the day's journal page, existing or created. Pass local noon
   * (`"YYYY-MM-DDT12:00:00"`): a bare `"YYYY-MM-DD"` lands on the previous day west of UTC (probe). Null when the host
   * returned nothing.
   */
  createJournalPage(date: string): Promise<{ id: number } | null>;
  /**
   * The node's value of the Date or DateTime property `ident` (with its leading colon) now: epoch ms for a DateTime, the
   * journal page's db id and journal day (20261201) for a Date; null when the attribute is absent.
   */
  readDate(uuid: string, ident: string, type: "date" | "datetime"): Promise<number | { id: number; journalDay: number } | null>;
}
