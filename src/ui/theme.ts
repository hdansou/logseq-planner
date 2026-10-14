// No SDK import: SDK calls arrive as `ThemeDeps` (src/sdk.ts), so this module is unit-testable.
import type { ThemeDeps } from "../types";

/** shui tokens are bare `H S% L%` channels and must be wrapped in hsl(); everything else is a ready colour. */
export const SHUI: ReadonlySet<string> = new Set(["--background", "--foreground", "--popover", "--muted-foreground", "--border", "--input",
  "--primary", "--primary-foreground", "--ring"]);

/**
 * Appended after a host font family: the host's webfonts do not load inside the frame, so a bare family such as
 * "Inter" would fall back to the browser's serif (seen live, T07 D1).
 */
export const FONT_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const GENERIC_FONT = /(^|,)\s*(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)\s*$/;

const STATUS = ["green", "orange", "red", "blue", "purple"].flatMap((c) => [c, `${c}-text`, `${c}-soft`]);

/**
 * `--pl-*` token → host tokens, first that resolves wins (docs/design.md). No source → stylesheet default only.
 * `--pl-tint-soft` is never read from the host: themes may set `--accent` to the strong primary (the default theme
 * does), which made selected rows dark text on strong blue (T07 D2). theme.css derives it from `--pl-tint`.
 */
export const PL_MAP: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["--pl-surface", ["--background", "--ls-primary-background-color"]],
  ["--pl-panel", ["--ls-secondary-background-color"]],
  ["--pl-float", ["--popover"]],
  ["--pl-label", ["--foreground", "--ls-primary-text-color"]],
  ["--pl-label-2", ["--muted-foreground", "--ls-secondary-text-color"]],
  ["--pl-line", ["--input", "--ls-border-color"]],
  ["--pl-line-soft", ["--border"]],
  ["--pl-fill", ["--lx-gray-03-alpha", "--lx-gray-03"]],
  ["--pl-fill-strong", ["--lx-gray-04-alpha", "--lx-gray-04"]],
  ["--pl-hover", ["--lx-gray-05"]],
  ["--pl-bullet", ["--ls-block-bullet-color"]],
  ["--pl-bullet-halo", ["--ls-block-bullet-border-color"]],
  ["--pl-tint", ["--primary", "--ls-active-primary-color"]],
  ["--pl-on-tint", ["--primary-foreground"]],
  ["--pl-ring", ["--ring", "--ls-focus-ring-color"]],
  ["--pl-today", ["--ink-accent"]],
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
  if (out["--pl-font"] !== undefined && !GENERIC_FONT.test(out["--pl-font"])) out["--pl-font"] = `${out["--pl-font"]}, ${FONT_FALLBACK}`;
  // A hover equal to the popover colour makes menu rows vanish (dark themes): fall back to the default.
  if (out["--pl-hover"] !== undefined && out["--pl-hover"] === out["--pl-float"]) delete out["--pl-hover"];
  return out;
}

/**
 * The host fires theme-changed as it injects the new stylesheet, and the plugin cannot see that load
 * finish (cross-origin), so tokens are resolved again after these delays.
 */
export const RERESOLVE_DELAYS_MS = [250, 1000];

/** Applies the host's mode and tokens now, and again on every mode or theme change. Resolves with the unsubscribe. */
export async function watchTheme(deps: ThemeDeps, doc: Document): Promise<() => void> {
  const root = doc.documentElement;
  let latest = 0;
  const applyTokens = async () => {
    const call = ++latest;
    const next = plVars((await deps.resolveThemeCssPropsVals(THEME_TOKENS)) ?? {});
    if (call !== latest) return; // a newer resolve owns the result
    for (const [name] of PL_MAP) root.style.removeProperty(name);
    for (const [name, v] of Object.entries(next)) root.style.setProperty(name, v);
  };
  const applyMode = (mode: string | undefined) => root.classList.toggle("dark", mode === "dark");

  const applyTokensAgain = () => {
    void applyTokens();
    for (const ms of RERESOLVE_DELAYS_MS) deps.later(() => void applyTokens(), ms);
  };
  const offs = [
    deps.onThemeModeChanged(({ mode }) => {
      applyMode(mode);
      applyTokensAgain();
    }),
    deps.onThemeChanged(applyTokensAgain),
  ];
  const off = () => offs.forEach((f) => f());
  applyMode((await deps.getUserConfigs())?.preferredThemeMode);
  await applyTokens();
  return off;
}
