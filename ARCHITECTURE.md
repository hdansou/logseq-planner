# Planner architecture

This document describes the code as built at version 0.1.0 (in development). For what the
plugin does, see [README.md](README.md). For scope, see [REQUIREMENTS.md](REQUIREMENTS.md).
For what was observed live and what was not, see [tasks.md](tasks.md) (progress log),
[docs/probes.md](docs/probes.md) and [docs/manual-test.md](docs/manual-test.md).

## Layers

```
  Logseq host  <--- postMessage RPC --->  plugin iframe (this repo)

  src/index.ts      the only import of @logseq/libs; wires appDeps() into registerApp
        |
  src/app.ts        open / close, Escape, toolbar button, command palette, node opener
        |
  src/sdk.ts        the only SDK boundary: every logseq.* call and typing cast
        |   (deps objects: AppDeps, StorageDeps, KanbanWriteDeps, ChangesSdk, ThemeDeps)
        v
  src/ui/*          DOM rendering and state       src/storage.ts   saved views
        |                                               |
        +-------------------+---------------------------+
                            v
  src/core/*        pure logic: schema, queries, normalise, spans, layouts, moves
                    (no DOM, no SDK)
```

Rules that hold across the tree:

- **Pure core.** `src/core/*` imports neither the DOM nor the SDK. Its tests run in Node.
- **One SDK boundary.** Only `src/sdk.ts` calls `logseq.*`. Every other module receives the
  calls it needs as injected functions. Only `src/index.ts` imports `@logseq/libs`; the other
  files use `/// <reference types="@logseq/libs" />`, because Vitest crashes when a module
  under test imports the SDK.
- **UI renders, core decides.** Layout modules produce data (rows, cells, buckets). Render
  modules in `src/ui/` turn that data into HTML strings. `src/ui/workspace.ts` owns state,
  events and actions.
- **No framework.** The UI is plain DOM: pure state-to-HTML functions plus one delegated
  event listener per kind of event on the root element.

## Module table

| File | Responsibility |
|---|---|
| `src/index.ts` | Entry. Imports the SDK and CSS, calls `registerApp(appDeps(), #app, timing)` inside `logseq.ready`. Installs the dev-only timings and probe hook behind `import.meta.env.DEV`. |
| `src/__sdk_guard__.ts` | Compile-time SDK floor (references `logseq.App.getCurrentRoute`). Never imported at runtime. |
| `src/app.ts` | `registerApp`: creates the workspace and the saved-view store; open and close with focus retries (50, 300, 800 ms); Escape order; `g shift+p` binding (non-editing); deferred toolbar button and command palette registration; `nodeOpener` (click opens the page and hides Planner, Shift+click opens the sidebar); creates `createChanges`. |
| `src/sdk.ts` | The real SDK behind every deps object: `appDeps`, `changesSdk`, `storageDeps`, `kanbanWriteDeps`, `datascriptQuery`, `hostWeekStart`, `pageQuery`, `choiceReadQuery`. Full-screen container style. |
| `src/types.ts` | Shared types and the deps interfaces. No runtime code. |
| `src/storage.ts` | `createViewStore`: cache-first saved views on the "Planner views" page; config in the hidden string property `planner-view-config`; every write read back. |
| `src/dev-probe.ts` | Dev-only message hook that lets `scripts/probe.mjs` call the SDK from inside the iframe. |
| `src/dev-timings.ts` | Dev-only load and refresh timings, exposed as `window.__plannerTimings`. A test checks that the production bundle lacks it. |
| `src/core/schema.ts` | `loadTagInfos(dq)` and pure `buildTagInfos`: tag tree, date and choice properties including inherited ones, closed values. |
| `src/core/queries.ts` | Narrow node and task pulls (`nodesQuery`, `nodePull`, `TASKS_QUERY`), `readRaw`, `buildData`, `loadNodesAndTasks`, `loadTitles`. |
| `src/core/normalize.ts` | Raw rows to `PlannerNode` and `PlannerTask`: Date and DateTime to local day and `HH:MM`; `choiceValueOf`; `isEmptyPlaceholder`. |
| `src/core/nodes.ts` | `resolveSpan`, `rollup`, `isDone`, `isCanceled`, `filterNodes`, `tasksOf`. |
| `src/core/display-title.ts` | `displayTitle`: inline `[[uuid]]` references shown as the node's title, `(link)` when unknown. |
| `src/core/layout-common.ts` | Shared by the layouts: day arithmetic on UTC midnights, formatting, `weekStartFromHost`, `categoryOf`, `viewItems`, task and node labels. |
| `src/core/timeline-layout.ts` | `timelineRange`, `shiftAnchor`, `layoutTimeline`: columns, rows for nodes in range, `earlier` and `later` counts, undated list. |
| `src/core/calendar-layout.ts` | `calendarRange`, `shiftCalendarAnchor`, `layoutCalendar`: week rows, bands on stable lanes, chips, `MONTH_SLOTS`. |
| `src/core/agenda.ts` | `layoutAgenda`: buckets or node groups, done and late logic, sort. |
| `src/core/kanban.ts` | `layoutKanban`, `findCell`, `cardCell`, `moveDescriptor`, `movedNode`, `writeMove` (write and read back). |
| `src/core/view-config.ts` | `ViewConfig`, `defaultViewConfig`, `validateViewConfig`, versioned JSON, `toChoiceFilters`. |
| `src/ui/workspace.ts`, `workspace.css` | `createWorkspace`: state, top bar, settings bar, tag tree, filters, empty states, delegated events, actions queue, Kanban moves, `refresh()`. |
| `src/ui/timeline.ts`, `timeline.css` | Timeline layout to HTML; `timelineAction`. |
| `src/ui/calendar.ts`, `calendar.css` | Calendar layout to HTML; `calendarAction`. |
| `src/ui/agenda.ts`, `agenda.css` | Agenda layout to HTML; `agendaAction`; `AGENDA_GROUP_PAGE` (100). |
| `src/ui/kanban.ts`, `kanban.css` | Kanban layout to HTML; `kanbanAction`; `KANBAN_CELL_PAGE` (50). |
| `src/ui/changes.ts` | `createChanges`: debounce, poll, visibility, one refresh at a time. |
| `src/ui/html.ts` | Shared HTML helpers: `esc`, `flag`, `viewNav`, `segmented`, `toggleButton`, `menu`, `options`. |
| `src/ui/theme.ts`, `theme.css` | `watchTheme`: host mode to `html.dark`, host tokens to `--pl-*`; Inkwell defaults and base component CSS. |
| `src/ui/test-fakes.ts` | Test helpers: `fixtureDq`, `fakeStorage`, `noWrites`, `fakeGraph`, `fakeClock`, `fakeChangeFeed`. Used by tests only. |
| `scripts/probe.mjs` | `npm run probe`: live probe, seeds and timings through playwright-cli. Writes fixtures to `src/core/__fixtures__/`. |
| `scripts/seed.edn.mjs`, `scripts/seed-large.edn.mjs` | Small and large (`buildLargeSeed`, deterministic) seed graphs. |
| `src/core/__fixtures__/*.json` | Raw probe output that core tests run against. |

