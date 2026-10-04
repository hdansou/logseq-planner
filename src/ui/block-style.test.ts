import { describe, expect, it } from "vitest";
import { BLOCK_ROOT, blockStyle, hostTokenCss, scopeCss } from "./block-style";
import { PL_MAP } from "./theme";
import themeCss from "./theme.css?inline";

/** Every rule's selector list, in order (comments stripped, nested at-rule bodies included). */
const selectors = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith("@"));
/** The declarations of every rule whose selector is exactly `sel`, merged in order. */
const decls = (css: string, sel: string) => {
  const re = new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [...css.matchAll(re)].map((m) => m[1]);
  if (!bodies.length) throw new Error(`no rule ${sel}`);
  return Object.fromEntries(bodies.join(";").split(";").map((d) => d.trim()).filter(Boolean)
    .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]));
};

describe("scopeCss (N06b: the views' CSS in the host, under the block's root)", () => {
  it("prefixes every selector of a list, commas inside brackets and parens kept", () => {
    expect(scopeCss(`.a, .b > .c { color: red }`)).toBe(`.planner-block .a, .planner-block .b > .c{ color: red }`);
    expect(scopeCss(`[data-x="a,b"], :is(.p, .q) { x: 1 }`)).toBe(`.planner-block [data-x="a,b"], .planner-block :is(.p, .q){ x: 1 }`);
  });

  it("turns the token blocks into the block root: :root and html, html.dark under the host's own dark class", () => {
    expect(scopeCss(`:root { --pl-a: 1 } html.dark { --pl-a: 2 } html.dark .x { y: 1 }`))
      .toBe(`.planner-block{ --pl-a: 1 }html.dark .planner-block{ --pl-a: 2 }html.dark .planner-block .x{ y: 1 }`);
    // html and body are both the root: one selector, not two.
    expect(scopeCss(`html, body { margin: 0 }`)).toBe(`.planner-block{ margin: 0 }`);
  });

  it("never nests the root in itself: rules already written for the root stay as they are", () => {
    const out = scopeCss(`.planner-block { overflow: auto } .planner-block .pl-x, .y { z: 1 }`);
    expect(out).toBe(`.planner-block{ overflow: auto }.planner-block .pl-x, .planner-block .y{ z: 1 }`);
    expect(out).not.toContain(".planner-block .planner-block");
  });

  it("scopes inside media queries and keeps @keyframes and @font-face as they are", () => {
    expect(scopeCss(`@media (max-width: 9px) { .a { b: c } * { d: e } }`)).toBe(`@media (max-width: 9px){.planner-block .a{ b: c }.planner-block *{ d: e }}`);
    expect(scopeCss(`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } } .a { animation: spin 1s }`))
      .toBe(`@keyframes spin{ from { transform: rotate(0) } to { transform: rotate(1turn) } }.planner-block .a{ animation: spin 1s }`);
  });

  it("drops comments and @charset, and reads minified CSS", () => {
    expect(scopeCss(`@charset "UTF-8";/* x { } */.a{b:c}html.dark .d{e:f}`)).toBe(`.planner-block .a{b:c}html.dark .planner-block .d{e:f}`);
  });

  it("throws on a rule without its closing brace", () => {
    expect(() => scopeCss(`.a { b: c`)).toThrow(/unclosed/i);
  });
});

