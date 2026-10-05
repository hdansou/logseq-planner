// Per-graph UI state (N21): what Planner looked like when it was last used on a graph, so the next session opens the
// same way. Kept in the plugin's settings under one key per graph (`uiStateDeps()` in src/sdk.ts), so it is per device
// and never written into the graph. Best effort: nothing here may fail the workspace.
import type { Surface } from "./types";

export interface UiPrefs {
  /** The side panel, per width mode (N13). */
  panel: { wide: boolean; narrow: boolean };
  /** The surface last picked (N06a); null = never picked on this graph. */
  surface: Surface | null;
  /** The Timeline's Edit dates toggle (N06c). */
  editDates: boolean;
  /** The view on screen: its settings as `serializeViewConfig` writes them, and the saved view they belong to. */
  view: { id: string | null; config: string } | null;
}

export const DEFAULT_PREFS: UiPrefs = { panel: { wide: true, narrow: false }, surface: null, editDates: false, view: null };

/** The SDK calls behind the store; `src/sdk.ts` supplies the real ones, tests pass fakes. */
export interface UiStateDeps {
  /** A stable key of the open graph; null when there is none. */
  graph(): Promise<string | null>;
  /** Everything stored: one prefs object per graph key. */
  read(): unknown;
  /** Stores one graph's prefs, leaving the other graphs as they are. */
  write(graph: string, prefs: UiPrefs): void | Promise<void>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Stored prefs → `UiPrefs`: every well-formed part is kept, anything else gets its default. Never throws. */
export function parsePrefs(raw: unknown): UiPrefs {
  if (!isObject(raw)) return { ...DEFAULT_PREFS, panel: { ...DEFAULT_PREFS.panel } };
  const panel = isObject(raw.panel) ? raw.panel : {};
  const view = isObject(raw.view) && typeof raw.view.config === "string"
    ? { id: typeof raw.view.id === "string" ? raw.view.id : null, config: raw.view.config }
    : null;
  return {
    panel: {
      wide: typeof panel.wide === "boolean" ? panel.wide : DEFAULT_PREFS.panel.wide,
      narrow: typeof panel.narrow === "boolean" ? panel.narrow : DEFAULT_PREFS.panel.narrow,
    },
    surface: raw.surface === "workspace" || raw.surface === "sidebar" ? raw.surface : null,
    editDates: raw.editDates === true,
    view,
  };
}

export type UiStore = ReturnType<typeof createUiStore>;

export function createUiStore(deps: UiStateDeps) {
  /** The graph the last `load` was for: `save` writes there. */
  let key: string | null = null;
  return {
    /** The open graph's prefs (the defaults when it has none or they cannot be read). Call on every first load of a graph. */
    async load(): Promise<UiPrefs> {
      key = null;
      try {
        key = await deps.graph();
        const all = deps.read();
        return parsePrefs(key !== null && isObject(all) ? all[key] : undefined);
      } catch {
        return parsePrefs(undefined);
      }
    },
    /** Stores the prefs of the graph last loaded; nothing before a load or without a graph. A failed write is dropped. */
    save(prefs: UiPrefs): void {
      if (key === null) return;
      try {
        void Promise.resolve(deps.write(key, prefs)).catch(() => {});
      } catch {
        // best effort: the state is still right for this session
      }
    },
  };
}
