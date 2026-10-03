// Dev-only load and refresh timings (T13). Loaded from index.ts behind `import.meta.env.DEV`, so Vite drops it (and the
// global) from the production bundle (src/dev-timings.test.ts builds and checks). It is a `Timing` for the workspace:
// the first load is split into query time (open → graph reads done) and render time (→ DOM updated); a live refresh is
// measured from the debounced trigger to the DOM update. Read it from the host page: scripts/probe.mjs `--timings`, or
// `frame.evaluate(() => window.__plannerTimings)` inside the plugin iframe. DOM updated = the synchronous render; paint
// and layout after it are not included.
import type { Timing, TimingOutcome } from "./ui/workspace";

type Kind = "load" | "refresh";

export interface Measurement {
  kind: Kind;
  /** `performance.now()` when it began. */
  startedAt: number;
  /** begin → graph reads done (tags, saved views, nodes, tasks, titles). */
  queryMs: number;
  /** reads done → DOM updated. */
  renderMs: number;
  totalMs: number;
  outcome: TimingOutcome;
}

export interface TimingsSnapshot {
  /** The latest load and the latest refresh (null before the first). */
  load: Measurement | null;
  refresh: Measurement | null;
  /** The last 50 measurements, oldest first. */
  history: Measurement[];
}

const HISTORY = 50;

export function createTimings(now: () => number = () => performance.now()): Timing & { last(): TimingsSnapshot } {
  const open = new Map<Kind, { startedAt: number; queriedAt: number | null }>();
  const order: Kind[] = []; // open kinds, most recent last: queried / rendered belong to the latest
  const history: Measurement[] = [];
  const latest: Record<Kind, Measurement | null> = { load: null, refresh: null };

  return {
    begin(kind) {
      open.set(kind, { startedAt: now(), queriedAt: null });
      if (order.includes(kind)) order.splice(order.indexOf(kind), 1);
      order.push(kind);
    },
    queried() {
      const m = open.get(order[order.length - 1]!);
      if (m && m.queriedAt === null) m.queriedAt = now();
    },
    rendered(outcome) {
      const kind = order.pop();
      const m = kind && open.get(kind);
      if (!kind || !m) return;
      open.delete(kind);
      const end = now();
      const queriedAt = m.queriedAt ?? end;
      const done: Measurement = { kind, startedAt: m.startedAt, queryMs: queriedAt - m.startedAt, renderMs: end - queriedAt, totalMs: end - m.startedAt, outcome };
      latest[kind] = done;
      history.push(done);
      if (history.length > HISTORY) history.shift();
    },
    last: () => ({ load: latest.load, refresh: latest.refresh, history: [...history] }),
  };
}

/** Creates the recorder and exposes `target.__plannerTimings` (a live getter of the snapshot). */
export function installTimings(target: object = window): Timing {
  const timings = createTimings();
  Object.defineProperty(target, "__plannerTimings", { get: () => timings.last(), configurable: true });
  return timings;
}