describe("hostTokenCss: the --pl-* tokens from the host's own variables (PL_MAP), with theme.css's defaults as the fallback", () => {
  const css = hostTokenCss(themeCss);
  const light = decls(css, BLOCK_ROOT);
  const dark = decls(css, `html.dark ${BLOCK_ROOT}`);

  it("declares every mapped token, in light and in dark", () => {
    expect(Object.keys(light).sort()).toEqual(PL_MAP.map(([name]) => name).sort());
    expect(Object.keys(dark).sort()).toEqual(PL_MAP.map(([name]) => name).sort());
  });

  it("chains the host variables in PL_MAP order, ending in the mode's default", () => {
    expect(light["--pl-panel"]).toBe("var(--ls-secondary-background-color, #f2f2f5)");
    expect(dark["--pl-panel"]).toBe("var(--ls-secondary-background-color, #161618)");
    expect(light["--pl-fill"]).toBe("var(--lx-gray-03-alpha, var(--lx-gray-03, #78788014))");
    expect(light["--pl-today"]).toBe("var(--ink-accent, #9c2529)");
    expect(light["--pl-font"]).toBe(`var(--ls-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif)`);
  });

  it("wraps a shui token (bare HSL channels) in hsl(); the host always defines those, so the chain ends there", () => {
    expect(light["--pl-surface"]).toBe("hsl(var(--background))");
    expect(dark["--pl-surface"]).toBe("hsl(var(--background))");
    expect(light["--pl-float"]).toBe("hsl(var(--popover))");
    expect(light["--pl-ring"]).toBe("hsl(var(--ring))");
  });

  it("throws when a mapped token has no default in theme.css", () => {
    expect(() => hostTokenCss(":root { --pl-surface: #fff }")).toThrow(/--pl-panel/);
  });
});

describe("blockStyle", () => {
  const css = blockStyle();

  it("puts every rule under the block root (or the host's html.dark above it)", () => {
    for (const list of selectors(css)) {
      for (const sel of list.split(/,(?![^(]*\))/).map((x) => x.trim())) {
        if (/^(from|to|\d+%)$/.test(sel)) continue; // keyframe steps
        expect(sel, list).toMatch(/^(html\.dark )?\.planner-block(?![\w-])/);
      }
    }
    expect(css).not.toContain(".planner-block .planner-block");
    expect(css).not.toMatch(/(^|[}\s,]):root\b/);
  });

  it("holds the views' component rules and not the workspace chrome", () => {
    for (const sel of [".planner-block .pl-tl-bar", ".planner-block .pl-cal-band", ".planner-block .pl-ag-entry", ".planner-block .pl-kb-card", ".planner-block .pl-btn"]) {
      expect(css).toContain(sel);
    }
    for (const chrome of [".pl-ws", ".pl-top", ".pl-settings", ".pl-view-toolbar"]) expect(css).not.toContain(chrome);
  });

  it("keeps the reduced-motion media query, scoped", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: ?reduce\)\s*\{\s*\.planner-block \*/);
  });

  it("ends with the host token declarations, so they win over the defaults at equal specificity", () => {
    expect(css.endsWith(hostTokenCss(themeCss))).toBe(true);
  });

  it("never exceeds its container: a block box at most 100% wide, not shrink-wrapped to the Timeline's content", () => {
    const root = decls(css, BLOCK_ROOT);
    expect(root.display).toBe("block");
    expect(root.width).toBe("100%");
    expect(root["max-width"]).toBe("100%");
    expect(root["min-width"]).toBe("0");
    expect(root["box-sizing"]).toBe("border-box");
    expect(root.overflow).not.toBe("auto"); // the header never scrolls away: only the view area scrolls
  });

  it("scrolls the view area only, sideways and down, at most 70vh tall", () => {
    const view = decls(css, ".planner-block .pl-block-view");
    expect(view.overflow).toBe("auto");
    expect(view["max-height"]).toBe("70vh");
    expect(view["min-width"]).toBe("0");
    expect(view["max-width"]).toBe("100%");
  });

  it("keeps the header whole: name and tags truncate, the button never shrinks", () => {
    const head = decls(css, ".planner-block .pl-block-head");
    expect(head.display).toBe("flex");
    expect(head["min-width"]).toBe("0");
    for (const sel of [".planner-block .pl-block-name", ".planner-block .pl-block-tags"]) {
      const d = decls(css, sel);
      expect(d["min-width"], sel).toBe("0");
      expect(d["text-overflow"], sel).toBe("ellipsis");
      expect(d["white-space"], sel).toBe("nowrap");
      expect(d.overflow, sel).toBe("hidden");
    }
    expect(decls(css, ".planner-block .pl-block-head .pl-btn")["flex-shrink"]).toBe("0");
  });
});
