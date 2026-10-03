# Planner — tasks (v1: workspace)

Requirements: [REQUIREMENTS.md](REQUIREMENTS.md) · Design: [docs/design.md](docs/design.md)
Prototype: https://claude.ai/artifact/KU9Z831Y9y974EUW1yVcud
Started: 2026-10-03 · Status: in progress

Rules: one item per change; each item names its acceptance test and the test is written
first (TDD); UI items are accepted on what renders; docs land in the same commit as the
code; `npm run typecheck`, `npm test` and `npm run build` pass at every commit. Commit
subjects are conventional with the item id, e.g. `feat: schema discovery (T02)`.

## v1

- [x] **T00 Scaffold** — standard file set: `package.json` (dev/build/test/typecheck,
      `predev: rm -rf dist`, `vite --port 8293 --strictPort`, preview 8294,
      `logseq.supportsDB`/`supportsDBOnly`), `vite.config.ts` (test config, `publicDir: false`),
      `tsconfig.json`, `index.html`, `icon.svg`, `.gitignore`, `src/index.ts`,
      `src/__sdk_guard__.ts`, `src/types.ts`, `src/sdk.ts`, `CHANGELOG.md`, `README.md`.
      SDK pin checked against `npm view @logseq/libs@next` (0.3.4 on 2026-10-03).
      `main()` minimal, registrations deferred; toolbar button + command palette entry open an
      empty full-screen "Planner"; Escape and a Close button hide it.
      Design (decided, not built): registration lives in `src/app.ts` as
      `registerApp(deps)` with injected `{ registerUIItem, registerCommandPalette,
      provideModel, showMainUI, hideMainUI, defer }`; `src/index.ts` only wires the real SDK.
      No default keybinding yet (pick one in T07 after a collision check, gotcha §33).
      `.gitignore` copied from query-builder. Full-screen container styling waits for T07.
      Test first: `src/app.test.ts` (happy-dom) asserts registrations go through `defer`,
      the open handler calls `showMainUI`, Escape calls `hideMainUI`.
      Accept: loads in the web app on :8293, button opens the empty UI. Est: ~30 min

