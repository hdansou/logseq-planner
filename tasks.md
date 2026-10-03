# Planner — tasks (v1: workspace)

Requirements: [REQUIREMENTS.md](REQUIREMENTS.md) · Design: [docs/design.md](docs/design.md)
Prototype: https://claude.ai/artifact/KU9Z831Y9y974EUW1yVcud
Started: 2026-10-03 · Status: v1 built; validated in the web app only (see the last log entries)

Rules: one item per change; each item names its acceptance test and the test is written
first (TDD); UI items are accepted on what renders; docs land in the same commit as the
code; `npm run typecheck`, `npm test` and `npm run build` pass at every commit. Commit
subjects are conventional with the item id, e.g. `feat: schema discovery (T02)`.

## Resume here (updated 2026-10-03, end of the third session)

State: every v1 item below (T00–T14) and the performance item T13a are done; so are N02 (as far
as the web app allows) and N03 (a) and (b). 504 unit tests pass at `da5d181` plus the docs commits after it. No remote, nothing pushed.
The full checklist was run in the Logseq WEB app (dev build of the main checkout at
d2ab7726ab, 2026-09-02, in-memory graph); a focused pass was run on the desktop app 2.0.1 nightly
(8ffbb22, 2026-10-01) with the CLI-seeded graph `planner-desktop` (kept for re-runs). docs/manual-test.md: A–I 115 pass, 5 partial, 6 not run; J 15 pass.

Read in this order: this section, "Next" below, then the Progress log entry of whatever
you touch (it records what was verified live, the decisions taken and what was not
verified). docs/manual-test.md is the row-by-row checklist with results.

How the work was run (rules set by the owner):
- One task per sub-agent, on a lower model than the coordinator (Sonnet by default, Opus
  for design-heavy or review work). The coordinator reviews, validates and keeps this file
  current. Sub-agents never edit tasks.md and never claim live behaviour.
- TDD (tests written first and seen failing), DRY, KISS; docs in the same commit; commit
  per item; plain technical writing.
- Nothing is marked done on unit tests alone: every acceptance item is exercised live on
  a test graph, and the result is written in the Progress log.
- The owner approved desktop testing on 2026-10-03: Planner is an unpacked plugin in their
  profile, the graph `planner-desktop` is the desktop test graph. The web app remains the
  quick loop for full checklist runs.

Live-check method (web app):
1. `pnpm watch` in the main `logseq` checkout (web app on :3001; `yarn watch` no longer works).
2. `npm run dev` here (dev server :8293: probe hook and `window.__plannerTimings`).
   For acceptance, build HEAD into a scratch copy and serve it with `vite preview` on :8294:
   the dev server reloads the iframe on every source edit and breaks the plugin's connection.
3. playwright-cli session → create or open the DB graph `plugin-test` → register with
   `LSPluginCore.register({key: "logseq-planner", url: "http://localhost:<port>", webPkg: {…}})`
   (`key` gives a stable id; without it plugin properties look lost after a reload).
4. Seed: `PLANNER_PW_CWD=<playwright session dir> npm run probe -- --seed` (needs the :8293
   build registered); `--seed-large` adds the 2,000-node `#Load item` tag (~105 s). The
   in-memory graph can lose its data on a page reload: check the seed after every reload,
   and `git checkout -- src/core/__fixtures__` after seeding (the probe rewrites fixtures).
5. Drive the UI through the `data-*` hooks with playwright frame locators; read the graph
   with `logseq.api.datascript_query` in the host page; wrap host `logseq.api.*` functions
   to log what the plugin calls. Clean up afterwards: views page (Recycle → Delete),
   `plugin.property.*` idents, test tags.

## Next

- [x] **N01 Desktop validation** — done 2026-10-03 as a focused pass (docs/manual-test.md
      "Desktop pass"): persisted CLI-seeded graph, current build, window-button padding,
      `g Shift+P`, second window, off-screen drag, production timings, saved view across a
      restart. Planner is now an unpacked plugin in the owner's profile (`externals` in
      `~/.logseq/preferences.json`). Left: sync from another device; the full A–J checklist
      on the desktop; refresh at 2,000 nodes is 294–373 ms there (N04).
- [x] **N02 Checklist rows not run** — done 2026-10-03 for every row the web app can cover (see
      the Progress log). Left: A9, E12 and D11 (desktop app or a real mouse: fold into N01), D12
      (Firefox), I9 (VoiceOver); partial E8, E11 (tag deletion, N04), F9, H6, H10.
