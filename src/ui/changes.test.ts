import { describe, expect, it, vi } from "vitest";
import { createChanges, DEBOUNCE_MS, POLL_MS, shareFeed } from "./changes";
import { fakeChangeFeed, fakeClock } from "./test-fakes";

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(refresh: () => Promise<unknown> = async () => {}) {
  const clock = fakeClock();
  const feed = fakeChangeFeed();
  const refreshFn = vi.fn(refresh);
  const changes = createChanges({ subscribe: feed.subscribe, later: clock.later, refresh: refreshFn });
  return { clock, feed, refreshFn, changes };
}

describe("debounce", () => {
  it("a burst of events gives one refresh after the last one", async () => {
    const { clock, feed, refreshFn, changes } = setup();
    changes.setVisible(true);
    await settle();
    refreshFn.mockClear(); // the first show loads
    for (let i = 0; i < 5; i++) {
      feed.fire();
      clock.advance(DEBOUNCE_MS - 1);
    }
    expect(refreshFn).not.toHaveBeenCalled();
    clock.advance(1);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    clock.advance(DEBOUNCE_MS * 3);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it("the debounce is 50 ms: room for a ~240 ms reload inside the 300 ms redraw target (T13a)", () => {
    expect(DEBOUNCE_MS).toBe(50);
  });

  it("an event during a running refresh gives exactly one more refresh after it", async () => {
    let finish!: () => void;
    const { clock, feed, refreshFn, changes } = setup(() => new Promise<void>((r) => (finish = r)));
    changes.setVisible(true);
    finish();
    await settle();
    refreshFn.mockClear();
    feed.fire();
    clock.advance(DEBOUNCE_MS);
    expect(refreshFn).toHaveBeenCalledTimes(1); // now running, unresolved
    feed.fire();
    clock.advance(DEBOUNCE_MS);
    feed.fire();
    clock.advance(DEBOUNCE_MS);
    expect(refreshFn).toHaveBeenCalledTimes(1); // not overlapping
    finish();
    await vi.waitFor(() => expect(refreshFn).toHaveBeenCalledTimes(2));
    finish();
    await settle();
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });
});

describe("visibility", () => {
  it("the first show loads once (nothing is on screen yet)", () => {
    const { refreshFn, changes } = setup();
    changes.setVisible(true);
    changes.setVisible(true); // idempotent
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it("while hidden: no refresh, no timers; one refresh on the next show", async () => {
    const { clock, feed, refreshFn, changes } = setup();
    changes.setVisible(true);
    await settle();
    changes.setVisible(false);
    refreshFn.mockClear();
    feed.fire();
    feed.fire();
    clock.advance(POLL_MS * 3);
    expect(refreshFn).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
    changes.setVisible(true);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it("an event pending in the debounce when Planner hides is not lost: it counts as stale", async () => {
    const { clock, feed, refreshFn, changes } = setup();
    changes.setVisible(true);
    await settle();
    refreshFn.mockClear();
    feed.fire();
    changes.setVisible(false);
    clock.advance(DEBOUNCE_MS * 2);
    expect(refreshFn).not.toHaveBeenCalled();
    changes.setVisible(true);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it("a refresh that ends while hidden with another one owed marks the data stale: the next show refreshes (T14)", async () => {
    let finish!: () => void;
    const { clock, feed, refreshFn, changes } = setup(() => new Promise<void>((r) => (finish = r)));
    changes.setVisible(true); // the first load starts and is held
    feed.fire();
    clock.advance(DEBOUNCE_MS); // a change during it: one more is owed
    changes.setVisible(false);
    finish();
    await settle();
    expect(refreshFn).toHaveBeenCalledTimes(1);
    changes.setVisible(true);
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });

  it("showing again with nothing changed does not refresh", async () => {
    const { refreshFn, changes } = setup();
    changes.setVisible(true);
    await settle();
    changes.setVisible(false);
    refreshFn.mockClear();
    changes.setVisible(true);
    expect(refreshFn).not.toHaveBeenCalled();
  });
});

describe("slow poll", () => {
  it("refreshes every POLL_MS while visible, with no event", async () => {
    const { clock, refreshFn, changes } = setup();
    changes.setVisible(true);
    await settle();
    refreshFn.mockClear();
    clock.advance(POLL_MS);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    await settle();
    clock.advance(POLL_MS);
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });

  it("is much slower than the debounce", () => {
    expect(POLL_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("stop", () => {
  it("unsubscribes and cancels every timer; nothing refreshes afterwards", async () => {
    const { clock, feed, refreshFn, changes } = setup();
    changes.setVisible(true);
    await settle();
    refreshFn.mockClear();
    feed.fire();
    expect(feed.count()).toBe(1);
    changes.stop();
    expect(feed.count()).toBe(0);
    expect(clock.pending()).toBe(0);
    feed.fire();
    clock.advance(POLL_MS * 2);
    changes.setVisible(true);
    expect(refreshFn).not.toHaveBeenCalled();
  });
});

describe("shareFeed (N06b: the workspace and the in-page blocks share one DB.onChanged)", () => {
  it("subscribes to the source once, on the first listener, and fans every event out", () => {
    const feed = fakeChangeFeed();
    const shared = shareFeed(feed.subscribe);
    expect(feed.count()).toBe(0);
    const a = vi.fn();
    const b = vi.fn();
    shared(a);
    shared(b);
    expect(feed.count()).toBe(1);
    feed.fire();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
  });

  it("unsubscribes from the source when the last listener leaves", () => {
    const feed = fakeChangeFeed();
    const shared = shareFeed(feed.subscribe);
    const a = vi.fn();
    const offA = shared(a);
    const offB = shared(vi.fn());
    offA();
    feed.fire();
    expect(a).not.toHaveBeenCalled();
    expect(feed.count()).toBe(1);
    offB();
    expect(feed.count()).toBe(0);
    shared(vi.fn());
    expect(feed.count()).toBe(1); // subscribes again for a new listener
  });
});
