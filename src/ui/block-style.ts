// In-page block styles (N06b): the views' CSS provided to the host once (`logseq.provideStyle`), scoped under the
// block's root class so nothing leaks into Logseq's own UI. In the plugin frame theme.ts resolves the --pl-* tokens from
// the host by script; in the host they are declared in CSS straight from the host's variables (PL_MAP), so a theme
// change applies without any script. Pure string functions; the stylesheets arrive as Vite `?inline` text.
import { PL_MAP, SHUI } from "./theme";
import themeCss from "./theme.css?inline";
import timelineCss from "./timeline.css?inline";
import calendarCss from "./calendar.css?inline";
import agendaCss from "./agenda.css?inline";
import kanbanCss from "./kanban.css?inline";
import blockCss from "./block.css?inline";

/** The class of every in-page block's root element. */
export const BLOCK_CLASS = "planner-block";
export const BLOCK_ROOT = `.${BLOCK_CLASS}`;

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Index of the brace closing the block opened at `open`, skipping quoted strings. */
function closing(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      i = css.indexOf(c, i + 1);
      if (i < 0) break;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error(`Unclosed CSS block at ${open}: ${css.slice(open, open + 40)}`);
}

/** Splits at the commas outside brackets, parentheses and quotes. */
function splitList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (quote) quote = c === quote ? "" : quote;
    else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** The document roots of the plugin's frame: the block's root in the host (`html.dark` stays the host's own dark class). */
const DOC_ROOT = /^(?::root|html|body)(\.dark)?(?![\w-])/;
const OWN = new RegExp(`^${BLOCK_ROOT.replace(".", "\\.")}(?![\\w-])`);

function scopeSelector(sel: string): string {
  if (OWN.test(sel)) return sel;
  const root = DOC_ROOT.exec(sel);
  if (root) return `${root[1] ? `html.dark ${BLOCK_ROOT}` : BLOCK_ROOT}${sel.slice(root[0].length)}`;
  return `${BLOCK_ROOT} ${sel}`;
}

const scopeList = (list: string) => [...new Set(splitList(list).map(scopeSelector))].join(", ");

/**
 * `css` with every selector under `.planner-block`: `:root`, `html` and `body` become the block's root, `html.dark`
 * becomes `html.dark .planner-block` (the host mirrors its mode on its own `<html>`), selectors already starting at the
 * block's root stay as they are. Rules inside `@media` / `@supports` are scoped too; `@keyframes` and `@font-face` are
 * kept as they are; comments and `@charset` are dropped. Throws on a block that is not closed.
 */
export function scopeCss(css: string): string {
  const text = stripComments(css);
  let out = "";
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) return out;
    const open = text.indexOf("{", i);
    const semi = text.indexOf(";", i);
    if (semi >= 0 && (open < 0 || semi < open)) {
      // A statement at-rule (`@charset`, `@import`): the charset is meaningless inside a <style>, the rest are kept.
      const statement = text.slice(i, semi + 1).trim();
      if (!statement.startsWith("@charset")) out += statement;
      i = semi + 1;
      continue;
    }
    if (open < 0) throw new Error(`Unclosed CSS block: ${text.slice(i, i + 40)}`);
    const end = closing(text, open);
    const prelude = text.slice(i, open).trim();
    const body = text.slice(open + 1, end);
    if (/^@(media|supports|container)\b/.test(prelude)) out += `${prelude}{${scopeCss(body)}}`;
    else if (prelude.startsWith("@")) out += `${prelude}{${body}}`;
    else out += `${scopeList(prelude)}{${body}}`;
    i = end + 1;
  }
}

/** The custom-property declarations of the rule whose selector is exactly `selector` (comments stripped). */
function tokenBlock(css: string, selector: string): Map<string, string> {
  const text = stripComments(css);
  const out = new Map<string, string>();
  let i = 0;
  for (;;) {
    const open = text.indexOf("{", i);
    if (open < 0) return out;
    const end = closing(text, open);
    if (text.slice(i, open).trim() === selector) {
      for (const decl of text.slice(open + 1, end).split(";")) {
        const at = decl.indexOf(":");
        if (at > 0 && decl.trim().startsWith("--")) out.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
      }
    }
    i = end + 1;
  }
}

/** `--a, --b` → `var(--a, var(--b, fallback))`; a shui token (bare HSL channels, always defined by the host) → `hsl(var(--x))`, which ends the chain. */
const chain = (sources: readonly string[], fallback: string) =>
  [...sources].reverse().reduce((acc, src) => (SHUI.has(src) ? `hsl(var(${src}))` : `var(${src}, ${acc})`), fallback);

/**
 * The --pl-* tokens for the host (N06b): each one from the first host variable in `PL_MAP` that is defined, else
 * theme.css's default for the mode (`:root` for light, `html.dark` for dark, falling back to `:root`). Declared for
 * `.planner-block` and `html.dark .planner-block`. Throws when a mapped token has no default in `themeCss`.
 */
export function hostTokenCss(themeCss: string): string {
  const light = tokenBlock(themeCss, ":root");
  const dark = tokenBlock(themeCss, "html.dark");
  const block = (selector: string, defaults: (name: string) => string | undefined) =>
    `${selector}{${PL_MAP.map(([name, sources]) => {
      const fallback = defaults(name);
      if (fallback === undefined) throw new Error(`No default for ${name} in theme.css`);
      return `${name}:${chain(sources, fallback)};`;
    }).join("")}}`;
  return block(BLOCK_ROOT, (n) => light.get(n)) + block(`html.dark ${BLOCK_ROOT}`, (n) => dark.get(n) ?? light.get(n));
}

/**
 * Everything the in-page blocks need, for one `provideStyle`: theme.css (tokens, base components) and the four view
 * stylesheets, plus block.css, scoped; then the host token declarations last, so at equal specificity they win over
 * the defaults. The workspace chrome (workspace.css) is not included.
 */
export function blockStyle(): string {
  return scopeCss([themeCss, timelineCss, calendarCss, agendaCss, kanbanCss, blockCss].join("\n")) + hostTokenCss(themeCss);
}
