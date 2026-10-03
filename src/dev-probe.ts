/// <reference types="@logseq/libs" />
// Dev-only probe hook (T01). Loaded from index.ts behind `import.meta.env.DEV`, so Vite drops it
// from the production bundle. It lets `scripts/probe.mjs` (running in the host page through
// playwright-cli) call the real SDK from inside the plugin iframe and record raw results, and
// collect `DB.onChanged` payloads exactly as the plugin receives them.
//
// Protocol (window.postMessage, host -> iframe):
//   { plannerProbe: id, op: "call", ns: "Editor" | "DB" | "App" | …, fn, args }
//   { plannerProbe: id, op: "listen" }   start (or restart) collecting DB.onChanged payloads
//   { plannerProbe: id, op: "events" }   return and clear the collected payloads
//   { plannerProbe: id, op: "timings" }  return window.__plannerTimings (src/dev-timings.ts)
// Reply (iframe -> host): { plannerProbeReply: id, ok, detail }

type Request = { plannerProbe: number; op: "call" | "listen" | "events" | "timings"; ns?: string; fn?: string; args?: unknown[] };

// The one untyped SDK access in the repo: the probe calls SDK methods by name.
const sdk = logseq as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>;

/** Structured-clone safe copy (drops functions, keeps the JSON the plugin would see). */
const plain = (x: unknown): unknown => (x === undefined ? null : JSON.parse(JSON.stringify(x)));

export function installProbeHook(): void {
  const events: unknown[] = [];
  let off: (() => void) | null = null;

  window.addEventListener("message", async (e: MessageEvent) => {
    const m = e.data as Request;
    if (!m || typeof m.plannerProbe !== "number") return;
    const reply = (ok: boolean, detail: unknown) =>
      window.parent.postMessage({ plannerProbeReply: m.plannerProbe, ok, detail: plain(detail) }, "*");
    try {
      if (m.op === "call") reply(true, await sdk[m.ns!][m.fn!](...(m.args ?? [])));
      else if (m.op === "listen") {
        off?.();
        events.length = 0;
        off = logseq.DB.onChanged((payload) => void events.push({ receivedAt: Date.now(), payload: plain(payload) }));
        reply(true, "listening");
      } else if (m.op === "events") reply(true, events.splice(0));
      else reply(false, `unknown op ${String(m.op)}`);
    } catch (err) {
      // The host rejects with plain objects as well as Errors; keep whatever it sent.
      reply(false, err instanceof Error ? err.message : err);
    }
  });
}
