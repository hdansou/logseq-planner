import { describe, expect, it, vi } from "vitest";
import { createStateStore, type ConfigSdk, ensureHiddenProperty, findOrRenamePage } from "./pages";

/** A fake host: pages by title, properties by page uuid, every call recorded. */
function host(initial: Record<string, Record<string, unknown>> = {}, opts: { refuseRename?: boolean; silentWrite?: boolean } = {}) {
  const pages = new Map<string, { uuid: string; props: Record<string, unknown> }>();
  Object.entries(initial).forEach(([title, props], i) => pages.set(title, { uuid: `p${i}`, props: { ...props } }));
  const titleOf = (u: string) => [...pages].find(([, p]) => p.uuid === u)![0];
  const calls: string[] = [];
  const defined: Record<string, unknown> = {};
  const sdk: ConfigSdk = {
    findPage: async (t) => pages.get(t)?.uuid ?? null,
    createPage: async (t) => (calls.push(`create ${t}`), void pages.set(t, { uuid: `p${pages.size}`, props: {} })),
    renamePage: async (u, t) => {
      calls.push(`rename ${titleOf(u)} -> ${t}`);
      if (opts.refuseRename) throw new Error("refused");
      const old = titleOf(u);
      pages.set(t, pages.get(old)!);
      pages.delete(old);
    },
    getProperty: async (k) => defined[k] ?? null,
    upsertProperty: async (k, schema) => (calls.push(`define ${k}`), void (defined[k] = schema)),
    getBlockProperty: async (u, k) => pages.get(titleOf(u))!.props[k] ?? null,
    upsertBlockProperty: async (u, k, v) => (calls.push(`set ${k} on ${titleOf(u)}`), void (!opts.silentWrite && (pages.get(titleOf(u))!.props[k] = v))),
    removeBlockProperty: async (u, k) => (calls.push(`remove ${k} from ${titleOf(u)}`), void delete pages.get(titleOf(u))!.props[k]),
  };
  return { sdk, pages, calls, defined };
}

describe("ensureHiddenProperty", () => {
  it("creates a missing property hidden, only hides an existing visible one, leaves a hidden one alone", async () => {
    const h = host();
    await ensureHiddenProperty(h.sdk, "p-key", "default");
    expect(h.defined["p-key"]).toEqual({ type: "default", hide: true });
    h.defined["q"] = { type: "default", hide: true };
    await ensureHiddenProperty(h.sdk, "q", "default");
    expect(h.calls.filter((c) => c === "define q")).toEqual([]);
    h.defined["r"] = { type: "string", hide: false };
    await ensureHiddenProperty(h.sdk, "r", "default");
    expect(h.defined["r"]).toEqual({ hide: true });
  });
});

describe("findOrRenamePage", () => {
  it("the current title wins and nothing is renamed", async () => {
    const h = host({ "Plugin views: X": {}, "X views": {} });
    expect(await findOrRenamePage(h.sdk, "Plugin views: X", ["X views"])).toBe("p0");
    expect(h.calls).toEqual([]);
  });

  it("a page under an old title is renamed to the current one", async () => {
    const h = host({ "X views": {} });
    expect(await findOrRenamePage(h.sdk, "Plugin views: X", ["X views"])).toBe("p0");
    expect(h.calls).toEqual(["rename X views -> Plugin views: X"]);
  });

  it("when the rename is refused the old page is used as it is", async () => {
    const h = host({ "X views": {} }, { refuseRename: true });
    expect(await findOrRenamePage(h.sdk, "Plugin views: X", ["X views"])).toBe("p0");
  });

  it("no page at all is null", async () => {
    expect(await findOrRenamePage(host().sdk, "Plugin views: X", ["X views"])).toBeNull();
  });
});

describe("createStateStore: machine state on a hidden page", () => {
  const key = "x-ui-state";

  it("writes on the state page, hidden, creating it; reads it back", async () => {
    const h = host();
    const store = createStateStore(h.sdk, { plugin: "X", key });
    await store.write('{"v":1}');
    expect(h.pages.get("Plugin state: X")!.props).toEqual({ [key]: '{"v":1}', ":logseq.property/hide?": true });
    expect(await store.read()).toBe('{"v":1}');
  });

  it("reads nothing, and creates nothing, on a graph with no state", async () => {
    const h = host();
    expect(await createStateStore(h.sdk, { plugin: "X", key }).read()).toBeNull();
    expect(h.calls).toEqual([]);
  });

  it("moves a value an earlier version kept on another page: read falls back, a write removes it there", async () => {
    const h = host({ "X views": { [key]: '{"v":0}' } });
    const store = createStateStore(h.sdk, { plugin: "X", key, legacyPages: ["X views"] });
    expect(await store.read()).toBe('{"v":0}');
    await store.write('{"v":1}');
    expect(h.pages.get("X views")!.props[key]).toBeUndefined();
    expect(await store.read()).toBe('{"v":1}');
  });

  it("throws when the write cannot be read back, and keeps the old copy", async () => {
    const h = host({ "X views": { [key]: "old" } }, { silentWrite: true });
    const store = createStateStore(h.sdk, { plugin: "X", key, legacyPages: ["X views"] });
    await expect(store.write("new")).rejects.toThrow(/read back/);
    expect(h.pages.get("X views")!.props[key]).toBe("old");
  });
});

void vi;
