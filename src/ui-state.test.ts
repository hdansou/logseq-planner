import { describe, expect, it, vi } from "vitest";
import { createUiStore, DEFAULT_PREFS, graphStateText, parseGraphState, parsePrefs, type GraphStateDeps, type UiPrefs, type UiStateDeps } from "./ui-state";

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

describe("state held in the graph (N41)", () => {
  const GRAPH_PREFS = { view: { id: "gv", config: '{"v":1,"config":"graph"}' }, labelWidth: 410 };
  /** A fake graph property: its text, or null when never written. */
  function fakeGraph(text: string | null = null) {
    const state = { text };
    const deps: GraphStateDeps = {
      read: vi.fn(async () => state.text),
      write: vi.fn(async (t: string) => void (state.text = t)),
    };
    return { deps, state };
  }
  const settled = () => new Promise((r) => setTimeout(r, 0));

  it("holds only the view and the title width, as versioned JSON", () => {
    const text = graphStateText({ ...PREFS, ...GRAPH_PREFS });
    expect(JSON.parse(text)).toEqual({ v: 1, ...GRAPH_PREFS });
    expect(parseGraphState(text)).toEqual(GRAPH_PREFS);
  });

  it("reads tolerantly: nothing, bad JSON, another version or wrong fields give nothing or only the good part", () => {
    expect(parseGraphState(null)).toBeNull();
    expect(parseGraphState("not json")).toBeNull();
    expect(parseGraphState('{"v":2,"labelWidth":300}')).toBeNull();
    expect(parseGraphState('{"v":1,"labelWidth":"wide","view":{"id":3,"config":"c"}}')).toEqual({ labelWidth: null, view: { id: null, config: "c" } });
    expect(parseGraphState('{"v":1,"labelWidth":9000}')!.labelWidth).toBe(640);
  });

  it("load: the graph's view and width win over this device's; panel, surface and Edit dates stay this device's", async () => {
    const { deps } = fakeDeps("g1", { g1: PREFS });
    const graph = fakeGraph(graphStateText({ ...DEFAULT_PREFS, ...GRAPH_PREFS }));
    expect(await createUiStore(deps, graph.deps).load()).toEqual({ ...PREFS, ...GRAPH_PREFS });
  });

  it("load: a graph with no stored state falls back to this device's view and width; an unreadable one too", async () => {
    const { deps } = fakeDeps("g1", { g1: PREFS });
    expect(await createUiStore(deps, fakeGraph(null).deps).load()).toEqual(PREFS);
    const broken: GraphStateDeps = { read: async () => { throw new Error("no page"); }, write: vi.fn() };
    expect(await createUiStore(deps, broken).load()).toEqual(PREFS);
  });

  it("save: writes the graph only when the view or width changed, and still saves the device", async () => {
    const { deps } = fakeDeps("g1", { g1: PREFS });
    const graph = fakeGraph(graphStateText({ ...DEFAULT_PREFS, ...GRAPH_PREFS }));
    const store = createUiStore(deps, graph.deps);
    const loaded = await store.load();
    store.save({ ...loaded, editDates: false });
    await settled();
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(graph.deps.write).not.toHaveBeenCalled();
    store.save({ ...loaded, labelWidth: 500 });
    await settled();
    expect(JSON.parse(graph.state.text!)).toEqual({ v: 1, view: GRAPH_PREFS.view, labelWidth: 500 });
  });

  it("save: one write at a time, the latest state wins, and a failed write does not stop the next", async () => {
    const { deps } = fakeDeps("g1", {});
    let release!: () => void;
    const texts: string[] = [];
    let calls = 0;
    const graph: GraphStateDeps = {
      read: async () => null,
      write: vi.fn(async (t: string) => {
        calls++;
        if (calls === 1) await new Promise<void>((r) => (release = r));
        if (calls === 2) throw new Error("page in Recycle");
        texts.push(t);
      }),
    };
    const store = createUiStore(deps, graph);
    await store.load();
    store.save({ ...DEFAULT_PREFS, labelWidth: 200 });
    store.save({ ...DEFAULT_PREFS, labelWidth: 300 });
    store.save({ ...DEFAULT_PREFS, labelWidth: 400 });
    expect(graph.write).toHaveBeenCalledTimes(1); // the others wait
    release();
    await settled(); await settled();
    expect(graph.write).toHaveBeenCalledTimes(2); // 200 done, then 400 (300 was replaced), which failed
    store.save({ ...DEFAULT_PREFS, labelWidth: 500 });
    await settled();
    expect(JSON.parse(texts[texts.length - 1]).labelWidth).toBe(500);
  });

  it("without graph deps the store is as before", async () => {
    const { deps } = fakeDeps("g1", { g1: PREFS });
    expect(await createUiStore(deps).load()).toEqual(PREFS);
  });
});
