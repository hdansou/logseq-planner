import { describe, expect, it } from "vitest";
import { build } from "vite";
import { createTimings, installTimings } from "./dev-timings";

function clock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("timings recorder", () => {
  it("splits a load into query and render time", () => {
    const c = clock();
    const timings = createTimings(c.now);
    timings.begin("load");
    c.advance(40);
    timings.queried();
    c.advance(12);
    timings.rendered("redrawn");
    expect(timings.last().load).toMatchObject({ kind: "load", queryMs: 40, renderMs: 12, totalMs: 52, outcome: "redrawn" });
    expect(timings.last().refresh).toBeNull();
  });

  it("records a refresh apart from the load and keeps a history of both", () => {
    const c = clock();
    const timings = createTimings(c.now);
    timings.begin("load");
    c.advance(5);
    timings.queried();
    timings.rendered("redrawn");
    timings.begin("refresh");
    c.advance(30);
    timings.queried();
    c.advance(8);
    timings.rendered("same");
    const last = timings.last();
    expect(last.refresh).toMatchObject({ kind: "refresh", queryMs: 30, renderMs: 8, totalMs: 38, outcome: "same" });
    expect(last.load?.totalMs).toBe(5);
    expect(last.history.map((m) => m.kind)).toEqual(["load", "refresh"]);
  });

  it("ignores queried / rendered without a begin, and a refresh during a load does not end the load", () => {
    const c = clock();
    const timings = createTimings(c.now);
    timings.queried();
    timings.rendered("redrawn");
    expect(timings.last().history).toEqual([]);
    timings.begin("load");
    timings.begin("refresh");
    c.advance(10);
    timings.queried();
    timings.rendered("deferred"); // closes the most recent kind only: the refresh
    expect(timings.last().refresh?.outcome).toBe("deferred");
    expect(timings.last().load).toBeNull();
  });

  it("keeps the last 50 measurements", () => {
    const timings = createTimings(clock().now);
    for (let i = 0; i < 60; i++) {
      timings.begin("refresh");
      timings.rendered("same");
    }
    expect(timings.last().history).toHaveLength(50);
  });

  it("installs itself on a global the coordinator reads from the plugin iframe", () => {
    const target: Record<string, unknown> = {};
    const timings = installTimings(target);
    timings.begin("load");
    timings.rendered("redrawn");
    expect((target.__plannerTimings as { load: { kind: string } }).load.kind).toBe("load");
  });
});

describe("production bundle", () => {
  it("contains neither the recorder nor its global", async () => {
    // Vitest runs with NODE_ENV=test, which makes import.meta.env.DEV true; `npm run build` runs as production.
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const out = (await build({ logLevel: "silent", mode: "production", build: { write: false, outDir: "dist-timings-test" } }).finally(() => void (process.env.NODE_ENV = env))) as { output: { type: string; code?: string; source?: string }[] }[] | { output: { type: string; code?: string; source?: string }[] };
    const outputs = Array.isArray(out) ? out.flatMap((o) => o.output) : out.output;
    const text = outputs.map((o) => o.code ?? String(o.source ?? "")).join("\n");
    expect(text.length).toBeGreaterThan(10_000); // the build really produced the plugin
    expect(text.includes("__plannerTimings"), "recorder global in the bundle").toBe(false);
    expect(text.includes("plannerProbe"), "probe hook (src/dev-probe.ts message key) in the bundle").toBe(false);
  }, 60_000);
});