- [ ] **N03 Owner decisions** —
      (a) done: MIT LICENSE added (6a89ccc).
      (b) done: one lateness rule (771140f). The owner chose "Scheduled or Deadline"; built as:
          due date = Deadline, else Scheduled; an open task is late when its due day is past.
          A past Scheduled date with a future Deadline is not late. Confirm or change.
      (c) open: the "Decisions taken (change if wrong)" lists in the Progress log for T05, T07,
          T08, T09, T10, T11 and T13a (e.g. tick-to-narrow filters, saving always creates a
          new view, no delete confirmation, Month = 8-week window, caps of 50 cards and 100
          groups, Timeline rows only in range).
- [ ] **N04 Known limitations to fix or accept** — deleting a tag triggers no refresh (next
      change or 30 s poll); reopening after a stale hide reloads twice; the Agenda's
      Overdue bucket is not capped (923 entries at 2,000 nodes); refresh at 2,000 nodes ran
      165–254 ms with single runs at 320, and 187–432 ms after a Kanban drag (target 250 ms
      plus the 50 ms debounce); done and canceled rows measure 3.33 / 2.98 contrast in
      Logseq's default light / dark themes (host `--muted-foreground`; Inkwell 4.63 / 4.98);
      the saved-views and Done-when popovers have no arrow-key navigation (Tab works); a task linked to two nodes is listed under the first one in the Agenda by
      node; saved-view writes are not serialised; no auto-restore of a views page in
      Recycle; a band continuing on both sides shows its title mid-row; no CSP.
- [ ] **N05 Release** — screenshots, public repo, v1.0.0, marketplace manifest PR
      (logseq-plugin-release skill). After N01 and N03(a).
- [ ] **N06 Later surfaces (out of v1)** — side panel, in-page block, drag-to-edit dates
      (REQUIREMENTS.md).
- [ ] **N07 Query Builder follow-up (other repo)** — its theme code has the same
      theme-switch race fixed here in 2c90798; not checked there.

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

- [x] **T04 Load nodes and tasks** — `src/core/queries.ts`, `src/core/normalize.ts`. Nodes of
      a tag (+ extending tags) with mapped props; Date and DateTime → local ISO day (+ HH:MM);
      #Task blocks whose refs hit those nodes. Test first: child-tag on/off, both date types,
      DateTime near midnight, task linked by inline ref and by node property. Est: ~45 min

- [x] **T05 Spans, rollups, done, filters** — `src/core/nodes.ts`. Start/end resolution,
      derived spans, points, done/total, done-value guess and override, choice filters.
      Test first: mapped, derived, one-date, no-date, canceled excluded, guess + override.
      Est: ~30 min

- [x] **T06 Saved views** — `src/core/view-config.ts`, `src/storage.ts`. Defaults per tag,
      validation (fail fast on unknown idents), cache-first CRUD on the plugin page as hidden
      string properties (schema ensured before each write; strict page query). Test first
      with a fake SDK: defaults, validation, cache updated before write. Accept: live save /
      reload round trip noted in the progress log. Est: ~40 min

- [x] **T07 Workspace shell** — `src/ui/workspace.ts`. Full-screen recipe; top bar (view
      switch, saved views, close), settings bar (tag, child tags, start, end, done values),
      tag tree, filters, per-view toolbar slot, empty states (no tags, tag without dates,
      no nodes, no matches). Test first (happy-dom): each empty state and the settings bar
      for a fixture schema. Accept: switching tags live updates the bar. Est: ~60 min

- [x] **T08 Timeline** — `src/core/timeline-layout.ts`, `src/ui/timeline.ts`. Week / Month /
      Quarter; rows sorted by start, progress strip, derived dashed, diamonds, expandable
      task rows, today line, clip marks, undated footnote, prev/next/today. Test first:
      layout for all three zooms (week columns in Quarter, clipping, derived, points);
      happy-dom render. Est: ~60 min

- [x] **T09 Calendar** — `src/core/calendar-layout.ts`, `src/ui/calendar.ts`. Month and Week,
      week start, stable lanes, point chips, task deadline chips, time sort and labels in
      Week, "+N more" opens the week. Test first: lanes, week start, time sort; happy-dom
      render of both layouts. Est: ~60 min

- [x] **T10 Agenda** — `src/core/agenda.ts`, `src/ui/agenda.ts`. Buckets (overdue, today,
      14 days, later, no date, earlier), group by node or date, Show done. Test first:
      bucketing, horizon, show-done; happy-dom render. Est: ~40 min

- [x] **T11 Kanban** — `src/core/kanban.ts`, `src/ui/kanban.ts`. Columns + "No", swimlanes +
      "No", sort by due/priority/title, drag → write descriptors (column, lane, removal) →
      injected write; optimistic with rollback. Test first: columns, lanes, sort, cross-lane
      move writes two props, drop on "No" removes, failed write rolls back. Accept: live move
      survives reload. Est: ~60 min

