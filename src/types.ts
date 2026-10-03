// Shared types. No SDK import and no runtime code.

/** The SDK calls `registerApp` needs; `src/sdk.ts` supplies the real ones, tests pass fakes. */
export interface AppDeps {
  registerUIItem(type: "toolbar", item: { key: string; template: string }): void;
  registerCommandPalette(command: { key: string; label: string }, action: () => void): void;
  provideModel(model: Record<string, () => void>): void;
  showMainUI(): void;
  hideMainUI(): void;
  /** Runs `fn` after `main()` returns, so registrations do not delay the ready handshake (gotcha §18). */
  defer(fn: () => void): void;
}
