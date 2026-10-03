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
| `src/app.ts` | `registerApp(deps, root)`: creates the workspace, open (full-screen + focus retries) / close, Escape order, `g shift+p` binding, deferred registrations | call `logseq.*` |
| `src/sdk.ts` | every SDK call and typing cast; full-screen container style | DOM rendering inside the frame |
| `src/core/*` | schema, queries, normalisation, spans, layouts, kanban moves | touch DOM or SDK |
| `src/core/schema.ts` | tag tree, date/choice props incl. inherited, closed values: `loadTagInfos(dq)` (injected `Dq`) + pure `buildTagInfos` | call `getTag(title)` (fails by title) |
| `src/core/queries.ts` | `loadNodes` / `loadTasks` (injected `Dq`): nodes of a tag ± child tags, #Task blocks whose refs hit them | use the SDK, filter/span logic (`nodes.ts`) |
| `src/core/normalize.ts` | pure raw → `PlannerNode` / `PlannerTask`; Date/DateTime → local day (+ `HH:MM`) with injected `ZoneOffset` | read process TZ outside `systemZone` |
| `src/core/nodes.ts` | pure `resolveSpan` (mapped / point / derived / undated), `rollup`, `isDone` / `isCanceled`, `filterNodes`, `tasksOf` | query, touch DOM or SDK |
| `src/core/display-title.ts` | `displayTitle(title, titlesByUuid(nodes))`: inline `[[uuid]]` refs → the node's title, `(link)` when not loaded; every view renders titles through it | show a raw uuid |
| `src/core/timeline-layout.ts` | pure Timeline layout: `timelineRange` / `shiftAnchor` per zoom, `timelineItems` (span + tasks + rollup), `layoutTimeline` → columns, rows (bars as day indices, clip flags, points, task markers), undated list, today index; calendar-day arithmetic on UTC midnights (DST-safe) | read the clock (`today` is injected) |
| `src/ui/*` | rendering, theme tokens, events | query the graph directly |
| `src/ui/workspace.ts` + `workspace.css` | `createWorkspace(root, {dq, views, onClose})`: top bar, settings bar, tag tree, filters, view toolbar slot, empty states; pure `State` → HTML render functions, delegated events, actions queued (`idle()`), errors shown in `[data-region=error]` | call `logseq.*`, render a view (T08–T11) |
| `src/ui/theme.ts` + `theme.css` | host mode → `html.dark`, host tokens → `--pl-*` (`PL_MAP`), Inkwell defaults + base component CSS | call `logseq.*` (gets `ThemeDeps`) |
| `src/core/view-config.ts` | `ViewConfig` (tags/props by ident, closed values by uuid), `defaultViewConfig`, `validateViewConfig`, versioned JSON, `toChoiceFilters` | touch DOM or SDK |
| `src/storage.ts` | `createViewStore(StorageDeps)`: cache-first saved views on the "Planner views" page, config in hidden string property `planner-view-config`; every write read back | call `logseq.*` (deps from `storageDeps()` in sdk.ts) |
| `src/dev-probe.ts` | dev-only SDK hook for `scripts/probe.mjs` (behind `import.meta.env.DEV`) | ship in builds |
| `scripts/probe.mjs` | `npm run probe`: live probe → `src/core/__fixtures__/*.json` (docs/probes.md) | run on graphs other than plugin-test / Demo |
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