- [x] **T12 Live updates and click** — `src/ui/changes.ts`. Debounced `DB.onChanged` + slow
      poll; keep scroll and expanded rows; click opens node and hides UI, Shift+click opens
      the right sidebar. Test first: debounce and state preservation with fakes. Accept:
      editing a task elsewhere redraws the view. Est: ~30 min

- [x] **T13 Live end-to-end pass** — `docs/manual-test.md`. Four views × #Task, #Project,
      #Meeting, a tag without dates, an empty tag; light and dark; Inkwell and one other
      theme; first-view and redraw timings on a ~2,000-node seed. Accept: checklist passes,
      timings recorded. Est: ~40 min

- [x] **T14 Review and docs** — run code-review and security-audit; README (install, usage,
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
- 2026-10-03 T04 done (fcb82bc). 18 new unit tests (52 total). Live on `plugin-test` (seed
  verified first; modules imported inside the plugin iframe, real `datascriptQuery`,
  browser zone UTC-5): Project with child tags = 4 nodes with the seeded Start/End days,
  Status and Owner; without child tags = 3 (no Acme rollout); Meeting = Kickoff
  2026-10-03 10:30, Late review 2026-10-04 23:45, Untimed meeting with no date; tasks = 5
  with the right node and status (inline ref and node-property link both found, Loose
  task absent); `loadTasks(dq, [])` returns [] and sends no query. The journal-day query
  with a vector input works live.
  Open for the views (T08–T11): a task title linked by inline ref still contains the raw
  `[[uuid]]` (e.g. `Draft brief [[6a00…0001]]`); it must be shown with the node's name.
- 2026-10-03 T05 done (f2bc923). 71 unit tests in total. `PlannerTask` now carries
  `deadline`/`scheduled` (already in the T04 pull). Live on `plugin-test` (seed verified,
  functions run in the plugin iframe on live nodes and tasks): spans Website relaunch
  mapped 09-23 → 10-23, Acme rollout mapped 09-30 → 10-08, Mobile app point 10-08,
  Archive cleanup undated; Kickoff and Late review points with times, Untimed meeting
  undated; derived span from Wireframes' Scheduled (2026-10-09 09:00) on an in-memory
  dateless copy of Mobile app (the seed has no dateless node with tasks); rollups 1/2,
  0/1, 0/1, 0/0; Status: Done and Canceled count as done, only Canceled is canceled;
  Owner values not done, override makes one done; filters by Alice, by no value, and
  empty selection behave as specified.
  Decisions taken in T05 (change here if wrong): derived spans use all linked tasks, done
  and canceled included; a derived span with one date stays `derived`; Start after End
  is passed through; the done override applies to built-in values too. To change in T06:
  the override is a list of value titles, which breaks on rename; store closed-value
  uuids in the saved view instead.
- 2026-10-03 T06 done (4a13ee3, fixes 0a37949, 492929f, 3c50069). 107 unit tests. The done
  override and saved filters use closed-value uuids. Live on `plugin-test`, store driven
  inside the plugin iframe with the real SDK: empty list; create (page "Planner views",
  one block, JSON in the hidden string property `planner-view-config`); update; list from
  a fresh store; second view and remove (block gone); unknown id throws with the cache
  unchanged; full app reload then list returns the view with the same id and zoom.
  Defects found live and fixed: (1) a views page in Recycle still matched the page query
  and new views were written into it; the query now excludes `deleted-at`. (2) With a
  same-titled page in Recycle, `createPage` returns the recycled page and creates nothing,
  so create throws; the error now tells the user to restore or delete it in Recycle. Both
  remedies checked through the Recycle UI: after Restore the old views list and saving
  works; after Delete saving creates a fresh page.
  Method notes: register with `LSPluginCore.register({key: "logseq-planner", …})` for a
  stable id; without `key` the id is random and plugin properties (namespaced by id)
  look lost after a reload. `delete_page` only moves a page to Recycle; permanent delete
  is the Delete button in More → Recycle (native confirm dialog: `playwright-cli
  dialog-accept`). Graph left clean: no views page, no `plugin.property` idents.
  Open: concurrent writes are not serialised; v1 has no auto-restore of a recycled page.
- 2026-10-03 T07 done (9af8e98; fixes 3afa677, b063b35, cbb9339, 09a2898, 9d89c05). 147
  unit tests. Live on `plugin-test` (build served on :8294, driven with playwright frame
  locators; selectors listed in the agent report are `data-*` hooks in workspace.ts):
  toolbar button, command palette and `g` then `Shift+P` open Planner full-screen with
  focus inside; Escape closes a popover first, then Planner; Close hides it. Opens on
  #Meeting. Tag tree and tag menu update the bar (Project, Meeting, Task, Page → no-dates
  state). Child tags 4 ↔ 3 nodes. Filters with counts; no-matches + Clear filters;
  Owner=Alice → 2 nodes, 4 tasks. Done values label updates. View switch keeps settings.
  Saved views: save, switch away, reopen (tag, kind, filters, done values restored),
  delete; stored JSON read back from the graph. Built-in tags collapsed by default
  (filters visible at 720px), auto-expand on a built-in tag, toggle works. 2px focus
  ring. Looks right in default light, Inkwell light and Inkwell dark (screenshots).
  Defects found live and fixed: serif text (host font name without fallback); selected
  rows dark-on-blue in the default theme (`--accent` = `--primary`; tint-soft is now
  derived from the tint); default tag was a child tag; task count ignored filters;
  `[hidden]` overridden by component CSS; views written into a recycled page when it was
  recycled mid-session (append by a remembered uuid succeeds on a recycled page: the
  store now looks up the live page before every write and drops its cache when the page
  is gone).
  Decisions taken in T07 (change if wrong): filters are tick-to-narrow (nothing ticked =
  no filter); saving always creates a new view (no update-in-place); deleting a saved
  view has no confirmation; "no dates" state is skipped in Kanban.
  Open: the left column stops below the last filter instead of running to the bottom of
  the window (fix with the first view, T08); the macOS desktop window-button padding and
  the `g Shift+P` chord are unverified on the desktop app.
