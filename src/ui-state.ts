// Per-graph UI state (N21): what Planner looked like when it was last used on a graph, so the next session opens the
// same way. Kept in the plugin's settings under one key per graph (`uiStateDeps()` in src/sdk.ts), so it is per device
// and never written into the graph. Best effort: nothing here may fail the workspace.
import { clampLabelWidth } from "./core/timeline-layout";
import type { Surface } from "./types";

export interface UiPrefs {
  /** The side panel, per width mode (N13). */
  panel: { wide: boolean; narrow: boolean };
  /** The surface last picked (N06a); null = never picked on this graph. */
  surface: Surface | null;
  /** The Timeline's Edit dates toggle (N06c). */
  editDates: boolean;
  /** The Timeline's title column width in px (N36); null = the default. */
  labelWidth: number | null;
  /** The view on screen: its settings as `serializeViewConfig` writes them, and the saved view they belong to. */
  view: { id: string | null; config: string } | null;
}

export const DEFAULT_PREFS: UiPrefs = { panel: { wide: true, narrow: false }, surface: null, editDates: false, labelWidth: null, view: null };

/** The SDK calls behind the store; `src/sdk.ts` supplies the real ones, tests pass fakes. */
export interface UiStateDeps {
  /** A stable key of the open graph; null when there is none. */
  graph(): Promise<string | null>;
  /** Everything stored: one prefs object per graph key. */
  read(): unknown;
  /** Stores one graph's prefs, leaving the other graphs as they are. */
  write(graph: string, prefs: UiPrefs): void | Promise<void>;
}

/**
 * N41: the part of the state that follows the graph (the view on screen and the title column width), kept in a hidden
 * property of the "Planner views" page. The rest (panel, surface, Edit dates) depends on the device and stays in settings.
 */
export interface GraphStateDeps {
  /** The stored text, or null when the graph has none (no page, no property). */
  read(): Promise<string | null>;
  /** Stores the text, creating the page and the property when needed, and reads it back; rejects when it differs. */
  write(text: string): Promise<void>;
}

type GraphState = Pick<UiPrefs, "view" | "labelWidth">;

export const graphStateText = (p: UiPrefs): string => JSON.stringify({ v: 1, view: p.view, labelWidth: p.labelWidth });

/** Stored graph text → the state it holds; null for no text, bad JSON or another version. Never throws. */
export function parseGraphState(text: string | null): GraphState | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.v !== 1) return null;
  const { view, labelWidth } = parsePrefs({ view: raw.view, labelWidth: raw.labelWidth });
  return { view, labelWidth };
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
    labelWidth: typeof raw.labelWidth === "number" && Number.isFinite(raw.labelWidth) ? clampLabelWidth(raw.labelWidth) : null,
    view,
  };
}

export type UiStore = ReturnType<typeof createUiStore>;

export function createUiStore(deps: UiStateDeps, graph?: GraphStateDeps) {
  /** The graph the last `load` was for: `save` writes there. */
  let key: string | null = null;
  /** The graph text last read or handed to a write; a save writes the graph only when its text differs. */
  let graphText = "";
  let waiting: string | null = null;
  let writing = false;
  /** Writes the latest waiting text, one at a time; a failed write is dropped and the next save tries again. */
  const flush = async () => {
    if (writing || !graph) return;
    writing = true;
    while (waiting !== null) {
      const text = waiting;
      waiting = null;
      try {
        await graph.write(text);
      } catch {
        // best effort: the device copy still has the state
      }
    }
    writing = false;
  };
  return {
    /** The open graph's prefs (the defaults when it has none or they cannot be read). Call on every first load of a graph. */
    async load(): Promise<UiPrefs> {
      key = null;
      try {
        key = await deps.graph();
        const all = deps.read();
        const prefs = parsePrefs(key !== null && isObject(all) ? all[key] : undefined);
        if (graph) {
          try {
            Object.assign(prefs, parseGraphState(await graph.read())); // the graph's view and width win over this device's
          } catch {
            // no page or no property: this device's copy
          }
          graphText = graphStateText(prefs);
        }
        return prefs;
      } catch {
        return parsePrefs(undefined);
      }
    },
    /** Stores the prefs of the graph last loaded; nothing before a load or without a graph. A failed write is dropped. */
    save(prefs: UiPrefs): void {
      if (key === null) return;
      if (graph && graphStateText(prefs) !== graphText) {
        graphText = graphStateText(prefs);
        waiting = graphText;
        void flush();
      }
      try {
        void Promise.resolve(deps.write(key, prefs)).catch(() => {});
      } catch {
        // best effort: the state is still right for this session
      }
    },
  };
}
