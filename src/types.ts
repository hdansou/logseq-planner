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
  getUserConfigs(): Promise<{ preferredThemeMode?: string } | undefined>;
  resolveThemeCssPropsVals(names: string[]): Promise<Record<string, string | undefined> | null | undefined>;
  onThemeModeChanged(cb: (e: { mode: string }) => void): void;
  onThemeChanged(cb: () => void): void;
}
