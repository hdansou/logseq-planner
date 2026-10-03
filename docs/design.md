# Planner design notes

Planner's UI follows the Inkwell design system (`~/Projects/src/github.com/logseq-inkwell-theme`:
`docs/DESIGN.md`, `src/palettes/slate.css`, `src/base.css`). Inside Logseq the colours come
from the active theme; Inkwell's values are the defaults for what Logseq does not expose.
Prototype with these treatments: https://claude.ai/artifact/KU9Z831Y9y974EUW1yVcud

## Principles

- Neutral by default. **Tint** marks primary actions and the selected item. **Accent** marks
  only today. Links and tags are label-coloured, never accent-coloured.
- **Status hues** carry state: blue doing, purple in review, green done, red late/overdue,
  orange high priority. **Highlight set** carries categories (one colour per node), always
  with label-coloured text on it.
- Components use tokens only, no colour literals. One elevation level. Almost no motion
  (`background-color .12s` on hover).
- Contrast: text AA 4.5:1 on its surface, icons 3:1. Never light-mode system green, orange
  or red as icons on white.

## Tokens Planner defines (`--pl-*`), and where each value comes from

Read with `logseq.UI.resolveThemeCssPropsVals`, re-resolved on `onThemeModeChanged` and
`onThemeChanged`. shui values are bare `H S% L%` channels → wrap in `hsl()`.

| Planner token | Source (first that resolves) | Inkwell light / dark |
|---|---|---|
| `--pl-surface` | `--background` (shui), `--ls-primary-background-color` | #ffffff / #1c1c1e |
| `--pl-sidebar` | `--ls-secondary-background-color` | #f2f2f5 / #161618 |
| `--pl-float` | `--popover` | #ffffff / #2c2c2e |
| `--pl-label` | `--foreground`, `--ls-primary-text-color` | #1d1d1f / #f5f5f7 |
| `--pl-label-2` | `--muted-foreground`, `--ls-secondary-text-color` | #6e6e73 / #98989d |
| `--pl-line` | `--input`, `--ls-border-color` | #d2d2d7 / #38383a |
| `--pl-line-soft` | `--border` | #e8e8ed / #2c2c2e |
| `--pl-fill` | `--lx-gray-03-alpha`, `--lx-gray-03` | #78788014 / #7878802e |
| `--pl-fill-strong` | `--lx-gray-04-alpha`, `--lx-gray-04` | #7878801f / #78788047 |
| `--pl-hover` | `--lx-gray-05` (must differ from `--pl-float`) | #dcdee1 / #404244 |
| `--pl-tint` | `--primary`, `--ls-active-primary-color` | #223b3b / #b3c6c6 |
| `--pl-on-tint` | `--primary-foreground` | #ffffff / #000000 |
| `--pl-tint-soft` | `--accent` (shui), `--ls-selection-background-color` | #dfe8e8 / #213232 |
| `--pl-ring` | `--ring`, `--ls-focus-ring-color` | tint |
| `--pl-today` | none in Logseq → Inkwell default; `--ink-accent` if present | #9c2529 / #e8878a |
| `--pl-cat-{1..7}-soft` | `--ls-highlight-color-{blue,green,yellow,purple,pink,gray,red}` | Inkwell `--ink-hl-*` |
| status (`--pl-green` …, `-text`, `-soft`) | none in Logseq → Inkwell defaults; `--ink-*` if present | see slate.css |
| `--pl-shadow-float` | none → Inkwell default | `0 0 0 .5px rgba(0,0,0,.12), 0 12px 40px rgba(0,0,0,.18)` |
| `--pl-font` | `--ls-font-family` | system stack |

Dark mode: mirror the host's mode onto the iframe `<html class="dark">` (skill gotcha) and
key Planner's own defaults off `html.dark`, never `prefers-color-scheme`.

## Component treatments (from Inkwell base.css)

- **Buttons:** pill (radius 980px). Primary = tint on on-tint. Secondary = `fill-strong`,
  label text, no border; hover `hover`.
- **Segmented control** (view switch, zoom, month/week): pill track on `fill`, selected
  segment `tint-soft` with label text at 600.
- **Selects / inputs:** radius 10, 1px `line`, surface background; focus = border `tint` +
  `0 0 0 3px tint-soft`. The same ring is the global focus style.
- **Popovers and menus** (done values, saved views): `float`, radius 14, `shadow-float`,
  no border; rows radius 9, hover `hover` with label text.
- **Left sidebar** (tag tree, filters): `sidebar` background, 1px `line-soft` right edge;
  rows radius 8, 14px; hover `fill`; active `tint-soft` at 600 with the `#` in tint;
  group headers 11.5px/600 in label-2, not uppercase.
- **Tags:** 22px pill on `fill-strong`, 12.5px/500, label text. **Category chips:** same
  shape on the node's highlight colour.
- **Panels and cards:** Agenda groups and Kanban cells on `fill`, radius 12; Kanban cards on
  surface, radius 10, hairline `line` ring, no shadow.
- **Checkboxes:** `accent-color: tint`.
- **Calendar:** round day numbers; today in accent at 700, transparent background.
- **Timeline:** bar = node highlight fill with a 1px inset stroke in the status hue; progress
  is a 3px strip along the bottom (keeps the label readable); derived = dashed outline;
  today line in accent.
- **Toasts:** float surface, radius 14, `shadow-float`.
- **Status icons:** Backlog/Todo label-2 (Backlog dashed), Doing blue, In Review purple,
  Done green, Canceled label-3. Urgent red text, High orange text.

## Avoid

- `hsl(#hex)` (blanks the UI); hover equal to the popover colour in dark mode; faint muted
  highlights on popovers; borders on floating surfaces; a second shadow level;
  `!important` outside the skill's container-positioning gotcha; label-3 for real text.
