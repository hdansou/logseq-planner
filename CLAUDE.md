# Planner

Logseq DB plugin: Timeline, Calendar, Agenda and Kanban views over any tag, in a
workspace under the app header. Read REQUIREMENTS.md, then tasks.md (next unchecked item), then
docs/design.md before changing UI.

## Stack

TypeScript, plain DOM (no UI framework), Vite, Vitest (+ happy-dom per file for DOM tests),
`@logseq/libs` from the `next` dist-tag (floor ^0.3.4). DB graphs only.

## Layout

| Path | Owns | Never does |
|---|---|---|
| `src/index.ts` | entry: imports `@logseq/libs`, hands `appDeps()` to `registerApp` | business logic |
| `src/app.ts` | `registerApp(deps, root)`: creates the workspace (stopped on unload), open (frame + focus retries) / close, the toolbar button toggles (the palette command only opens), Escape order, `g shift+p` binding, deferred registrations, `nodeOpener` (click → `openPage` + hide, Shift → `openInSidebar`), creates `createChanges` with the deferred registrations (first show = `workspace.open()`, later = `refresh()`; `ui:visible:changed` and its own open/close drive visibility) | call `logseq.*` |
| `src/sdk.ts` | every SDK call and typing cast; workspace frame style (`WORKSPACE_FRAME`: starts under the host header, N15); `hostWeekStart()` (`preferredStartOfWeek`, number or numeric string); `changesSdk()` (`DB.onChanged`, cancelable `setTimeout`, `ui:visible:changed`, `beforeunload`); `kanbanWriteDeps()` (`upsertBlockProperty` / `removeBlockProperty` passed through unchanged, `readChoice` = pull by `#uuid` input, `choiceReadQuery`) | DOM rendering inside the frame |
| `src/core/*` | schema, queries, normalisation, spans, layouts, kanban moves | touch DOM or SDK |
| `src/core/schema.ts` | tag tree, date/choice/node props incl. inherited (node props: any cardinality, N12), closed values: `loadTagInfos(dq)` (injected `Dq`) + pure `buildTagInfos`; N14: `mergeTags(tags)` → `ViewTags` (the view's tags in selection order + the choice props every one has, by ident, first tag's order: what filters, Kanban, Done when and Priority read; + the node props any one has, for Depends on), `tagsTitle` ("#A + #B"), `TAG_KEY` (`"@tag"`, the Tag pseudo-property: Tag filter, Tag swimlanes) | call `getTag(title)` (fails by title) |
| `src/core/queries.ts` | `loadNodes` / `loadNodesAndTasks` (injected `Dq`): nodes of the view's tags (N14: their union, the tag ids as one collection input `[?tag ...]`) ± child tags with a narrow pull (`nodesQuery(tags)` / `nodePull`: id, uuid, title, tags + every tag's date/choice idents, `nodePropIdents`; Date idents as `{ident [:db/id :block/journal-day]}`, so no journal-day query), and the #Task blocks that reference a node of the tag (`tasksQuery(dependsOn)`, same tag join, asked together with the nodes); the view's dependency property (N12) is pulled plainly at the end of both pulls (`nodesQuery(tags, dependsOn)`); `readRaw(dq, tags, selected, dependsOn, prev?)` re-asks only stale rows (tag ids compared as a set), `buildData` maps them with `raw.dependsOn`; `loadTitles(dq, uuids)`: one `TITLES_QUERY` (uuid strings as a collection, `(str ?u)`), none when empty | use the SDK, filter/span logic (`nodes.ts`), `pull [*]` |
| `src/core/normalize.ts` | pure raw → `PlannerNode` / `PlannerTask`; each node's view tag (`PlannerNode.tag`, N14: the first selected tag it carries, directly or through a child tag); a task that is itself a loaded node is `isNode`; Date (pulled journal page `journal-day`) / DateTime → local day (+ `HH:MM`) with injected `ZoneOffset`; `choiceValueOf` (only a closed value counts) and `isEmptyPlaceholder` (`:logseq.property/empty-placeholder` = no value, by ident); node `dependsOn` ids and the dependents-are-not-tasks rule in `buildTasks` (N12) | read process TZ outside `systemZone` |
| `src/core/nodes.ts` | pure `resolveSpan` (mapped / point / derived / undated), `rollup`, `isDone` / `isCanceled`, `filterNodes`, `tasksOf` | query, touch DOM or SDK |
| `src/core/display-title.ts` | `displayTitle(title, titles)`: inline `[[uuid]]` refs → the node's title, `(link)` when unknown; `titlesByUuid(nodes)`, `refUuids(titles)`; every view renders titles through it with the workspace's `State.titles` (loaded nodes + `loadTitles` for the rest) | show a raw uuid |
| `src/core/layout-common.ts` | shared by the view layouts: calendar-day arithmetic on UTC midnights (DST-safe), day/month/range formatting, `weekStartFromHost` (Logseq 0–6 Mon–Sun → 0 = Sunday), `categoryOf`, `viewItems(nodes, tasks, datesOf, statusValues)` (span by the node's tag's Start / End + tasks that are not nodes + rollup over all), task state / late / labels, node labels | read the clock or the host |
| `src/core/timeline-layout.ts` | pure Timeline layout: `timelineRange` / `shiftAnchor` per zoom, `layoutTimeline` → columns, rows only for nodes touching the range (bars as track indices: a day, or 15 minutes in the Day zoom (N10, track model at the top of the file); clip flags, points, task markers), `earlier` / `later` counts with the nearest day, undated list, today index (Day: the current time `now`, fractional), `dayFocus` (the track the Day zoom opens at), `links` (N12: dependency uuid → dependent uuid when both have a row) and each row's `dependsOn` titles; `groups` (N14, arranged by tag: rows by tag in selection order, then by date) | read the clock (`today` is injected), duplicate layout-common |
| `src/core/calendar-layout.ts` | pure Calendar layout: `calendarRange` / `shiftCalendarAnchor` (Month = whole weeks of the anchor's month, Week = 7 days), `layoutCalendar` → week rows of days (outside / today / weekend / "+N more" count), bands on lanes stable over the range with continuation flags, point and deadline chips (time-sorted, untimed first) on item rows, `MONTH_SLOTS` per day in Month, undated list | read the clock, duplicate layout-common |
| `src/core/agenda.ts` | pure Agenda layout: `layoutAgenda` files nodes (by span) and linked tasks (Scheduled/Deadline) into buckets (overdue, today, the next 14 days, later, no date, earlier; empty ones omitted) or node groups; done by the view's done values / Status flags, Show done window, `late`, sort by date, time, title; `HORIZON_DAYS` | read the clock (`today` is injected), duplicate layout-common |
| `src/core/kanban.ts` | Kanban model: `layoutKanban` (columns = closed values + "No <prop>", optional lanes + "No <prop>", counts, done columns, cards sorted by due / priority (`priorityProp`, last value highest) / title, pending flag; `hidden` column keys leave out those columns and their cards, `allColumns` keeps them all), `findCell` / `cardCell`, `moveTarget` (any column, hidden ones too), pure `moveDescriptor(card, from, to)` → `PropertyWrite[]` (set or remove; column first, lane second; same cell = none), `movedNode` (optimistic copy), `tagLaneProp(tags)` (N14: Tag swimlanes, one lane per tag, no "No" lane, `lanesReadOnly`; `moveDescriptor` throws across them), `writeMove(KanbanWriteDeps, writes)`: full ident without colon (`writeKey`) + closed value entity id, every write read back, throws on mismatch | pass a uuid, an ident string or a title as the value; trust a write's return value |
| `src/ui/*` | rendering, theme tokens, events | query the graph directly |
| `src/ui/workspace.ts` + `workspace.css` | `createWorkspace(root, {dq, views, onClose, openNode, weekStart, kanban, today?, time?})` (`weekStart()` = host setting, read on every open; `stop()` removes the window resize and narrow-width listeners, called on unload): top bar, settings bar (Tag control "#A + #B"; Start / End for one tag, one **Dates** menu with a row per tag for several (`data-control=dates`, `data-dates-tag` + `data-dates-field`, N14); **Depends on**, `data-control=depends`, N12: a change reloads the data), main area (view toolbar slot, view), then the panel on its right (`aside.pl-panel[data-region=panel]`: tag tree with a checkbox per tag (`data-tag-check`, N14: tick / untick a tag of the view, the last one disabled), filters (a Tag group with two or more tags); N13; `State.panelOpen` per width mode `{wide, narrow}`, session state only, toggled by the settings bar's last button `data-action=toggle-panel`; under 640 px (`NARROW_MEDIA`, `matchMedia` change listener removed by `stop()`) a drawer, `.pl-body[data-panel-mode=drawer]`, closed by `escape()` after a popover and by a click in `main`), empty states; pure `State` → HTML render functions, delegated events, actions queued (`idle()`), errors shown in `[data-region=error]`; renders the Timeline, the Calendar, the Agenda and the Kanban into the view area and toolbar slot (anchor, shared by both and kept when a saved view is opened, and expanded rows are session state; zoom and calendar layout are config); Kanban: column / lane / sort are config, pending moves (`State.pending`) are session state, HTML5 drag events delegated on the root, `move()` = optimistic render → `writeMove` → quiet reload (`fetchData`) whether it worked or not, error to the error bar; `openNode` dep for click / Shift+click; `refresh()` = live quiet reload (week start, tags and the view's rows in one batch, rows read with the shown tags and re-mapped with the new ones, a query re-run only when `readRaw` finds it stale; redraw only if the signature differs, keeps scroll / `details` / focus, defers while a popover is open or a drag runs, never rejects) | call `logseq.*`, hold view-specific layout logic (that is `src/core/*-layout.ts`) |
| `src/ui/timeline.ts` + `timeline.css` | pure `TimelineLayout` → HTML (toolbar with the Arrange control `data-tl-arrange` when two or more tags (N14), group heading rows `data-tl-group`, earlier / later summary `data-tl-outside-summary` with `data-tl-jump` + `data-tl-day` buttons, head, backdrop, rows, task rows, today line, undated footnote) and `timelineAction(target)` for the workspace's delegated click handler; one CSS grid of tracks (`--pl-tl-tracks` × `--pl-tl-track`; Day zoom: width inline from `DAY_TRACK_PX`, `data-tl-start` + `data-tl-scroll-left` for the scroll it opens at, applied by the workspace when the day changes); N12 connectors: `svg[data-tl-links]` (between head and rows) with `path[data-tl-link="<from>:<to>"]`, pure `linkPath(fromRect, toRect, origin)` and the post-render `drawLinks(tl)` (measures bars / points, sets `d`; returns at once without links or while the timeline has no size) | own state or call the SDK |
| `src/ui/calendar.ts` + `calendar.css` | pure `CalendarLayout` → HTML (toolbar, weekday headers in Month, one 7-column grid per week row: day cells spanning all rows, bands and chips at `grid-row: row + 2`, "+N more", undated list) and `calendarAction(target)` for the delegated click handler | own state or call the SDK |
| `src/ui/agenda.ts` + `agenda.css` | pure `AgendaLayout` → HTML (toolbar: Group by Node/Date + Show done toggle; by date a `data-ag-bucket` section per non-empty bucket, Later / No date / Earlier folded `details` (summary `data-ag-fold`) whose entries render only while opened (`AgendaShown.open`, kept in the workspace's `agendaOpen` from the delegated capture `toggle` event); by node a `data-ag-group` section per node with its line and tasks, `AGENDA_GROUP_PAGE` (100) at a time with a `data-ag-more` button; the Overdue bucket renders `AgendaShown.overdue` entries (100 at a time, `data-ag-more="overdue"`); entry buttons `data-ag-entry` / `data-ag-open`; `data-ag-empty`) and `agendaAction(target)` for the delegated click handler | own state or call the SDK |
| `src/ui/kanban.ts` + `kanban.css` | pure `KanbanLayout` → HTML (toolbar: Columns / Show (`data-control=kb-show`, checkboxes `data-kb-show-value`) / Swimlanes menus, Sort segmented with Priority only when the tag has one, hint; one grid `--pl-kb-cols` × `minmax(220px, 1fr)`, `width: max-content` so it scrolls inside the view: `data-kb-column` heads with counts, `data-kb-lane-head`, `data-kb-cell` + `data-kb-col` / `data-kb-lane`, cards `data-kb-card` (draggable unless `data-kb-pending`) with an open button `data-kb-open` and a Move menu `data-kb-move` → `data-kb-to-col` / `data-kb-to-lane`; `KANBAN_CELL_PAGE` (50) cards per cell at a time plus pending / Move-open ones, then `data-kb-more="<cellKey>"`) and `kanbanAction(target)` | own state, call the SDK or write |
| `src/ui/host-keys.ts` | N16: pure `shouldForward(keyLike)` (the rule: skip prevented events and bare navigation keys, keep editing keys in fields) and `installHostKeys(doc, host, {isVisible, focusFrame})`: re-dispatches unused `keydown` / `keyup` on the host document body (host window's `KeyboardEvent`, with `keyCode`), prevents the original when the host did, hands focus back to the frame when the host's focus falls to its body while Planner is visible and the host has focus; `host` null (cross-origin) installs nothing; `hostDocument()` in sdk.ts | call `logseq.*`, forward from a field except non-editing Cmd / Ctrl keys |
| `src/ui/changes.ts` | `createChanges({subscribe, later, refresh})` → `{setVisible, stop}`: `DB.onChanged` is only a wake-up; `DEBOUNCE_MS` (50) trailing debounce, `POLL_MS` (30 s) poll, both only while visible; hidden = mark stale, one refresh on the next show (starts stale, so the first show is the first load); one refresh at a time, an event during one earns one more | read the payload, touch DOM or SDK, use real timers (`Later` is injected) |
| `src/ui/html.ts` | shared HTML helpers: `esc`, `flag`, `viewNav(prefix, label)` (prev / range / next / Today), `segmented`, `toggleButton`, `menu` (trigger + popover, `data-control` / `data-popover`), `options` (listbox of `data-option` buttons), `checkList` (fieldset of checkbox rows: Done when, Kanban Show) | hold view logic |
| `src/ui/theme.ts` + `theme.css` | host mode → `html.dark`, host tokens → `--pl-*` (`PL_MAP`), Inkwell defaults + base component CSS | call `logseq.*` (gets `ThemeDeps`) |
| `src/core/view-config.ts` | `ViewConfig` (tags/props by ident, closed values by uuid; N14: `tags` in selection order, `dates` = Start / End per tag, Timeline `arrange`), `defaultViewConfig(tag | tags)`, `validateViewConfig` → `ViewTags`, `withTags` (tick / untick: keeps what the new tags share), `withKnownTags` (drops gone tags), `withDefaults` (per tag), versioned JSON (`parseViewConfig` gives a stored Kanban config without `hiddenColumns` an empty one; a stored config without `dependsOn` keeps it absent = default rule; a pre-N14 `tag` / `start` / `end` becomes `tags` / `dates`, a Timeline without `arrange` gets "date"), `dependsOnOf` (the dependency property in use: chosen, else the default rule for an absent key — node prop titled like "depends on"; null for None or a gone ident), `toChoiceFilters` | touch DOM or SDK |
| `src/storage.ts` | `createViewStore(StorageDeps)`: cache-first saved views on the "Planner views" page, config in hidden string property `planner-view-config`; every write read back | call `logseq.*` (deps from `storageDeps()` in sdk.ts) |
| `src/dev-probe.ts` | dev-only SDK hook for `scripts/probe.mjs` (behind `import.meta.env.DEV`) | ship in builds |
| `src/dev-timings.ts` | dev-only `Timing` recorder (`createTimings`, `installTimings` → `window.__plannerTimings`): first load and live refresh, query vs render ms; installed in `src/index.ts` behind `import.meta.env.DEV`, passed as `registerApp`'s third argument → `createWorkspace({timing})`; `src/dev-timings.test.ts` asserts the production bundle lacks it | ship in builds, log, change behaviour |
| `scripts/probe.mjs` | `npm run probe`: live probe → `src/core/__fixtures__/*.json` (docs/probes.md) | run on graphs other than plugin-test / Demo |
| `scripts/seed-large.edn.mjs` | `buildLargeSeed({n, today, seed, propPrefix})` → `{nodes, tasks, edn}`: pure deterministic load-test seed (#Load item, page "Planner load test"), tested in `src/seed-large.test.ts`; `probe.mjs --seed-large [N]` imports it in chunks | use Math.random, run on graphs other than plugin-test / Demo |
| `scripts/tracker.mjs` + `tracker-lib.mjs` + `tracker-meta.json` | `npm run tracker`: tasks.md + git log + meta -> `planner-project` graph through the `logseq` CLI; the lib is pure (parse, desired state, EDN for creation, a plan of CLI calls from desired vs current), tested in `scripts/tracker-lib.test.mjs` (vitest includes `scripts/**/*.test.mjs`) | edit tasks.md, touch graphs other than the one named by `--graph` |
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
- Workspace frame: write the container style directly (saved layouts ignore
  `setMainUIInlineStyle` position/size); start it below the host header (`--ls-headbar-height`), never over it:
  the header is the window drag strip (N15).
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
exact query strings (a node query built by `nodesQuery` for any tag list), cuts the `pull [*]`
fixture rows down to what the pull names (never hand-written rows), EDN-reads top-level
string inputs like the host (`hostReadInput`) and models the Recycle clauses.

## Where to look

REQUIREMENTS.md · tasks.md · docs/design.md · docs/probes.md ·
~/.claude/skills/logseq-plugin-dev (standard, runtime gotchas) ·
~/Projects/src/github.com/logseq-query-builder (reference implementation) ·
~/Projects/src/github.com/logseq-inkwell-theme (design system)