- [x] **T01 Live probe** — `scripts/probe.mjs`, `docs/probes.md`, `src/core/__fixtures__/*.json`.
      Seed `plugin-test` with #Project (Start/End Date, Status/Owner choice), #Client project
      (extends #Project), #Meeting (DateTime Date, Type choice), tasks referencing projects.
      Record raw shapes: tags + extends, class properties own/inherited with types and closed
      values, tagged nodes with values, `:block/refs` of tasks, Date vs DateTime values,
      `DB.onChanged` payloads (local edit, other window, sync), closed-value write via
      `upsertBlockProperty` (user prop and built-in Status) and whether Undo reverts it.
      Accept: every open question in REQUIREMENTS.md answered in `docs/probes.md`; fixtures
      saved. Est: ~45 min

- [x] **T02 Theme** — `src/ui/theme.ts`: mirror light/dark onto `<html class="dark">`
      (getUserConfigs + onThemeModeChanged); resolve host tokens into `--pl-*` per
      docs/design.md with Inkwell defaults; re-resolve on onThemeChanged; base CSS for the
      component treatments. Test first: mapping from a resolved-values fixture to `--pl-*`
      (shui channels wrapped in hsl, fallbacks, hover ≠ float guard). Accept: empty UI
      matches Inkwell light and dark, and a second theme. Est: ~40 min

- [x] **T03 Schema discovery** — `src/core/schema.ts`. Tags → `TagInfo[]` tree (own vs
      built-in, parent via extends), date props and choice props incl. inherited, closed
      values with built-in done flags. Test first over T01 fixtures: child tag inherits
      parent props; tag without dates has `dateProps: []`. Est: ~30 min

- [ ] **T04 Load nodes and tasks** — `src/core/queries.ts`, `src/core/normalize.ts`. Nodes of
      a tag (+ extending tags) with mapped props; Date and DateTime → local ISO day (+ HH:MM);
      #Task blocks whose refs hit those nodes. Test first: child-tag on/off, both date types,
      DateTime near midnight, task linked by inline ref and by node property. Est: ~45 min

- [ ] **T05 Spans, rollups, done, filters** — `src/core/nodes.ts`. Start/end resolution,
      derived spans, points, done/total, done-value guess and override, choice filters.
      Test first: mapped, derived, one-date, no-date, canceled excluded, guess + override.
      Est: ~30 min

- [ ] **T06 Saved views** — `src/core/view-config.ts`, `src/storage.ts`. Defaults per tag,
      validation (fail fast on unknown idents), cache-first CRUD on the plugin page as hidden
      string properties (schema ensured before each write; strict page query). Test first
      with a fake SDK: defaults, validation, cache updated before write. Accept: live save /
      reload round trip noted in the progress log. Est: ~40 min

- [ ] **T07 Workspace shell** — `src/ui/workspace.ts`. Full-screen recipe; top bar (view
      switch, saved views, close), settings bar (tag, child tags, start, end, done values),
      tag tree, filters, per-view toolbar slot, empty states (no tags, tag without dates,
      no nodes, no matches). Test first (happy-dom): each empty state and the settings bar
      for a fixture schema. Accept: switching tags live updates the bar. Est: ~60 min

- [ ] **T08 Timeline** — `src/core/timeline-layout.ts`, `src/ui/timeline.ts`. Week / Month /
      Quarter; rows sorted by start, progress strip, derived dashed, diamonds, expandable
      task rows, today line, clip marks, undated footnote, prev/next/today. Test first:
      layout for all three zooms (week columns in Quarter, clipping, derived, points);
      happy-dom render. Est: ~60 min

- [ ] **T09 Calendar** — `src/core/calendar-layout.ts`, `src/ui/calendar.ts`. Month and Week,
      week start, stable lanes, point chips, task deadline chips, time sort and labels in
      Week, "+N more" opens the week. Test first: lanes, week start, time sort; happy-dom
      render of both layouts. Est: ~60 min

- [ ] **T10 Agenda** — `src/core/agenda.ts`, `src/ui/agenda.ts`. Buckets (overdue, today,
      14 days, later, no date, earlier), group by node or date, Show done. Test first:
      bucketing, horizon, show-done; happy-dom render. Est: ~40 min

- [ ] **T11 Kanban** — `src/core/kanban.ts`, `src/ui/kanban.ts`. Columns + "No", swimlanes +
      "No", sort by due/priority/title, drag → write descriptors (column, lane, removal) →
      injected write; optimistic with rollback. Test first: columns, lanes, sort, cross-lane
      move writes two props, drop on "No" removes, failed write rolls back. Accept: live move
      survives reload. Est: ~60 min

- [ ] **T12 Live updates and click** — `src/ui/changes.ts`. Debounced `DB.onChanged` + slow
      poll; keep scroll and expanded rows; click opens node and hides UI, Shift+click opens
      the right sidebar. Test first: debounce and state preservation with fakes. Accept:
      editing a task elsewhere redraws the view. Est: ~30 min

- [ ] **T13 Live end-to-end pass** — `docs/manual-test.md`. Four views × #Task, #Project,
      #Meeting, a tag without dates, an empty tag; light and dark; Inkwell and one other
      theme; first-view and redraw timings on a ~2,000-node seed. Accept: checklist passes,
      timings recorded. Est: ~40 min

- [ ] **T14 Review and docs** — run code-review and security-audit; README (install, usage,
      screenshot placeholder), ARCHITECTURE.md (5+ source files by now), CHANGELOG.
      Accept: findings fixed or logged; Status set to done. Est: ~30 min

Total: about 10 hours.

## Progress log

- 2026-10-03 Plan written; views scoped; aligned with the logseq-plugin-dev standard and
  Inkwell design (REQUIREMENTS.md, docs/design.md). Skills refreshed the same day.
- 2026-10-03 Session ended before T00 code. Resume at T00 (design notes above). Working
  rules: TDD, DRY, KISS; document as we go; keep tasks.md current; commit per item.
  Next session develops with sub-agents: one tasks.md item per agent; the main session
  coordinates, reviews each result and keeps tasks.md current.
- 2026-10-03 T00 done (59b7df9). 7 unit tests; typecheck, test, build pass. Built as
  `registerApp(deps, root)`: the root element is injected so tests render without a global
  `#app`. `overrides` for dompurify and lodash-es copied from query-builder (npm audit 0).
  Live in the web app (Demo graph, `LSPluginCore.register` on :8293): toolbar button shows
  and opens the empty Planner, the iframe takes focus, Close and Escape hide it, no console
  errors. The dev server answers on
  `localhost:8293` only, not `127.0.0.1`. The web app now starts with `pnpm watch`.
  Sub-agents run on lower models from T01 on.
- 2026-10-03 T00 re-validated live on the test graph `plugin-test` (web app, separate
  browser session): command palette shows "Planner: open" and Enter opens the Planner with
  the iframe focused; Escape hides it without a click into the iframe; toolbar button
  (real click) opens it; Close hides it. Console: no error from the :8294 build; the one
  error in the session, `[Ready Error] [deferred timeout]`, came from the reloaded :8293 iframe. Rule: every acceptance item is
  exercised live on a test graph before a task is marked done; unit tests alone do not count.
  Run against a build of 59b7df9 served with `vite preview` on :8294, because the dev
  server on :8293 reloads the iframe whenever a source file changes and a reloaded iframe
  no longer answers the toolbar button (seen while T01 edited `src/index.ts`). Live checks
  use a stable build, not a dev server another task is editing under.
- 2026-10-03 T01 done (8a23bc2, 8d0adf2). `npm run probe` drives the SDK inside the plugin
  iframe through a dev-only hook; fixtures in `src/core/__fixtures__/`, answers in
  docs/probes.md. The coordinator re-ran the probe on a fresh page load: same outcomes.
  Findings that bind later tasks (details and fixtures in docs/probes.md):
  - T03: `getTag(title)` returns null and `getTagObjects(title)` throws; use datascript.
    Inherited class properties are not listed on the child tag: walk
    `:logseq.property.class/extends`. Choice = type `default` + closed-value entities.
    Only Todo/Done carry a checkbox state; recognise Canceled by ident.
  - T04: Date value = ref to a journal page (read `journal-day`); DateTime = epoch ms.
    Take date props from the tag's own + inherited properties only (created-at/updated-at
    are datetime too). `[?task :block/refs ?n]` covers inline refs and node properties.
    Fixture idents carry random suffixes: resolve by title in tests.
  - T11: `upsertBlockProperty` resolves null on success and on failure. Write with the full
    ident and the closed value's entity id (or title), then read back. A uuid string or an
    ident string silently clears/blanks the value; an unqualified key creates a plugin
    property.
  - T12: `DB.onChanged` fires for local edits, another tab, the plugin's own writes and
    undo; payload keys are mangled and `txData` is empty, so use it only to re-query.
  Not answered: `DB.onChanged` under sync and from a second desktop window. Not checked on
  the desktop build (the web app checkout is d2ab7726ab, 2026-09-02).
