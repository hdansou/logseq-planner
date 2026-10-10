// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installNeighbours, neighbourOffset } from "./dock-neighbours";

const VIEWPORT = 1800;

describe("neighbourOffset (N44)", () => {
  it("is 0 with no other docked plugin", () => {
    expect(neighbourOffset([], VIEWPORT)).toBe(0);
  });

  it("is the width of a frame on the window's right edge", () => {
    expect(neighbourOffset([{ left: 936, right: 1800 }], VIEWPORT)).toBe(864);
  });

  it("is the widest of several frames on the right edge", () => {
    expect(neighbourOffset([{ left: 1400, right: 1800 }, { left: 1000, right: 1800 }], VIEWPORT)).toBe(800);
  });

  it("ignores frames that do not sit on the right edge, full-width overlays and empty ones", () => {
    expect(neighbourOffset([{ left: 100, right: 700 }], VIEWPORT)).toBe(0); // a floating panel
    expect(neighbourOffset([{ left: 0, right: 1800 }], VIEWPORT)).toBe(0); // full-screen
    expect(neighbourOffset([{ left: 1800, right: 1800 }], VIEWPORT)).toBe(0); // no size
  });

  it("allows a pixel or two of rounding at the edge", () => {
    expect(neighbourOffset([{ left: 1000, right: 1799 }], VIEWPORT)).toBe(800);
  });
});

describe("installNeighbours (N44)", () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
    document.body.innerHTML = "";
  });

  const container = (pid: string, left: number, visible = true) => {
    const el = document.createElement("div");
    el.className = "lsp-iframe-sandbox-container" + (visible ? " visible" : "");
    el.dataset.pid = pid;
    el.getBoundingClientRect = () => ({ left, right: VIEWPORT, width: VIEWPORT - left, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON() {} }) as DOMRect;
    document.body.append(el);
    return el;
  };
  const install = (onChange = vi.fn()) => {
    const n = installNeighbours(document, "planner", () => VIEWPORT, onChange);
    stop = n.stop;
    return { ...n, onChange };
  };

  it("measures the visible frames of other plugins, not its own or hidden ones", () => {
    container("planner", 1300);
    container("hidden", 500, false);
    container("canvas", 936);
    expect(install().offset()).toBe(864);
  });

  it("tells when another plugin shows, resizes or hides", async () => {
    const canvas = container("canvas", 936, false);
    const { offset, onChange } = install();
    expect(offset()).toBe(0);
    canvas.classList.add("visible");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(offset()).toBe(864);
    canvas.getBoundingClientRect = () => ({ left: 1100, right: VIEWPORT, width: 700 }) as DOMRect;
    canvas.style.width = "700px";
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(offset()).toBe(700);
    canvas.classList.remove("visible");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(3));
    expect(offset()).toBe(0);
  });

  it("notices a frame added later", async () => {
    const { offset, onChange } = install();
    container("canvas", 1000);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(offset()).toBe(800);
  });

  it("does not react to its own frame", async () => {
    const own = container("planner", 1300);
    const { onChange } = install();
    own.style.width = "500px";
    own.classList.remove("visible");
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops listening", async () => {
    const canvas = container("canvas", 936, false);
    const { onChange, stop: off } = install();
    off();
    canvas.classList.add("visible");
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).not.toHaveBeenCalled();
  });
});
