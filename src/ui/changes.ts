// Live updates (T12): turns `DB.onChanged` into at most one quiet reload per burst, plus a slow poll as a safety net.
// `DB.onChanged` is only a wake-up (txData is always empty, payload keys are mangled: docs/probes.md), so the
// callback carries no data and every wake-up re-queries. No SDK, no DOM: the feed, the timers and the reload are injected.

/** Starts a timer and returns its cancel function (setTimeout / clearTimeout in production). */
export type Later = (fn: () => void, ms: number) => () => void;

/**
 * Quiet period after the last event before the reload starts. The redraw target is < 300 ms after the last change
 * (REQUIREMENTS.md); at ~2,000 nodes a reload (tag queries, node and task queries, render) took ~240 ms live (T13a), so
 * the wait gets what is left: 50 ms (was 100). The events of one edit mostly arrive within a few ms, which 50 ms merges;
 * but those of one user action can be more than 100 ms apart anyway (T12 live: 2 reloads for one upsert, 4 for an
 * append, at 100 ms), so the debounce length is not what coalesces them. That is the rule below: one refresh at a time,
 * and events during a running one earn exactly one more.
 */
export const DEBOUNCE_MS = 50;

/**
 * Safety net while Planner is visible: catches changes that never raised an event (sync from another device is untested,
 * docs/probes.md) and any event lost to a throttled timer. Slow, because every tick is a full reload.
 */
export const POLL_MS = 30_000;

export interface ChangesDeps {
  /** `DB.onChanged`: calls back on every change; returns the unsubscribe. */
  subscribe(cb: () => void): () => void;
  later: Later;
  /** The quiet reload (`Workspace.refresh`); it decides on its own whether a redraw has to wait. */
  refresh(): Promise<unknown>;
}

export interface Changes {
  /** Planner shown (true) or hidden (false). Showing refreshes once when the data is stale; the first show always loads. */
  setVisible(visible: boolean): void;
  /** Unsubscribes and cancels every timer; nothing runs afterwards. */
  stop(): void;
}

export function createChanges(deps: ChangesDeps): Changes {
  let visible = false;
  let stopped = false;
  /** What is on screen may differ from the graph. True at the start: nothing is on screen yet. */
  let stale = true;
  let running = false;
  let again = false;
  let cancelDebounce: (() => void) | null = null;
  let cancelPoll: (() => void) | null = null;

  const clearDebounce = () => {
    cancelDebounce?.();
    cancelDebounce = null;
  };

  /** One reload at a time; a wake-up during a reload earns exactly one more after it. */
  function refresh() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    stale = false;
    void deps.refresh().finally(() => {
      running = false;
      const owed = again;
      again = false;
      if (!owed || stopped) return;
      if (visible) refresh();
      else stale = true; // hidden meanwhile: the owed refresh runs on the next show (T14)
    });
  }

  const schedulePoll = () => {
    cancelPoll = deps.later(() => {
      refresh();
      schedulePoll();
    }, POLL_MS);
  };

  const unsubscribe = deps.subscribe(() => {
    if (stopped) return;
    if (!visible) {
      stale = true; // refreshed once on the next show instead of polling a hidden frame
      return;
    }
    clearDebounce();
    cancelDebounce = deps.later(() => {
      cancelDebounce = null;
      refresh();
    }, DEBOUNCE_MS);
  });

  return {
    setVisible(next) {
      if (stopped || next === visible) return;
      visible = next;
      if (next) {
        if (stale) refresh();
        schedulePoll();
        return;
      }
      if (cancelDebounce) stale = true; // an event still waiting in the debounce is not lost
      clearDebounce();
      cancelPoll?.();
      cancelPoll = null;
    },
    stop() {
      stopped = true;
      unsubscribe();
      clearDebounce();
      cancelPoll?.();
      cancelPoll = null;
    },
  };
}

/**
 * One source subscription shared by several listeners (N06b: the workspace's and the in-page blocks' `createChanges`
 * both wake on the one `DB.onChanged`): the source is subscribed on the first listener and unsubscribed when the last
 * one leaves; every event reaches every listener.
 */
export function shareFeed(subscribe: (cb: () => void) => () => void): (cb: () => void) => () => void {
  const listeners = new Set<() => void>();
  let off: (() => void) | null = null;
  return (cb) => {
    const own = () => cb(); // the same callback twice is two listeners
    listeners.add(own);
    off ??= subscribe(() => [...listeners].forEach((l) => l()));
    return () => {
      listeners.delete(own);
      if (listeners.size || !off) return;
      off();
      off = null;
    };
  };
}