- 2026-10-03 T08 done (15963ed, d84b977). 202 unit tests. Live on `plugin-test` (build on
  :8294; positions read from the rendered DOM and checked against the day columns):
  #Meeting opens in Month with diamonds on 3 Oct and 4 Oct, today line on 3 Oct, footnote
  "No dates: Untimed meeting". #Project: Month (13 Sep – 7 Nov, 56 day columns) Website
  relaunch bar 23 Sep → 23 Oct "50%" 1/2, Acme rollout 30 Sep → 8 Oct, Mobile app
  diamond on 8 Oct, footnote Archive cleanup; Week (20 Sep – 10 Oct, 21 columns) Website
  bar clipped at the right with "›"; Quarter (30 Aug – 26 Dec, 17 week columns) bars and
  today line at the right day fractions. Next shows left clips "‹"; far ahead shows the
  "‹ 23 Sep – 23 Oct" hints; Today returns. Expanded task rows: titles show the node
  name instead of the raw `[[uuid]]` (T04 item closed); deadline marker 5 Oct, late
  deadline 2 Oct in red, scheduled ring 9 Oct, "no date" for the others; done greyed,
  canceled struck through. Click on a name, a diamond, an undated name or a task opens
  it and hides Planner; Shift+click on a bar opens it in the right sidebar and Planner
  stays. Zoom is saved with a view and restored. Calendar/Agenda/Kanban keep their
  placeholders with no timeline toolbar. Left column runs to the window bottom (T07
  item closed). Screenshots checked in default light, Inkwell light and Inkwell dark.
  Decisions taken in T08 (change if wrong): Week = 3 weeks of day columns, Month = an
  8-week window (not a calendar month), Quarter = 17 week columns, as in the prototype;
  dates read "23 Sep"; week starts on Sunday (the host's start-of-week preference is not
  read yet; do it in T09); a node outside the range keeps its row with a hint; category
  colour is a hash of the node uuid; an unknown `[[uuid]]` shows "(link)".
  Not verified: Logseq's default dark theme for this view (the profile's dark theme was
  Inkwell); Shift+Enter on a focused bar; the desktop app.
  Method: the seed can vanish on reload; re-seed needs the dev plugin (:8293) registered
  (probe hook), then unregister it and register the :8294 build.
