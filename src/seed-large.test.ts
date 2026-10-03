import { describe, expect, it } from "vitest";
import { buildLargeSeed, LARGE_PAGE, LARGE_TAG, seedLargeEdn } from "../scripts/seed-large.edn.mjs";

const TODAY = new Date(2026, 9, 3, 12, 0, 0);
const dayNumber = (n: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};
const toDate = (j: number) => new Date(Math.floor(j / 10000), Math.floor((j % 10000) / 100) - 1, j % 100, 12);
const offsetOf = (j: number) => Math.round((toDate(j).getTime() - TODAY.getTime()) / 86_400_000);

/** Strings aside, every ( [ { has its closer in order. */
function balanced(edn: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (let i = 0; i < edn.length; i++) {
    const c = edn[i]!;
    if (c === '"') {
      for (i++; edn[i] !== '"'; i++) if (edn[i] === "\\") i++;
    } else if ("([{".includes(c)) stack.push(c);
    else if (c in pairs && stack.pop() !== pairs[c]) return false;
  }
  return stack.length === 0;
}

describe("large seed generator", () => {
  const seed = buildLargeSeed({ n: 2000, today: TODAY });

  it("builds N nodes and tasks linked to about a third of them", () => {
    expect(seed.nodes).toHaveLength(2000);
    const linked = new Set(seed.tasks.map((t) => t.node));
    expect(linked.size).toBeGreaterThan(550);
    expect(linked.size).toBeLessThan(780);
    const per = new Map<string, number>();
    for (const t of seed.tasks) per.set(t.node, (per.get(t.node) ?? 0) + 1);
    expect(Math.max(...per.values())).toBe(5);
    expect(Math.min(...per.values())).toBe(1);
  });

  it("is deterministic for a seed and differs for another", () => {
    expect(seedLargeEdn({ n: 300, today: TODAY, seed: 7 })).toBe(seedLargeEdn({ n: 300, today: TODAY, seed: 7 }));
    expect(seedLargeEdn({ n: 300, today: TODAY, seed: 7 })).not.toBe(seedLargeEdn({ n: 300, today: TODAY, seed: 8 }));
  });

  it("mixes dated, one-date and undated nodes", () => {
    const share = (f: (n: (typeof seed.nodes)[number]) => boolean) => seed.nodes.filter(f).length / seed.nodes.length;
    expect(share((n) => n.start !== null && n.end !== null)).toBeGreaterThan(0.65);
    expect(share((n) => n.start !== null && n.end !== null)).toBeLessThan(0.75);
    expect(share((n) => (n.start === null) !== (n.end === null))).toBeGreaterThan(0.1);
    expect(share((n) => (n.start === null) !== (n.end === null))).toBeLessThan(0.2);
    expect(share((n) => n.start === null && n.end === null)).toBeGreaterThan(0.1);
    expect(share((n) => n.start === null && n.end === null)).toBeLessThan(0.2);
  });

  it("spreads starts over +-9 months with spans of 1 to 60 days", () => {
    const spans = seed.nodes.filter((n) => n.start !== null && n.end !== null);
    const starts = spans.map((n) => offsetOf(n.start!));
    expect(Math.min(...starts)).toBeLessThan(-250);
    expect(Math.max(...starts)).toBeGreaterThan(250);
    expect(starts.filter((o) => o < 0).length / starts.length).toBeGreaterThan(0.4);
    for (const n of spans) {
      const span = offsetOf(n.end!) - offsetOf(n.start!);
      expect(span).toBeGreaterThanOrEqual(1);
      expect(span).toBeLessThanOrEqual(60);
    }
    expect(dayNumber(0)).toBe(20261003);
  });

  it("covers every status and choice value, and has open overdue tasks", () => {
    expect(new Set(seed.nodes.map((n) => n.status)).size).toBe(6);
    expect(new Set(seed.nodes.map((n) => n.lead)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(seed.nodes.map((n) => n.team)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(seed.tasks.map((t) => t.status)).size).toBe(6);
    const overdue = seed.tasks.filter((t) => t.deadlineOffset !== null && t.deadlineOffset < 0 && !["done", "canceled"].includes(t.status));
    expect(overdue.length).toBeGreaterThan(100);
    expect(seed.tasks.filter((t) => t.deadlineOffset !== null).length).toBeGreaterThan(seed.tasks.length / 3);
  });

  it("declares a journal page for every Date value and gives every closed value a uuid", () => {
    const edn = seed.edn;
    const used = new Set(seed.nodes.flatMap((n) => [n.start, n.end]).filter((j) => j !== null));
    for (const j of used) expect(edn).toContain(`{:page {:build/journal ${j}}}`);
    const closed = [...edn.matchAll(/\{:value "[^"]+"[^}]*\}/g)].map((m) => m[0]);
    expect(closed).toHaveLength(6 + 4);
    for (const c of closed) expect(c).toMatch(/:uuid #uuid "[0-9a-f-]{36}"/);
  });

  it("builds a new tag on its own page, with valid EDN and unique uuids", () => {
    expect(seed.edn).toContain(`:block/title "${LARGE_TAG}"`);
    expect(seed.edn).toContain(`{:block/title "${LARGE_PAGE}"}`);
    expect(LARGE_TAG).toBe("Load item");
    expect(balanced(seed.edn)).toBe(true);
    expect(seed.edn).not.toMatch(/[^\x20-\x7e\n]/);
    const uuids = [...seed.edn.matchAll(/:block\/uuid #uuid "([^"]+)"/g)].map((m) => m[1]);
    expect(uuids).toHaveLength(2000 + seed.tasks.length);
    expect(new Set(uuids).size).toBe(uuids.length);
  });

  it("keeps the N = 2000 string at a size one import can take", () => {
    expect(seed.edn.length).toBeLessThan(2_000_000);
  });
});
