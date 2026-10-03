// Shared types. No SDK import and no runtime code.

/** The SDK calls `registerApp` needs; `src/sdk.ts` supplies the real ones, tests pass fakes. */
export interface AppDeps {
  registerUIItem(type: "toolbar", item: { key: string; template: string }): void;
  registerCommandPalette(
    command: { key: string; label: string; keybinding?: { binding: string; mode: "global" | "non-editing" | "editing" } },
    action: () => void,
  ): void;
  provideModel(model: Record<string, () => void>): void;
  /** Shows the main UI full-screen (container styled directly, see CLAUDE.md). */
  showMainUI(): void;
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
  /** True on the macOS desktop app, where the full-screen frame covers the window buttons. */
  macWindowButtons: boolean;
  /** `logseq.DB.datascriptQuery` for the loaders (the `Dq` of src/core/schema.ts). */
  dq(query: string, ...inputs: unknown[]): Promise<unknown[]>;
  /** The SDK behind the saved-views store. */
  storage: StorageDeps;
  /** The SDK behind Kanban moves. */
  kanban: KanbanWriteDeps;
  /** The SDK behind live updates (T12). */
  changes: ChangesSdk;
}

/** The SDK and timer calls `createChanges` and `registerApp` need for live updates; `src/sdk.ts` supplies the real ones. */
export interface ChangesSdk {
  /** `DB.onChanged`: the callback gets no data (the payload is unusable, docs/probes.md). Returns the unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** setTimeout that returns its cancel function. */
  later(fn: () => void, ms: number): () => void;
  /** The host's `ui:visible:changed` event: Planner shown or hidden by any means. */
  onVisibleChanged(cb: (visible: boolean) => void): void;
  /** Runs `cb` when the plugin unloads. */
  onUnload(cb: () => void): void;
}

/** The SDK calls `watchTheme` needs; `src/sdk.ts` supplies the real ones, tests pass fakes. */
export interface ThemeDeps {
  /** Runs `fn` after `ms` milliseconds (setTimeout in production). */
  later(fn: () => void, ms: number): void;
  getUserConfigs(): Promise<{ preferredThemeMode?: string } | undefined>;
  resolveThemeCssPropsVals(names: string[]): Promise<Record<string, string | undefined> | null | undefined>;
  onThemeModeChanged(cb: (e: { mode: string }) => void): void;
  onThemeChanged(cb: () => void): void;
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
  /** Date/DateTime values by property ident; a property the node has no value for is absent. */
  dates: Record<string, LocalDate>;
  /** Choice values by property ident; a property the node has no value for is absent. */
  choices: Record<string, ClosedValue>;
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
  /** Ids of the loaded nodes it references (inline `[[uuid]]` refs and node-property links alike). */
  nodeIds: number[];
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
