// @vitest-environment happy-dom
// N40: the handle on the docked Planner's left edge.
import { describe, expect, it, vi } from "vitest";
import { installDockResize, resizedWidth } from "./dock-resize";

describe("resizedWidth", () => {
  it("moving the pointer left of where it grabbed makes the frame wider, right narrower (its left edge follows the pointer)", () => {
    expect(resizedWidth(500, 2, -98, 1500)).toBe(600);
    expect(resizedWidth(500, 2, 102, 1500)).toBe(400);
    expect(resizedWidth(500, 2, 2, 1500)).toBe(500);
  });
  it("stays within the allowed range", () => {
    expect(resizedWidth(500, 0, 400, 1500)).toBe(320);
    expect(resizedWidth(500, 0, -2000, 1500)).toBe(1500 - 360);
  });
});

describe("installDockResize", () => {
  function setup(width = 500) {
    document.body.innerHTML = `<div id="r"><div data-dock-resize tabindex="0"></div><p id="other"></p></div>`;
    const root = document.getElementById("r")!;
    const grip = root.querySelector<HTMLElement>("[data-dock-resize]")!;
    grip.setPointerCapture = vi.fn();
    const state = { width };
    const hooks = {
      width: () => state.width,
      viewport: () => 1500,
      apply: vi.fn((px: number, _animate: boolean) => void (state.width = px)),
      commit: vi.fn((px: number) => void (state.width = px)),
    };
    const stop = installDockResize(root, hooks);
    const ptr = (type: string, clientX: number, target: Element = grip) => target.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, button: 0, bubbles: true }));
    return { root, grip, hooks, stop, ptr, state };
  }

  it("a drag applies the width live without animation, and commits it on release", () => {
    const { grip, hooks, ptr } = setup();
    ptr("pointerdown", 2);
    expect(grip.setPointerCapture).toHaveBeenCalledWith(1);
    ptr("pointermove", -48); // 50 px left of the grab
    expect(hooks.apply).toHaveBeenLastCalledWith(550, false);
    // the frame grew 50 px to the left, so its coordinates moved with it: the pointer, 100 px further left, reads 2 - 100
    ptr("pointermove", -98);
    expect(hooks.apply).toHaveBeenLastCalledWith(650, false);
    ptr("pointerup", -98);
    expect(hooks.commit).toHaveBeenCalledWith(650);
    ptr("pointermove", 0); // no longer dragging
    expect(hooks.apply).toHaveBeenCalledTimes(2);
  });

  it("a press that does not move commits nothing; a cancelled drag puts the width back, animated", () => {
    const { hooks, ptr } = setup();
    ptr("pointerdown", 2);
    ptr("pointerup", 2);
    expect(hooks.commit).not.toHaveBeenCalled();
    ptr("pointerdown", 2);
    ptr("pointermove", -100);
    ptr("pointercancel", -100);
    expect(hooks.apply).toHaveBeenLastCalledWith(500, true);
    expect(hooks.commit).not.toHaveBeenCalled();
  });

  it("only the handle starts a drag", () => {
    const { root, hooks, ptr } = setup();
    ptr("pointerdown", 2, root.querySelector("#other")!);
    ptr("pointermove", -100, root.querySelector("#other")!);
    expect(hooks.apply).not.toHaveBeenCalled();
  });

  it("the arrow keys on the handle widen (Left) and narrow (Right) by 24 px, 96 with Shift, and commit; double-click resets to 40%", () => {
    const { grip, hooks } = setup();
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(hooks.commit).toHaveBeenLastCalledWith(524);
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(hooks.commit).toHaveBeenLastCalledWith(428);
    grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(hooks.commit).toHaveBeenLastCalledWith(600);
  });

  it("when the frame's real left edge can be measured, the width comes from it, not from the width applied last (the frame lags the pointer)", () => {
    const { grip, hooks, ptr, stop: stopPlain } = setup();
    stopPlain();
    const stop = installDockResize(grip.parentElement!, { ...hooks, frameLeft: () => 1000 });
    ptr("pointerdown", 2);
    ptr("pointermove", -48); // absolute x = 1000 - 48; the left edge goes to 1000 - 48 - 2 = 950; width 1500 - 950
    expect(hooks.apply).toHaveBeenLastCalledWith(550, false);
    stop();
  });

  it("a drag goes on when the pointer leaves the frame: the host window's pointer position, which is absolute, sets the width", () => {
    const host = new EventTarget();
    const { grip, hooks, ptr, stop: stopPlain } = setup();
    stopPlain(); // the same root, now with the host
    const stop = installDockResize(grip.parentElement!, { ...hooks, host: host as never });
    ptr("pointerdown", 2);
    const hostMove = (type: string, clientX: number) => host.dispatchEvent(Object.assign(new Event(type), { clientX, pointerId: 1 }));
    hostMove("pointermove", 700); // 1500 - (700 - 2)
    expect(hooks.apply).toHaveBeenLastCalledWith(802, false);
    hostMove("pointerup", 700);
    expect(hooks.commit).toHaveBeenCalledWith(802);
    hostMove("pointermove", 400); // the drag is over: listeners are off
    expect(hooks.apply).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stop removes the listeners", () => {
    const { grip, hooks, stop, ptr } = setup();
    stop();
    ptr("pointerdown", 2);
    ptr("pointermove", -100);
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(hooks.apply).not.toHaveBeenCalled();
    expect(hooks.commit).not.toHaveBeenCalled();
  });
});
