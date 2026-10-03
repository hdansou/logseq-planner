// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PL_MAP, THEME_TOKENS, plVars, watchTheme } from "./theme";
import type { ThemeDeps } from "../types";
import css from "./theme.css?inline";

describe("plVars", () => {
  it("wraps shui channels in hsl() and passes other values through", () => {
    const out = plVars({ "--background": "0 0% 100%", "--ls-secondary-background-color": "#f2f2f5" });
    expect(out["--pl-surface"]).toBe("hsl(0 0% 100%)");
    expect(out["--pl-sidebar"]).toBe("#f2f2f5");
  });

  it("never produces hsl(#hex) or hsl(hsl(...))", () => {
    const out = plVars({ "--background": "#ffffff", "--foreground": "hsl(0 0% 10%)" });
    expect(out["--pl-surface"]).toBe("#ffffff");
    expect(out["--pl-label"]).toBe("hsl(0 0% 10%)");
  });

  it("takes the first source that resolves", () => {
    const vals = { "--background": "", "--ls-primary-background-color": "#002b36" };
    expect(plVars(vals)["--pl-surface"]).toBe("#002b36");
    expect(plVars({ ...vals, "--background": "1 2% 3%" })["--pl-surface"]).toBe("hsl(1 2% 3%)");
  });

  it("omits tokens nothing resolved, so the stylesheet default applies", () => {
    expect(plVars({})).toEqual({});
    expect(plVars({ "--lx-gray-03": "  ", "--ls-font-family": undefined })).toEqual({});
  });

  it("maps the highlight set, status and today overrides", () => {
    const out = plVars({ "--ls-highlight-color-blue": "#aaa", "--ls-highlight-color-red": "#bbb", "--ink-green-soft": "#ccc", "--ink-accent": "#ddd" });
    expect(out["--pl-cat-1-soft"]).toBe("#aaa");
    expect(out["--pl-cat-7-soft"]).toBe("#bbb");
    expect(out["--pl-green-soft"]).toBe("#ccc");
    expect(out["--pl-today"]).toBe("#ddd");
  });

  it("drops hover when it equals the float surface (dark-mode guard)", () => {
    const same = plVars({ "--popover": "0 0% 17%", "--lx-gray-05": "hsl(0 0% 17%)" });
    expect(same["--pl-float"]).toBe("hsl(0 0% 17%)");
    expect(same["--pl-hover"]).toBeUndefined();
    const differ = plVars({ "--popover": "0 0% 17%", "--lx-gray-05": "#404244" });
    expect(differ["--pl-hover"]).toBe("#404244");
  });

  it("requests every source token it reads", () => {
    for (const [, sources] of PL_MAP) for (const s of sources) expect(THEME_TOKENS).toContain(s);
  });
});

describe("stylesheet defaults", () => {
  const block = (sel: string) => css.slice(css.indexOf(sel + " {"), css.indexOf("}", css.indexOf(sel + " {")));
  it("declares every mapped --pl-* token in :root and html.dark where the palette differs", () => {
    for (const [name] of PL_MAP) expect(block(":root"), name).toContain(`${name}:`);
    for (const n of ["--pl-surface", "--pl-float", "--pl-hover", "--pl-tint", "--pl-today", "--pl-green"]) expect(block("html.dark"), n).toContain(`${n}:`);
  });
  it("never uses prefers-color-scheme", () => expect(css).not.toContain("prefers-color-scheme"));
});

function fakeTheme(mode: string | undefined, vals: Record<string, string> = {}) {
  let onMode: (m: { mode: string }) => void = () => {};
  let onTheme: () => void = () => {};
  const deps = {
    getUserConfigs: vi.fn(async () => ({ preferredThemeMode: mode })),
    resolveThemeCssPropsVals: vi.fn(async () => vals),
    onThemeModeChanged: vi.fn((cb) => void (onMode = cb)),
    onThemeChanged: vi.fn((cb) => void (onTheme = cb)),
  } satisfies ThemeDeps;
  return { deps, fireMode: (mode: string) => onMode({ mode }), fireTheme: () => onTheme() };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("watchTheme", () => {
  it("mirrors the initial mode onto <html class=dark>", async () => {
    document.documentElement.className = "";
    await watchTheme(fakeTheme("dark").deps, document);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("stays light for light or unknown modes", async () => {
    document.documentElement.className = "dark";
    await watchTheme(fakeTheme("light").deps, document);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("follows onThemeModeChanged both ways and re-resolves tokens", async () => {
    document.documentElement.className = "";
    const t = fakeTheme("light");
    await watchTheme(t.deps, document);
    const calls = t.deps.resolveThemeCssPropsVals.mock.calls.length;
    t.fireMode("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    t.fireMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await flush();
    expect(t.deps.resolveThemeCssPropsVals.mock.calls.length).toBe(calls + 2);
  });

  it("writes resolved tokens on :root and re-resolves on onThemeChanged, clearing stale ones", async () => {
    const t = fakeTheme("light", { "--background": "0 0% 100%" });
    await watchTheme(t.deps, document);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--pl-surface")).toBe("hsl(0 0% 100%)");
    t.deps.resolveThemeCssPropsVals.mockResolvedValueOnce({ "--ls-primary-background-color": "#002b36" });
    t.fireTheme();
    await flush();
    expect(style.getPropertyValue("--pl-surface")).toBe("#002b36");
    t.deps.resolveThemeCssPropsVals.mockResolvedValueOnce({});
    t.fireTheme();
    await flush();
    expect(style.getPropertyValue("--pl-surface")).toBe("");
  });
});