Each module has a co-located `*.test.ts`, except `src/index.ts`, `src/types.ts`,
`src/__sdk_guard__.ts`, `src/dev-probe.ts`, `src/ui/html.ts` and `src/ui/test-fakes.ts`.

## Data flow

```
 open
  |
  v
 weekStart()  +  loadTagInfos(dq)            schema: tags, date props, choice props
  |                                          (walks :logseq.property.class/extends)
  v
 views.list()                                saved views (cache-first)
  |
  v
 config = current or defaultViewConfig(initialTag)     validateViewConfig(config, tags)
  |
  v
 readRaw(dq, tags, tag)                      nodes (narrow pull) + #Task refs, asked together
  |
  v
 buildData -> normalize                      PlannerNode[] / PlannerTask[], local days
  |
  v
 loadTitles for [[uuid]] refs not loaded     one query, none when nothing is missing
  |
  v
 filterNodes, resolveSpan, rollup            per-view inputs (nodes.ts, layout-common.ts)
  |
  v
 layoutTimeline | layoutCalendar | layoutAgenda | layoutKanban     pure, `today` injected
  |
  v
 renderTimeline | ... -> HTML string -> root.innerHTML
```

Steps, with the module that does each:

1. **Open.** `app.ts` calls `workspace.open()` on the first show (`changes.ts` starts stale,
   so the first show is the first load).
2. **Schema.** `loadTagInfos` runs two queries (`TAGS_QUERY`, `TAG_PROPERTIES_QUERY`) and
   builds the tag tree. Inherited properties are not listed on a child tag by Logseq, so the
   builder walks `extends`. Planner reads tags by datascript, not `getTag(title)`.
3. **Config.** The workspace keeps one `ViewConfig`. If none exists, the default for the first
   own root tag with date properties is used.
4. **Nodes and tasks.** `readRaw` asks for the tag's nodes, with the child tags if enabled,
   and for the #Task blocks that reference those nodes. Both pulls name their attributes: id,
   uuid, title, tags and the Date, DateTime and choice idents of the graph's tags. A Date
   value is pulled with its journal day (`{ident [:db/id :block/journal-day]}`).