- 2026-10-03 T02 done (6928430, fix 2c90798). 22 unit tests. Live on `plugin-test` (web
  app, builds served with `vite preview`, tokens read inside the iframe with playwright
  `run-code`), themes loaded as real theme plugins and switched with
  `LSPluginCore.selectTheme`: light/dark toggle flips `html.dark` and tokens with no reload;
  Inkwell light and dark resolve all 38 inline tokens (`--ink-*` status colours, system
  font); a second theme's background, text and font come through; back to the default
  theme (`{url: null, mode}` as the picker sends) resets them; no `hsl(#…)`; Close is a
  pill with the tint-soft focus ring.
  Defect found live and fixed: `theme-changed` fires when the host injects the theme
  `<link>`, so a resolve can run before the stylesheet applies and keep the previous
  theme's values (seen: write at 4–10 ms, stylesheet loaded at 10 ms). Tokens are now
  re-resolved at 250 ms and 1 s, last call wins; live, every switch ended on the host's
  values (9 switches). Notes: `--lx-gray-*` come back as ready `hsl()` colours; in this
  build's default dark theme they are absent, so fills use the Inkwell defaults; plugin
  surface there is rgb(0,45,56) (`--background`) against the host body's rgb(0,43,54).
  Query Builder uses the same theme pattern and was not checked for this race.
- 2026-10-03 T03 done (ce9bb92). 12 unit tests over the T01 fixtures (34 total). Live on
  `plugin-test`: `loadTagInfos` imported from the dev server and run inside the plugin
  iframe against the real `logseq.DB.datascriptQuery` returned 20 tags in ~10 ms; Project
  (Start/End date, Status with Todo=false, Done=true, Canceled flagged, Owner Alice|Bob,
  child Client project), Client project (parent Project, same inherited props, text
  property Client not listed), Meeting (Date datetime, Type), Task (built-in, Deadline and
  Scheduled, Status, Priority), Page (no dates); no created-at/updated-at anywhere.
  First live run returned 17 tags and no user tags: the page reload before it had dropped
  the seed. Re-seeded, then it passed. The seed does not reliably survive a reload
  (docs/probes.md corrected); verify the seed before every live check.
