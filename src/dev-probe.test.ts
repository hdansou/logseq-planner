// @vitest-environment happy-dom
// The dev-only probe hook (src/dev-probe.ts) that scripts/probe.mjs drives from the host page (T14 review).
import { afterEach, describe, expect, it, vi } from "vitest";

/** The `logseq` global the hook calls into (index.ts provides the real one); set before the module loads. */
const host = { App: {} as Record<string, unknown> };
vi.stubGlobal("logseq", host);
const { installProbeHook } = await import("./dev-probe");

afterEach(() => {
  host.App = {};
  delete (window as unknown as Record<string, unknown>).__plannerTimings;
});

/** Posts a probe request as if it came from `source`; resolves with the replies sent to the parent. */
async function ask(data: unknown, source: unknown) {
  const replies: unknown[] = [];
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation((m: unknown) => void replies.push(m));
  window.dispatchEvent(new MessageEvent("message", { data, source: source as Window }));
  await new Promise((r) => setTimeout(r, 0));
  post.mockRestore();
  return replies;
}

describe("probe hook", () => {
  installProbeHook();

  it("op timings returns window.__plannerTimings", async () => {
    (window as unknown as Record<string, unknown>).__plannerTimings = { load: { kind: "load", totalMs: 12 }, refresh: null, history: [] };
    expect(await ask({ plannerProbe: 1, op: "timings" }, window.parent)).toEqual([
      { plannerProbeReply: 1, ok: true, detail: { load: { kind: "load", totalMs: 12 }, refresh: null, history: [] } },
    ]);
  });

  it("ignores a message that does not come from the host page (window.parent)", async () => {
    const call = vi.fn(async () => "called");
    host.App = { call };
    expect(await ask({ plannerProbe: 2, op: "call", ns: "App", fn: "call", args: [] }, null)).toEqual([]);
    expect(call).not.toHaveBeenCalled();
    expect(await ask({ plannerProbe: 3, op: "call", ns: "App", fn: "call", args: [] }, window.parent)).toEqual([{ plannerProbeReply: 3, ok: true, detail: "called" }]);
  });
});