5. **Normalise.** `buildData` maps raw rows. A Date becomes a local `YYYY-MM-DD`. A DateTime
   (epoch ms) becomes a local day and `HH:MM` through an injected zone offset. A choice value
   counts only when it is a closed value of that property. The empty placeholder is no value.
6. **Titles.** Titles with `[[uuid]]` are resolved from the loaded nodes; `loadTitles` looks up
   the rest in one query.
7. **Layout.** The view's pure layout function receives the nodes, tasks, config, week start
   and `today`, and returns data only.
8. **Render.** The view's render function turns the layout into HTML. The workspace writes it
   into the view area and the toolbar slot, then restores focus.

## Refresh path

`src/ui/changes.ts` decides when to refresh. `Workspace.refresh()` does the work.

- `DB.onChanged` is only a wake-up. Its payload is not read (`txData` is empty and the keys
  are mangled, per docs/probes.md).
- A trailing debounce of `DEBOUNCE_MS` (50 ms) follows the last event.
- A poll runs every `POLL_MS` (30 s) while visible. Hidden iframes throttle timers, so events
  and the debounce can be late. The poll is the safety net for sync, which is untested.
- Visibility comes from `ui:visible:changed` and from Planner's own open and close. While
  hidden, no timer runs. A change marks the data stale, and the next show refreshes once.
- One refresh runs at a time. An event that arrives during a refresh earns exactly one more.
- `Workspace.refresh()` queues a `reload`. It reads week start, tags and the view's rows in
  one batch, then maps the rows with the new tags. It asks a query again only when
  `readRaw` finds the rows stale (a pulled property ident changed, or the tag was renamed).
- It compares a JSON signature of tags, nodes, tasks, titles, week start and today with what
  is shown. Equal means no redraw. Different means a redraw that keeps scroll, expanded
  rows, `details` state and focus.
- When a menu is open, a Kanban write is pending or a card is being dragged, the result is
  dropped and asked again once the workspace is free.
- When the view's tag or a property it uses is gone, the workspace shows the default view and
  an error message.
- The workspace queue runs actions in order. Errors from a refresh show in the error bar and
  never reject.

## Write paths

Planner writes in two places. Both read back, because the host's write API resolves `null`
whether the write worked or not (observed live, docs/probes.md).

**Saved views** (`src/storage.ts`, deps from `storageDeps()`):

1. Look up the live page "Planner views" by title and Page class, excluding pages with
   `deleted-at`.
2. Create the page when it is missing. If creation yields a recycled page, throw an error that
   points to Recycle.
3. Ensure the config property: create it hidden as a string when missing, hide it when it
   exists unhidden, change nothing otherwise. This runs before every write.
4. Append a block, or set the property on an existing block.
5. Read the block back and throw when it differs.

The cache is updated before the write. The store looks the page up
again before every write and drops its cache when the page is gone.

**Kanban move** (`src/core/kanban.ts` `writeMove`, deps from `kanbanWriteDeps()`):

1. `moveDescriptor(card, from, to)` returns `PropertyWrite[]`: set or remove, column first,
   lane second. The same cell returns none.
2. `writeMove` sends each write with the full ident without the colon and the closed value's
   entity id. A uuid or an ident string as the value would silently blank the value.
3. It reads the value back by pulling `[:block/uuid {ident [:db/id :db/ident]}]` for the node.
4. A mismatch throws. Removal accepts an absent attribute or the
   `:logseq.property/empty-placeholder` entity, which the host sets when it clears a built-in
   property.
5. The workspace shows the move at once (`State.pending`), runs `writeMove`, then reloads
   from the graph whether the write worked or not. A failed write puts the card back and
   shows the error.

## State: workspace or saved view

| Kept in | What |
|---|---|
| `ViewConfig` (saved with a view) | tag, child tags on or off, Start, End, done values, filters; Timeline zoom; Calendar layout; Agenda group by and show done; Kanban column property, swimlane property, sort. Tags and properties by ident, closed values by uuid (entity ids differ per device). Versioned JSON (`v: 1`). |
| Workspace `State`, session only | loaded tags, nodes, tasks and titles; saved views; the open popover and error; anchor day (shared by Timeline and Calendar, kept when a saved view opens); expanded Timeline rows; unfolded Agenda buckets and the Agenda group count; Kanban cards shown per cell; pending moves; the card whose Move menu is open; week start; whether the built-in tag group is open. |
| `src/storage.ts` cache | the saved-view list. |

## Dependency-injection seams

Tests pass fakes through these seams. No module under test imports the SDK.