- 2026-10-03 T09 done (89dc9e1, 119c304, 0dc1500; fix 8d4835e). 263 unit tests. Shared
  day arithmetic, labels and category colour moved to `src/core/layout-common.ts`; shared
  HTML helpers to `src/ui/html.ts`. Live on `plugin-test` (each band and chip mapped to
  the day cells it covers in the rendered page): Month "October 2026", 5 week rows from
  27 Sep, outside days shaded, today on 3 Oct; Website relaunch on lane 0 across four
  week rows with continuation marks, ending Fri 23; Acme rollout on lane 1 Wed 30 → Thu
  8 across two rows; chips: late red "12:00 Acme contract" on 2 Oct, "17:00 Draft brief
  Website relaunch" on 5 Oct, "Mobile app" on 8 Oct; no chip for a Scheduled-only task;
  "No dates: Archive cleanup". Prev/Next/Today. Week of 27 Sep and of 4 Oct show the
  same items with time and node lines. #Meeting: Kickoff 10:30 on 3 Oct, Late review
  23:45 on 4 Oct. Click on a band or chip opens it; Shift+click opens in the sidebar.
  Layout is saved with a view; opening a saved view keeps the period on screen.
  "+N more": with three extra #Project nodes added for the check (removed afterwards)
  the three lanes filled, counts were right per day (+3 on 2, 5 and 8 Oct), and "+3
  more" opened Week 27 Sep – 3 Oct with all five bands and focus on Week.
  Week start: host `start-of-week` set to 0 (Monday) through
  `set_current_graph_configs`; after reopening Planner the Calendar ran Mon–Sun from 28
  Sep and the Timeline Month read "14 Sep – 8 Nov 2026"; restored to 6.
  Defect found live and fixed: bands covered the day numbers (and the Week's day
  labels) because the grid's first row collapsed to 0px; the row is now a fixed 28px.
  Screenshots checked in default light and Inkwell dark.
  Decisions taken in T09 (change if wrong): 3 item rows per day in Month, shared by
  bands and chips; done/canceled task chips are shown struck through, not hidden; the
  Timeline and Calendar share one session anchor; "+N more" switches the view's layout
  to Week.
  Polish, not done: a band that continues on both sides shows its title mid-row rather
  than at the left edge.
- 2026-10-03 T10 done (fb9d54c, f9d037d). 313 unit tests. Live on `plugin-test`, no
  defect found. #Project by date: Overdue = Acme contract "due 2 Oct 12:00, 1 day late"
  (red, Acme rollout chip); Today · Sat 3 Oct = Acme rollout, Website relaunch; Mon 5
  Oct = Draft brief Website relaunch; Thu 8 Oct = Mobile app; Fri 9 Oct = Wireframes
  "scheduled 9 Oct 09:00"; No date (folded) = Archive cleanup. Show done adds Ship
  homepage (done) and Survey users (canceled) under No date. By node: Acme rollout
  first (overdue task), Website relaunch 1/2, Mobile app, Archive cleanup, with status
  and owner; Show done adds the two tasks under Website relaunch. #Meeting: Today
  Kickoff 10:30, Tomorrow Late review 23:45, No date Untimed meeting; three groups by
  node. Click opens and hides Planner; Shift+click opens in the sidebar. Group by and
  Show done are saved with a view and restored. Done override: Owner = Alice as done
  hides Website relaunch and Acme rollout by date and keeps their groups (open tasks)
  by node. Empty state: filter Backlog + Backlog as done → "Nothing on the agenda";
  Show done brings Archive cleanup back.
  Decisions taken in T10 (change if wrong): a running span is filed under Today; a
  node is done if any of its choice values is done; with Show done on, done items show
  only within ±14 days or under No date, never under Later; empty buckets (Today
  included) are omitted; canceled counts as done.
  Process note from the agent: the UI tests were written first but only run after the
  UI existed, so they were not seen failing.
