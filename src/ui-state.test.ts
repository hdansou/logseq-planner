import { describe, expect, it, vi } from "vitest";
import { createUiStore, DEFAULT_PREFS, parsePrefs, type UiPrefs, type UiStateDeps } from "./ui-state";

const PREFS: UiPrefs = { panel: { wide: false, narrow: true }, surface: "sidebar", editDates: true, labelWidth: 300, view: { id: "v1", config: '{"v":1}' } };

/** A fake settings store: one prefs object per graph key. */
function fakeDeps(graph: string | null, stored: Record<string, unknown> = {}) {
  const state = { graph, stored };
  const deps: UiStateDeps = {
    graph: vi.fn(async () => state.graph),
    read: vi.fn(() => state.stored),
    write: vi.fn((key: string, prefs: UiPrefs) => void (state.stored = { ...state.stored, [key]: prefs })),
  };
  return { deps, state };
}

describe("parsePrefs", () => {
  it("gives the defaults for nothing or for garbage", () => {
    for (const raw of [undefined, null, 3, "x", [], {}]) expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ panel: { wide: true, narrow: false }, surface: null, editDates: false, labelWidth: null, view: null });
  });
  it("reads a stored object back", () => {
    expect(parsePrefs(JSON.parse(JSON.stringify(PREFS)))).toEqual(PREFS);
  });
  it("keeps each well-formed part and defaults the rest", () => {
    expect(parsePrefs({ panel: { wide: false }, surface: "floating", editDates: "yes", view: { id: 3, config: "c" } }))
      .toEqual({ panel: { wide: false, narrow: false }, surface: null, editDates: false, labelWidth: null, view: { id: null, config: "c" } });
    expect(parsePrefs({ view: { id: "v1" } }).view).toBeNull(); // no config: no view
  });
});

describe("createUiStore", () => {
  it("loads the current graph's state, the defaults when it has none", async () => {
    const { deps } = fakeDeps("g1", { g1: PREFS, g2: { editDates: true } });
    expect(await createUiStore(deps).load()).toEqual(PREFS);
    expect(await createUiStore(fakeDeps("g3", { g1: PREFS }).deps).load()).toEqual(DEFAULT_PREFS);
    expect(await createUiStore(fakeDeps("g1", undefined as never).deps).load()).toEqual(DEFAULT_PREFS);
  });
  it("saves under the graph it loaded, and leaves the other graphs alone", async () => {
    const { deps, state } = fakeDeps("g1", { g2: PREFS });
    const store = createUiStore(deps);
    await store.load();
    store.save({ ...DEFAULT_PREFS, editDates: true });
    expect(deps.write).toHaveBeenCalledWith("g1", { ...DEFAULT_PREFS, editDates: true });
    expect(state.stored.g2).toEqual(PREFS);
  });
  it("follows a graph switch on the next load", async () => {
    const { deps, state } = fakeDeps("g1", { g2: PREFS });
    const store = createUiStore(deps);
    await store.load();
    state.graph = "g2";
    expect(await store.load()).toEqual(PREFS);
    store.save(DEFAULT_PREFS);
    expect(deps.write).toHaveBeenLastCalledWith("g2", DEFAULT_PREFS);
  });
  it("writes nothing before a load, or without a graph", async () => {
    const { deps } = fakeDeps(null);
    const store = createUiStore(deps);
    store.save(PREFS);
    expect(await store.load()).toEqual(DEFAULT_PREFS);
    store.save(PREFS);
    expect(deps.write).not.toHaveBeenCalled();
  });
  it("never fails the caller: a graph lookup, a read or a write that throws means the defaults, or nothing saved", async () => {
    const broken: UiStateDeps = { graph: async () => { throw new Error("no graph"); }, read: () => ({}), write: vi.fn() };
    expect(await createUiStore(broken).load()).toEqual(DEFAULT_PREFS);
    const unreadable: UiStateDeps = { graph: async () => "g1", read: () => { throw new Error("no settings"); }, write: vi.fn() };
    expect(await createUiStore(unreadable).load()).toEqual(DEFAULT_PREFS);
    for (const write of [() => { throw new Error("disk"); }, async () => { throw new Error("disk"); }]) {
      const store = createUiStore({ graph: async () => "g1", read: () => ({}), write });
      await store.load();
      expect(() => store.save(PREFS)).not.toThrow();
      await Promise.resolve();
    }
  });
});

describe("labelWidth (N36)", () => {
  it("is kept within the range a drag may set, and null otherwise", () => {
    expect(parsePrefs({ labelWidth: 300 }).labelWidth).toBe(300);
    expect(parsePrefs({ labelWidth: 5000 }).labelWidth).toBe(640);
    expect(parsePrefs({ labelWidth: 10 }).labelWidth).toBe(160);
    expect(parsePrefs({ labelWidth: "wide" }).labelWidth).toBeNull();
    expect(parsePrefs({ labelWidth: NaN }).labelWidth).toBeNull();
  });
});
