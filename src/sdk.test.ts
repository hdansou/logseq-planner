import { afterEach, describe, expect, it, vi } from "vitest";
import { pageQuery, storageDeps } from "./sdk";

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
