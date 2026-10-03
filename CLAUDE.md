# Planner

Logseq DB plugin: Timeline, Calendar, Agenda and Kanban views over any tag, in a
full-screen workspace. Read REQUIREMENTS.md, then tasks.md (next unchecked item), then
docs/design.md before changing UI.

## Stack

TypeScript, plain DOM (no UI framework), Vite, Vitest (+ happy-dom per file for DOM tests),
`@logseq/libs` from the `next` dist-tag (floor ^0.3.4). DB graphs only.

## Layout

| Path | Owns | Never does |
|---|---|---|
| `src/index.ts` | entry: imports `@logseq/libs`, hands `appDeps()` to `registerApp` | business logic |
| `src/app.ts` | `registerApp(deps, root)`: shell, open/close, deferred registrations | call `logseq.*` |
| `src/sdk.ts` | every SDK call and typing cast | DOM rendering |
| `src/core/*` | schema, queries, normalisation, spans, layouts, kanban moves | touch DOM or SDK |
| `src/ui/*` | rendering, theme tokens, events | query the graph directly |
| `src/storage.ts` | cache-first saved views (graph-backed) | anything else |
| `docs/` | design notes, probe results, manual test | — |

## Workflow

- One tasks.md item per change; write its acceptance test first; commit `feat|fix|docs(...)
  : summary (Tnn)`; docs in the same commit.
- `npm run typecheck && npm test && npm run build` before every commit.
- Check `npm view @logseq/libs@next` at the start of a session; bump the pin if needed.
- Dev server: `npm run dev` on port 8293 (`--strictPort`); preview 8294.
- Live checks use the `plugin-test` graph only.

## Repo-specific gotchas (DO NOT UNDO)

- Only `src/index.ts` imports `@logseq/libs`; other files use
  `/// <reference types="@logseq/libs" />` (vitest crashes otherwise).
- Keep `main()` minimal; defer registrations with `setTimeout(…, 0)`.
- Full-screen main UI: write the container style directly (saved layouts ignore
  `setMainUIInlineStyle` position/size); leave room for macOS window buttons.
- Dark mode: mirror onto `<html class="dark">`; CSS keys off `html.dark`, never
  `prefers-color-scheme`. Host tokens via `resolveThemeCssPropsVals`, re-resolved on theme
  change; shui values are channels → `hsl()`; never `hsl(#hex)`.
- Hidden iframes throttle timers: debounced `DB.onChanged` plus a slow poll.
- `datascriptQuery` string inputs are EDN-read; a string starting with `[[` is a page ref;
  rules go last in `:in` as a string with a leading space.
- Pull-map keys keep full idents except `:block/*`.
- Plugin state on blocks: type string + `hide: true`; ensure the schema right before each
  write. Dev installs get random plugin ids → property namespaces differ from a real install.
- `:block/refs` includes property and tag entities; filter to the tag's nodes.
- `predev` deletes `dist/` (stale dist breaks the dev server).

## Do not touch

- Users' tag schemas: Planner never creates or edits properties on user tags.

## Testing

Co-located `src/**/*.test.ts`; DOM tests start with `// @vitest-environment happy-dom`.
Core tests run against probe fixtures in `src/core/__fixtures__/`. SDK calls are injected,
so tests pass fakes.

## Where to look

REQUIREMENTS.md · tasks.md · docs/design.md · docs/probes.md ·
~/.claude/skills/logseq-plugin-dev (standard, runtime gotchas) ·
~/Projects/src/github.com/logseq-query-builder (reference implementation) ·
~/Projects/src/github.com/logseq-inkwell-theme (design system)
