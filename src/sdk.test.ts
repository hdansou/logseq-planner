import { afterEach, describe, expect, it, vi } from "vitest";
import { hostWeekStart, pageQuery, storageDeps } from "./sdk";

afterEach(() => vi.unstubAllGlobals());

describe("strict views page query", () => {
  it("matches title and Page tag and excludes recycled pages", () => {
    const q = pageQuery('Planner "views"');
    expect(q).toContain('[?p :block/title "Planner \\"views\\""]');
    expect(q).toContain("[?t :db/ident :logseq.class/Page]");
    expect(q).toContain("(not [?p :logseq.property/deleted-at _])");
  });

  it("findPage sends that query and returns null when nothing live matches", async () => {
    const sent: string[] = [];
    vi.stubGlobal("logseq", { DB: { datascriptQuery: async (q: string) => (sent.push(q), []) } });
    expect(await storageDeps().findPage("Planner views")).toBeNull();
    expect(sent[0]).toBe(pageQuery("Planner views"));
  });
});

describe("host week start", () => {
  const configs = (preferredStartOfWeek: unknown) => vi.stubGlobal("logseq", { App: { getUserConfigs: async () => ({ preferredStartOfWeek }) } });

  it("reads preferredStartOfWeek (a number live, default 6 = Sunday) and converts it to 0 = Sunday", async () => {
    configs(6);
    expect(await hostWeekStart()).toBe(0);
    configs(0);
    expect(await hostWeekStart()).toBe(1);
  });

  it("accepts a numeric string", async () => {
    configs("0");
    expect(await hostWeekStart()).toBe(1);
  });

  it("fails fast on a missing or invalid value", async () => {
    configs(undefined);
    await expect(hostWeekStart()).rejects.toThrow(/preferredStartOfWeek/);
    configs("monday");
    await expect(hostWeekStart()).rejects.toThrow(/preferredStartOfWeek/);
  });
});
