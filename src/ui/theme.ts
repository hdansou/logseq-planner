// No SDK import: SDK calls arrive as `ThemeDeps` (src/sdk.ts), so this module is unit-testable.
import type { ThemeDeps } from "../types";

/** shui tokens are bare `H S% L%` channels and must be wrapped in hsl(); everything else is a ready colour. */
const SHUI = new Set(["--background", "--foreground", "--popover", "--muted-foreground", "--border", "--input",
  "--primary", "--primary-foreground", "--accent", "--ring"]);

const HIGHLIGHTS = ["blue", "green", "yellow", "purple", "pink", "gray", "red"];
const STATUS = ["green", "orange", "red", "blue", "purple"].flatMap((c) => [c, `${c}-text`, `${c}-soft`]);

/** `--pl-*` token → host tokens, first that resolves wins (docs/design.md). No source → stylesheet default only. */
export const PL_MAP: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["--pl-surface", ["--background", "--ls-primary-background-color"]],
  ["--pl-sidebar", ["--ls-secondary-background-color"]],
  ["--pl-float", ["--popover"]],
  ["--pl-label", ["--foreground", "--ls-primary-text-color"]],
  ["--pl-label-2", ["--muted-foreground", "--ls-secondary-text-color"]],
  ["--pl-line", ["--input", "--ls-border-color"]],
  ["--pl-line-soft", ["--border"]],
  ["--pl-fill", ["--lx-gray-03-alpha", "--lx-gray-03"]],
  ["--pl-fill-strong", ["--lx-gray-04-alpha", "--lx-gray-04"]],
  ["--pl-hover", ["--lx-gray-05"]],
  ["--pl-tint", ["--primary", "--ls-active-primary-color"]],
  ["--pl-on-tint", ["--primary-foreground"]],
  ["--pl-tint-soft", ["--accent", "--ls-selection-background-color"]],
  ["--pl-ring", ["--ring", "--ls-focus-ring-color"]],
  ["--pl-today", ["--ink-accent"]],
  ...HIGHLIGHTS.map((c, i) => [`--pl-cat-${i + 1}-soft`, [`--ls-highlight-color-${c}`]] as const),
  ...STATUS.map((s) => [`--pl-${s}`, [`--ink-${s}`]] as const),
  ["--pl-font", ["--ls-font-family"]],
];

export const THEME_TOKENS: string[] = [...new Set(PL_MAP.flatMap(([, sources]) => sources))];

const resolved = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** Pure: host values → `--pl-*` values. Unresolved tokens are omitted so the stylesheet default applies. */
export function plVars(vals: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, sources] of PL_MAP) {
    const src = sources.find((s) => resolved(vals[s]));
    if (!src) continue;
    const v = vals[src]!.trim();
    out[name] = SHUI.has(src) && !/^(#|rgb|hsl)/.test(v) ? `hsl(${v})` : v;
  }
  // A hover equal to the popover colour makes menu rows vanish (dark themes): fall back to the default.
  if (out["--pl-hover"] !== undefined && out["--pl-hover"] === out["--pl-float"]) delete out["--pl-hover"];
  return out;
}

/** Applies the host's mode and tokens now, and again on every mode or theme change. */
export async function watchTheme(deps: ThemeDeps, doc: Document): Promise<void> {
  const root = doc.documentElement;
  const applyTokens = async () => {
    const next = plVars((await deps.resolveThemeCssPropsVals(THEME_TOKENS)) ?? {});
    for (const [name] of PL_MAP) root.style.removeProperty(name);
    for (const [name, v] of Object.entries(next)) root.style.setProperty(name, v);
  };
  const applyMode = (mode: string | undefined) => root.classList.toggle("dark", mode === "dark");

  deps.onThemeModeChanged(({ mode }) => {
    applyMode(mode);
    void applyTokens();
  });
  deps.onThemeChanged(() => void applyTokens());
  applyMode((await deps.getUserConfigs())?.preferredThemeMode);
  await applyTokens();
}