- 2026-10-03 T11 done (0d21432, fa75a65; fixes ab9ed41, 4d44aac). 370 unit tests. Live
  on `plugin-test`, every move checked by reading the property back from the graph and
  by logging the host API calls: #Project by Status (Backlog/Todo/Doing/In Review each 1,
  Done/Canceled/No Status 0); Owner swimlanes (Alice 2, Bob 1, No Owner 1); drag
  Doing → Done → Doing = one awaited `upsert_block_property(uuid,
  "logseq.property/status", <entity id>)` each, then read-back and reload, no overlap;
  cross-lane drag = two upserts (status, then `user.property/owner-<suffix>`); drop on No
  Owner = `remove_block_property`, attribute absent; ⋯ Move menu by keyboard and mouse,
  focus back on the card's ⋯; a move survives an app reload. Silent failure (host upsert
  stubbed to do nothing): card back in its column, error "Status of … was not saved as
  Todo (read back differs)…", graph unchanged. Sorts: due, title, and priority on #Task
  (Urgent first). Board config saved with a view. #Page shows the no-choice state.
  Click / Shift+click open. Inkwell dark screenshot checked.
  Defects found live and fixed: (1) removing a built-in Status does not retract it, the
  host sets `:logseq.property/empty-placeholder`; the read-back reported a failure. The
  placeholder is now "no value" in normalisation, filters and the removal read-back.
  (2) Titles that link a node outside the loaded tag showed "(link)" (#Task board);
  missing uuids are now looked up once per load (query run live first).
  Environment notes (web app, not attributed to Planner): the first drag of the session
  raised "SQLITE_ERROR cannot rollback" then "SQLITE_CORRUPT database disk image is
  malformed" from the host and plain host writes failed until the graph was reset; on a
  fresh graph 9 moves with logged calls were clean. Later in a long page session
  `open_in_right_sidebar` returned but showed nothing and the console had "Unexpected
  webworker error"; fine again after a page reload.
  Not verified: dragging to a column scrolled out of view (did not register under
  playwright's dragTo; the Move menu reaches every column); drag starting on the card's
  button in Firefox; the sticky header and Move-menu clipping near the edges.
  Decisions taken in T11 (change if wrong): the last closed value of Priority ranks
  highest; columns and lanes show every closed value regardless of filters; "No <prop>"
  is always shown; a card is done when any of its choice values is done.
- 2026-10-03 T12 done (869508c). 395 unit tests. `src/ui/changes.ts`: `DB.onChanged`
  debounced 100 ms, 30 s poll, both only while visible; hidden = mark stale, refresh
  once on the next open. Click / Shift+click were already done in T08–T11. Live on
  `plugin-test` (host `datascript_query` wrapped to count reloads): a Status set from
  the host moved the Kanban card 138 ms after the write returned; an unrelated block
  edit reloaded data but left the DOM untouched (same nodes); on the Timeline a refresh
  kept the navigated range, the expanded row, the view scroll and the focused filter
  checkbox while the progress went 50% → 100%; the Agenda's unfolded "No date" stayed
  open and its entries updated; with the Tag menu open nothing redrew for 2 s and the
  change appeared on Escape; while hidden, an edit caused 0 reloads and reopening showed
  it; reopening with no edits caused 0 reloads; a tag created from the host appeared in
  the tag tree and disappeared when deleted; 34 s idle and visible produced poll
  reloads with no visible change; ⌘Z in the app after a Planner move put the card back;
  an edit from a second browser tab on the same graph moved the card in the first tab.
  Minor, open: reopening after a stale hide runs two reloads instead of one (second one
  changes nothing). Reopening when not stale no longer re-reads saved views.
  Not verified live: deferral during a drag in progress; sync; a second desktop window;
  reload time at ~2,000 nodes (T13).
- 2026-10-03 T13 in progress. Tooling done (b9d2335, de23c5d, b00b1b7; 414 unit tests):
  `npm run probe -- --seed-large [N]`, dev-only `window.__plannerTimings`,
  docs/manual-test.md. Large seed imported live: 2,000 #Load item nodes + 2,027 tasks
  (1.25 MB EDN) in 105 s; graph then holds 2,000 items and 2,033 tasks.
  Timings on #Load item, web app, DEV build served by the dev server, headless Chrome:
  first load 757 ms (queries 672, render 85) — meets < 1 s. Live refresh after one
  Status edit, excluding the 100 ms debounce: Timeline 661 ms, Calendar 605 ms, Agenda
  774 ms, Kanban 856 ms — MISSES the < 300 ms redraw target. Per query in one refresh:
  tags 5 ms, tag properties 13 ms, nodes `pull [*]` 276 ms (2,000 rows, 1.1 MB), journal
  days 15 ms, tasks 314 ms (2,033 rows, 2.7 MB: every #Task in the graph with nested
  refs). Render: Timeline ~95 ms (1,763 rows, 10.6k elements), Calendar ~35 ms, Agenda
  ~190 ms (19k elements), Kanban ~310 ms (23.7k elements). View switch to paint:
  Timeline 99 ms, Calendar 37 ms, Agenda 165 ms, Kanban 322 ms. A filter click: 19 ms.
  Finding for the product: the Timeline lists every dated node of the tag, so with 2,000
  nodes hundreds of out-of-range rows (hint only) come before the bars in range.
  Next: T13a performance (narrower pulls, tasks limited to the loaded nodes, less DOM
  for the big views), then re-measure and run the checklist.
- 2026-10-03 T13a performance done (8dbdd86, 16b1bcb, 13bdf1d, 8af0486, 97a677c,
  5c5fdc6, 4d45a0b). 431 unit tests. Narrow node and task pulls (journal day pulled
  with the node, tasks bound to the tag's nodes), refresh reads rows alongside the tag
  queries, debounce 50 ms, Timeline renders only rows in range with an
  "N earlier · M later" line whose parts jump to the nearest node, folded Agenda
  buckets render when opened, Agenda by node shows 100 groups + "Show more", Kanban
  cells show 50 cards + "Show more".
  Re-measured live on the same 2,000-node #Load item tag (web app, DEV build, headless
  Chrome): first load 326–350 ms (was 757). `refresh.totalMs` over 5 edits per view:
  Timeline 179–184 with two runs at 260, Calendar 165–169, Agenda 169–179, Kanban
  181–186 (was 605–856). With the 50 ms debounce that is about 215–235 ms from the end
  of the write to the redraw, under the 300 ms target, with occasional runs near 310.
  Render 10–24 ms per view; view switch to paint 13–30 ms; DOM 0.6k–3.9k elements.
  New pull shape confirmed live: a Date property comes back as
  `{"journal-day": 20260102, "id": 2107}`.
  Live on the large tag: Timeline 313 rows, "728 earlier · 722 later"; Later jumps to
  25 Oct – 19 Dec, Earlier to 23 Aug – 17 Oct; Agenda by date renders Overdue 923 and
  the day buckets, Later (774) and No date (776) only when opened; by node 100 groups,
  "Show 100 more of 1,437" → 200; Kanban totals in the headers (Backlog 249, Todo 507,
  Doing 389, In Review 194, Done 554, Canceled 107), 300 cards rendered, "Show 50 more
  of N" adds 50.
  Regression on the small seed after these changes (same DOM readers as T08–T11):
  #Project Timeline, Calendar, Agenda by date and Kanban, and #Meeting Timeline, show
  the same items, positions and counts as recorded for T08–T11.
  Not measured: a production build, the desktop app, a graph where few tasks link the
  tag. The Agenda's Overdue bucket is not capped (923 entries rendered here).
- 2026-10-03 T13 status: tooling, large-seed timings and a regression pass are done as
  recorded above. docs/manual-test.md exists but its Result columns are NOT filled row
  by row yet; the rows marked [new] (#Task in Timeline/Calendar/Agenda, an empty tag
  with and without properties, default dark theme, one non-Inkwell theme) have not been
  run. T13 stays open until that pass is done.
- 2026-10-03 T13 done for the web app. docs/manual-test.md is filled row by row: 100
  pass, 13 partial, 13 not run (each row carries the build it was checked on). Rows run
  for the first time on the current build (code 4d45a0b): #Task in Timeline, Calendar
  and Agenda (deadline/scheduled tasks as points, undated tasks in the footnote, done
  tasks hidden in the Agenda); #Meeting Kanban by Type; #Page and a property-less tag
  ("no date properties", "no choice properties"); an empty tag with properties ("No
  #Empty probe nodes yet" in all four kinds) that leaves the empty state when a node is
  tagged; the shortcut does nothing while editing a block; 720 px wide; a rejecting
  write (error shown, graph unchanged); a slow write (card pending, not draggable, ⋯
  disabled); Logseq's default dark theme on the Timeline; a second theme; week start on
  Wednesday; tab order with a 2px ring on every stop; tag menu by keyboard.
  Finding: deleting a tag (or the tag of the open view) does not trigger a refresh; the
  tag stays listed until the next graph change or the 30 s poll, then Planner falls back
  to the default view with a message. A created tag appears at once.
  Not run (need the desktop app, another browser, a person, or sync): A9, C4.3, D11,
  D12, D14, E12, G5, H8, H12, H13, H14, I9, I10. Partial rows are listed in the doc.
- 2026-10-03 T14 done. README.md and ARCHITECTURE.md written (7b8da2d). Code review
  (opus, read-only) and security audit (sonnet, read-only) run; 17 items fixed test-first
  in f374e10..92ec1d7; 488 unit tests.
  Audit: no HTML injection (every graph string escaped at every sink), no query
  injection from graph data, no unintended writes, no secrets in the tree or history,
  `npm audit` 0 vulnerabilities, dev hooks absent from a production build.
  Defects confirmed live before the fix: a click on a toolbar label reset the view's
  settings (range label: week → month); tags titled "2026 goals" / "true" / ":kw" loaded
  nothing (the host EDN-reads string inputs); a view saved with the suggested name
  "#Project kanban" was tagged #Project by Logseq and appeared as a card; a tagged block
  on a page in Recycle still appeared.
  Fixed (and checked live on 92ec1d7 where marked *): toolbar container no longer acts
  as a view switch*; queries take the tag's entity id*; recycled blocks and pages are
  excluded*; saved-view names are sanitised, checked for tags after writing, and the
  suggestion has no "#"*; strict config shapes; an unreadable saved view is listed
  greyed and deletable*; the action queue cannot stay rejected; only single-value
  choice properties are used; saved views re-listed on every show*; a two-write move
  that fails on the second write puts the first back*; idents with ? + ' etc. accepted;
  null Start/column take defaults once the tag has properties; a refresh owed while
  hidden marks the data stale; dev probe `timings` op and source check; drag state
  cleared on any dragend/drop; a Date value without a journal day is "no value"; a
  failed first load shows the error with Retry; hostile-title regression test; helper
  duplication removed; listeners unhooked on unload.
  Re-measured at 2,000 nodes with the new queries (DEV build): first load 215 ms;
  refresh Calendar 168–174, Kanban 180–191, Agenda 174–178 (one run 249), Timeline 180
  with four runs at 254–302 right after opening. Regression on #Project (Timeline,
  Calendar, Agenda) unchanged.
  Not run live: docs/manual-test.md J3, J7, J10–J14 (same-titled tags, a multi-value
  property, a "Done?" property, late-added properties, drag ended outside the frame, a
  Date value removed in Logseq, Retry after a failed load).
  Left for the owner: no LICENSE file (package.json says MIT); the Agenda calls a task
  with only a past Scheduled date overdue while Timeline/Calendar mark lateness on the
  Deadline only; a task linked to two nodes is listed under the first one in the Agenda
  by node; deleting a tag does not trigger a refresh (next change or 30 s poll); CSP
  not added; nothing validated on the desktop app or a current Logseq build; queries
  that scan on a constant attribute value are untested on a persisted (non in-memory)
  graph.
- 2026-10-03 third session: N03 (a), (b) and N02 (6a89ccc, 771140f, 1670261, 03ffed6, da5d181).
  504 unit tests. Owner decisions: validate on the web app first; lateness counts the
  Scheduled date; add the MIT LICENSE.
  Lateness (771140f): `dueDate` = Deadline, else Scheduled; `isLate` uses it in every view.
  Live (small seed plus four tasks on Website relaunch): Scheduled D-3 only → red ring in the
  Timeline, Overdue "3 days late" in the Agenda, no Calendar chip; the same task Done → not
  late, under Earlier; Scheduled D-2 with Deadline D+3 → not late; Deadline D-2 with
  Scheduled D+1 → red diamond, Overdue "2 days late", late Calendar chip.
  Checklist: C4.3, D14, G5, H8, H12, H13, I10, J3, J7, J10–J15 run and pass; F3, F4, H4, H9,
  I3, I4, I7, I8 moved from partial to pass; F9, H6, H10 re-measured and still partial. The
  notes in docs/manual-test.md hold the numbers and the method of each row.
  Defects found live and fixed (re-checked on da5d181): the settings bar had `aria-label`
  but no role (now `role="group"`, found by role); no reduced-motion rule (46 transitions
  → 0 under `prefers-reduced-motion`); a derived span from one task read "9 Oct 09:00 –
  9 Oct 09:00" (now "9 Oct 09:00 from its tasks" in Timeline and Calendar; a one-day Date
  span reads "23 Sep" there too, as the Agenda already did).
  Findings left open (in N04): done / canceled row contrast in Logseq's default themes;
  refresh times over 250 ms on some runs; popovers without arrow keys.
  Method notes: the in-memory `Demo` graph is accepted by the probe and needs no graph
  creation. `logseq.api.add_tag_property` rejects a valid tag from the host page ("Not a
  valid tag"); `frontend.handler.db_based.property.class_add_property_BANG_(tagId, kw)`
  works in the dev build. sqlite.build takes a property's ident from its map key, so
  `:Done?` gives `:user.property/Done?-…`. A bad `start-of-week` is sanitised by the host
  and leaves an error toast that covers the top right of Planner: dismiss it before
  clicking there. playwright `dragTo` drops at the middle of the target; on a 50-card
  cell that is off screen and another card gets moved: pass `targetPosition`. Theme
  plugins register with an inline manifest (`fetch` of the package.json fails on CORS).
  Not verified: anything on the desktop app or a current Logseq build; D14 / J12 with an
  edit from a second tab (the edit came from the host API in the same page); J13 through
  the Logseq UI; scrolling smoothness.
- 2026-10-03 N01 desktop pass (owner's go-ahead: "let's do it"). Results and method in
  docs/manual-test.md "Desktop pass"; A9 and D11 pass, E12 partial (second window yes, sync
  not run). No defect found. Method: `logseq graph create` + `graph import --type edn` with
  the app closed (`node -e` writes `seedEdn(new Date())` / `buildLargeSeed(N).edn` to a
  file; the large import took 78 s); add the repo path to `externals` in
  `~/.logseq/preferences.json` (backup taken) and `npm run build`; launch the second
  instance on its own port (9344: 9333 was in use by another session); drive the plugin
  frame with playwright `connectOverCDP` from the main checkout's node_modules (frame URL
  contains `logseq-planner`); a second window opens with
  `window.apis.doAction(["openNewWindow", repo])`. The production build has no
  `__plannerTimings`: times were taken from the click or API call to the first DOM
  mutation in the frame.