| Seam | Type | Real implementation | Test fake |
|---|---|---|---|
| Host registration, node opening | `AppDeps` | `appDeps()` | `fakeDeps` in `src/app.test.ts` |
| Datascript queries | `Dq` | `datascriptQuery` | `fixtureDq` (answers the exact query strings from the probe fixtures, cutting `pull [*]` rows down to what the narrow pulls return) |
| Saved views | `StorageDeps` | `storageDeps()` | `fakeStorage` |
| Kanban writes | `KanbanWriteDeps` | `kanbanWriteDeps()` | `noWrites`, inline fakes |
| Live updates | `ChangesSdk`, `Later` | `changesSdk()` | `fakeChangeFeed`, `fakeClock` |
| Theme | `ThemeDeps` | `appDeps().theme` | `fakeTheme` in `src/ui/theme.test.ts` |
| Today, zone | `today` argument, `ZoneOffset` | the clock and the machine zone | fixed values |
| Timing | `Timing` | `src/dev-timings.ts` | inline recorder in `src/ui/timing.test.ts` |

## Dev-only hooks

Both are loaded in `src/index.ts` behind `import.meta.env.DEV`, so Vite drops them from the
production bundle.

- `src/dev-probe.ts`: a `window.postMessage` protocol (`call`, `listen`, `events`, `timings`)
  that `scripts/probe.mjs` uses to call the SDK from inside the iframe.
- `src/dev-timings.ts`: records the first load and each live refresh, split into query and
  render time. Read it with `npm run probe -- --timings`.

## Design decisions

Each decision names the finding that motivated it. All findings are from the live passes
recorded in tasks.md.

| Decision | Reason |
|---|---|
| Read back every write (`storage.ts`, `writeMove`). | `upsertBlockProperty` resolves `null` on success and on failure (T01). A uuid or ident string as a value silently clears it. |
| Kanban writes use the full ident without the colon and the closed value's entity id. | These forms worked live. An unqualified key created a plugin property (T01). |
| The empty placeholder (`:logseq.property/empty-placeholder`) means "no value" in normalisation, filters and the removal read-back. | Removing a built-in Status does not retract it; the host sets the placeholder. The read-back first reported that as a failure (T11). |
| Look up the live "Planner views" page before every write and exclude `deleted-at`. | A page in Recycle still matched the page query, and the host appended into it without error (T06, T07). A same-titled recycled page makes `createPage` return it and create nothing, so the error names Recycle. |
| Re-resolve theme tokens at 250 ms and 1 s after a theme change; the last call wins. | `theme-changed` fires when the host injects the stylesheet, so a first resolve can keep the previous theme's values (T02). |
| Tint-soft derives from `--pl-tint`, never from the host's `--accent`. | The default theme sets `--accent` equal to `--primary`, which made selected rows unreadable (T07). |
| A rule `[hidden] { display: none !important }` in the base CSS. | Component CSS overrode `[hidden]`, so the collapsed built-in tag group showed (T07). |
| `--pl-font` appends a generic fallback stack. | A host webfont does not load in the frame, and the text rendered in serif (T07). |
| Narrow pulls named attribute by attribute, and tasks bound to the tag's nodes. | `pull [*]` over 2,000 nodes and every #Task in the graph made a refresh 605 to 856 ms; narrow pulls brought it to about 165 to 186 ms (T13a). Nodes pull the journal day inline, so no separate journal-day query. |
| Timeline builds rows only for nodes in range and counts the rest. Agenda renders folded buckets when opened. Kanban cells and Agenda node groups are paged. | At 2,000 nodes the out-of-range rows and large views made most of the DOM (T13a). |
| Debounce `DB.onChanged` and poll every 30 s while visible. | Hidden iframes throttle timers. `DB.onChanged` fires for local edits, other tabs, the plugin's own writes and undo, but its payload is unusable (T01, T12). |
| `DB.onChanged` is a wake-up only. | `txData` is empty and payload keys are mangled (T01). |
| Write the full-screen container style directly, with `setMainUIInlineStyle` as the fallback. | A persisted layout makes the host ignore position and size keys. The container is reachable only when the frame is same-origin; the dev server and web app are cross-origin (CLAUDE.md, `src/sdk.ts`). |
| Defer registrations with `setTimeout(…, 0)` and keep `main()` minimal. | Registrations must not delay the ready handshake (host gotcha §18, cited in CLAUDE.md and `src/index.ts`). |
| Fail fast: a missing or invalid week start, an unknown ident in a saved view and a Date value without a journal day throw. | Project rule: no fallback that hides invalid state. |
| Saved filters and done values store closed-value uuids. | Titles break on rename, and entity ids differ per device (T05, T06). |
| Planner never creates or edits properties on a user's tags. | Users' schemas are theirs (REQUIREMENTS.md). |

## Files not described here

`docs/design.md` covers colors, tokens and component treatments. `docs/probes.md` records the
raw API shapes and the fixtures. `docs/manual-test.md` is the live checklist.
