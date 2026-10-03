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
| `src/app.ts` | `registerApp(deps, root)`: creates the workspace, open (full-screen + focus retries) / close, Escape order, `g shift+p` binding, deferred registrations, `nodeOpener` (click → `openPage` + hide, Shift → `openInSidebar`), creates `createChanges` with the deferred registrations (first show = `workspace.open()`, later = `refresh()`; `ui:visible:changed` and its own open/close drive visibility) | call `logseq.*` |
| `src/sdk.ts` | every SDK call and typing cast; full-screen container style; `hostWeekStart()` (`preferredStartOfWeek`, number or numeric string); `changesSdk()` (`DB.onChanged`, cancelable `setTimeout`, `ui:visible:changed`, `beforeunload`); `kanbanWriteDeps()` (`upsertBlockProperty` / `removeBlockProperty` passed through unchanged, `readChoice` = pull by `#uuid` input, `choiceReadQuery`) | DOM rendering inside the frame |
| `src/core/*` | schema, queries, normalisation, spans, layouts, kanban moves | touch DOM or SDK |
| `src/core/schema.ts` | tag tree, date/choice props incl. inherited, closed values: `loadTagInfos(dq)` (injected `Dq`) + pure `buildTagInfos` | call `getTag(title)` (fails by title) |
| `src/core/queries.ts` | `loadNodes` / `loadNodesAndTasks` (injected `Dq`): nodes of a tag ± child tags with a narrow pull (`nodesQuery(tags)` / `nodePull`: id, uuid, title, tags + every tag's date/choice idents, `nodePropIdents`; Date idents as `{ident [:db/id :block/journal-day]}`, so no journal-day query), and the #Task blocks that reference a node of the tag (`TASKS_QUERY`, same tag join, asked together with the nodes); `readRaw(dq, tags, tag, prev?)` re-asks only stale rows, `buildData` maps them; `loadTitles(dq, uuids)`: one `TITLES_QUERY` (uuid strings as a collection, `(str ?u)`), none when empty | use the SDK, filter/span logic (`nodes.ts`), `pull [*]` |
| `src/core/normalize.ts` | pure raw → `PlannerNode` / `PlannerTask`; Date (pulled journal page `journal-day`) / DateTime → local day (+ `HH:MM`) with injected `ZoneOffset`; `choiceValueOf` (only a closed value counts) and `isEmptyPlaceholder` (`:logseq.property/empty-placeholder` = no value, by ident) | read process TZ outside `systemZone` |
| `src/core/nodes.ts` | pure `resolveSpan` (mapped / point / derived / undated), `rollup`, `isDone` / `isCanceled`, `filterNodes`, `tasksOf` | query, touch DOM or SDK |
| `src/core/display-title.ts` | `displayTitle(title, titles)`: inline `[[uuid]]` refs → the node's title, `(link)` when unknown; `titlesByUuid(nodes)`, `refUuids(titles)`; every view renders titles through it with the workspace's `State.titles` (loaded nodes + `loadTitles` for the rest) | show a raw uuid |
| `src/core/layout-common.ts` | shared by the view layouts: calendar-day arithmetic on UTC midnights (DST-safe), day/month/range formatting, `weekStartFromHost` (Logseq 0–6 Mon–Sun → 0 = Sunday), `categoryOf`, `viewItems` (span + tasks + rollup), task state / late / labels, node labels | read the clock or the host |
| `src/core/timeline-layout.ts` | pure Timeline layout: `timelineRange` / `shiftAnchor` per zoom, `layoutTimeline` → columns, rows only for nodes touching the range (bars as day indices, clip flags, points, task markers), `earlier` / `later` counts with the nearest day, undated list, today index | read the clock (`today` is injected), duplicate layout-common |
| `src/core/calendar-layout.ts` | pure Calendar layout: `calendarRange` / `shiftCalendarAnchor` (Month = whole weeks of the anchor's month, Week = 7 days), `layoutCalendar` → week rows of days (outside / today / weekend / "+N more" count), bands on lanes stable over the range with continuation flags, point and deadline chips (time-sorted, untimed first) on item rows, `MONTH_SLOTS` per day in Month, undated list | read the clock, duplicate layout-common |
| `src/core/agenda.ts` | pure Agenda layout: `layoutAgenda` files nodes (by span) and linked tasks (Scheduled/Deadline) into buckets (overdue, today, the next 14 days, later, no date, earlier; empty ones omitted) or node groups; done by the view's done values / Status flags, Show done window, `late`, sort by date, time, title; `HORIZON_DAYS` | read the clock (`today` is injected), duplicate layout-common |
| `src/core/kanban.ts` | Kanban model: `layoutKanban` (columns = closed values + "No <prop>", optional lanes + "No <prop>", counts, done columns, cards sorted by due / priority (`priorityProp`, last value highest) / title, pending flag), `findCell` / `cardCell`, pure `moveDescriptor(card, from, to)` → `PropertyWrite[]` (set or remove; column first, lane second; same cell = none), `movedNode` (optimistic copy), `writeMove(KanbanWriteDeps, writes)`: full ident without colon (`writeKey`) + closed value entity id, every write read back, throws on mismatch | pass a uuid, an ident string or a title as the value; trust a write's return value |
| `src/ui/*` | rendering, theme tokens, events | query the graph directly |
| `src/ui/workspace.ts` + `workspace.css` | `createWorkspace(root, {dq, views, onClose, openNode, weekStart, kanban, today?})` (`weekStart()` = host setting, read on every open): top bar, settings bar, tag tree, filters, view toolbar slot, empty states; pure `State` → HTML render functions, delegated events, actions queued (`idle()`), errors shown in `[data-region=error]`; renders the Timeline, the Calendar, the Agenda and the Kanban into the view area and toolbar slot (anchor, shared by both and kept when a saved view is opened, and expanded rows are session state; zoom and calendar layout are config); Kanban: column / lane / sort are config, pending moves (`State.pending`) are session state, HTML5 drag events delegated on the root, `move()` = optimistic render → `writeMove` → quiet reload (`fetchData`) whether it worked or not, error to the error bar; `openNode` dep for click / Shift+click; `refresh()` = live quiet reload (week start, tags and the view's rows in one batch, rows read with the shown tags and re-mapped with the new ones, a query re-run only when `readRaw` finds it stale; redraw only if the signature differs, keeps scroll / `details` / focus, defers while a popover is open or a drag runs, never rejects) | call `logseq.*`, hold view-specific layout logic (that is `src/core/*-layout.ts`) |
| `src/ui/timeline.ts` + `timeline.css` | pure `TimelineLayout` → HTML (toolbar, earlier / later summary `data-tl-outside-summary` with `data-tl-jump` + `data-tl-day` buttons, head, backdrop, rows, task rows, today line, undated footnote) and `timelineAction(target)` for the workspace's delegated click handler; one CSS grid of day tracks (`--pl-tl-days` × `--pl-tl-day`) | own state or call the SDK |
| `src/ui/calendar.ts` + `calendar.css` | pure `CalendarLayout` → HTML (toolbar, weekday headers in Month, one 7-column grid per week row: day cells spanning all rows, bands and chips at `grid-row: row + 2`, "+N more", undated list) and `calendarAction(target)` for the delegated click handler | own state or call the SDK |
| `src/ui/agenda.ts` + `agenda.css` | pure `AgendaLayout` → HTML (toolbar: Group by Node/Date + Show done toggle; by date a `data-ag-bucket` section per non-empty bucket, Later / No date / Earlier folded `details` (summary `data-ag-fold`) whose entries render only while opened (`AgendaShown.open`, kept in the workspace's `agendaOpen` from the delegated capture `toggle` event); by node a `data-ag-group` section per node with its line and tasks, `AGENDA_GROUP_PAGE` (100) at a time with a `data-ag-more` button; entry buttons `data-ag-entry` / `data-ag-open`; `data-ag-empty`) and `agendaAction(target)` for the delegated click handler | own state or call the SDK |
| `src/ui/kanban.ts` + `kanban.css` | pure `KanbanLayout` → HTML (toolbar: Columns / Swimlanes menus, Sort segmented with Priority only when the tag has one, hint; one grid `--pl-kb-cols` × `minmax(220px, 1fr)`, `width: max-content` so it scrolls inside the view: `data-kb-column` heads with counts, `data-kb-lane-head`, `data-kb-cell` + `data-kb-col` / `data-kb-lane`, cards `data-kb-card` (draggable unless `data-kb-pending`) with an open button `data-kb-open` and a Move menu `data-kb-move` → `data-kb-to-col` / `data-kb-to-lane`; `KANBAN_CELL_PAGE` (50) cards per cell at a time plus pending / Move-open ones, then `data-kb-more="<cellKey>"`) and `kanbanAction(target)` | own state, call the SDK or write |
| `src/ui/changes.ts` | `createChanges({subscribe, later, refresh})` → `{setVisible, stop}`: `DB.onChanged` is only a wake-up; `DEBOUNCE_MS` (50) trailing debounce, `POLL_MS` (30 s) poll, both only while visible; hidden = mark stale, one refresh on the next show (starts stale, so the first show is the first load); one refresh at a time, an event during one earns one more | read the payload, touch DOM or SDK, use real timers (`Later` is injected) |
| `src/ui/html.ts` | shared HTML helpers: `esc`, `flag`, `viewNav(prefix, label)` (prev / range / next / Today), `segmented`, `toggleButton`, `menu` (trigger + popover, `data-control` / `data-popover`), `options` (listbox of `data-option` buttons) | hold view logic |
| `src/ui/theme.ts` + `theme.css` | host mode → `html.dark`, host tokens → `--pl-*` (`PL_MAP`), Inkwell defaults + base component CSS | call `logseq.*` (gets `ThemeDeps`) |
| `src/core/view-config.ts` | `ViewConfig` (tags/props by ident, closed values by uuid), `defaultViewConfig`, `validateViewConfig`, versioned JSON, `toChoiceFilters` | touch DOM or SDK |
| `src/storage.ts` | `createViewStore(StorageDeps)`: cache-first saved views on the "Planner views" page, config in hidden string property `planner-view-config`; every write read back | call `logseq.*` (deps from `storageDeps()` in sdk.ts) |
| `src/dev-probe.ts` | dev-only SDK hook for `scripts/probe.mjs` (behind `import.meta.env.DEV`) | ship in builds |
| `src/dev-timings.ts` | dev-only `Timing` recorder (`createTimings`, `installTimings` → `window.__plannerTimings`): first load and live refresh, query vs render ms; installed in `src/index.ts` behind `import.meta.env.DEV`, passed as `registerApp`'s third argument → `createWorkspace({timing})`; `src/dev-timings.test.ts` asserts the production bundle lacks it | ship in builds, log, change behaviour |
| `scripts/probe.mjs` | `npm run probe`: live probe → `src/core/__fixtures__/*.json` (docs/probes.md) | run on graphs other than plugin-test / Demo |
| `scripts/seed-large.edn.mjs` | `buildLargeSeed({n, today, seed, propPrefix})` → `{nodes, tasks, edn}`: pure deterministic load-test seed (#Load item, page "Planner load test"), tested in `src/seed-large.test.ts`; `probe.mjs --seed-large [N]` imports it in chunks | use Math.random, run on graphs other than plugin-test / Demo |
| `docs/` | design notes, probe results, `manual-test.md` (T13 live checklist) | — |

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
so tests pass fakes. Every loader test uses `fixtureDq` (`src/ui/test-fakes.ts`): it answers the
exact query strings and cuts the `pull [*]` fixture rows down to what the narrow pulls return
(never hand-written rows).

## Where to look

REQUIREMENTS.md · tasks.md · docs/design.md · docs/probes.md ·
~/.claude/skills/logseq-plugin-dev (standard, runtime gotchas) ·
~/Projects/src/github.com/logseq-query-builder (reference implementation) ·
~/Projects/src/github.com/logseq-inkwell-theme (design system)
