// Shared types. No SDK import and no runtime code.

/** The SDK calls `registerApp` needs; `src/sdk.ts` supplies the real ones, tests pass fakes. */
export interface AppDeps {
  registerUIItem(type: "toolbar", item: { key: string; template: string }): void;
  registerCommandPalette(command: { key: string; label: string }, action: () => void): void;
  provideModel(model: Record<string, () => void>): void;
  showMainUI(): void;
  hideMainUI(): void;
  theme: ThemeDeps;
  /** Runs `fn` after `main()` returns, so registrations do not delay the ready handshake (gotcha §18). */
  defer(fn: () => void): void;
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
