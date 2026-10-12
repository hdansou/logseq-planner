# Planner — tasks (v1: workspace)

Requirements: [REQUIREMENTS.md](REQUIREMENTS.md) · Design: [docs/design.md](docs/design.md)
Prototype: https://claude.ai/artifact/KU9Z831Y9y974EUW1yVcud
Started: 2026-10-03 · Status: v1 built; validated in the web app only (see the last log entries)

Rules: one item per change; each item names its acceptance test and the test is written
first (TDD); UI items are accepted on what renders; docs land in the same commit as the
code; `npm run typecheck`, `npm test` and `npm run build` pass at every commit. Commit
subjects are conventional with the item id, e.g. `feat: schema discovery (T02)`.

## Resume here (updated 2026-10-05, end of the session of 2026-10-04)

State: everything is done except N34 part 1 (the owner's own try of the current build) and
N05 (the release, on the owner's go-ahead). 1008 unit tests pass at `f71adad` plus the docs
commits after it. No remote, nothing pushed. Upstream reports filed: logseq/db-test#1399
(CLI writes leave `:block/refs` empty) and #1400 (`createJournalPage("YYYY-MM-DD")` a day
early west of UTC); watch them for replies.
What the session of 2026-10-04 added: curved connectors (N20), saved-view Update and delete
confirmation (N23), per-graph remembered state (N21), arrow keys in popovers (N29), a
shared task under each node in the Agenda (N30), a CSP on the built page (N33), and a pass
on the stable Logseq.app with real mouse input (N19) that found and fixed three bugs
there (sidebar handle drag, Date edits, "[object Object]"). The owner's decisions (N03,
N25-N33) are recorded on each item.
Checked where: the full checklist in the Logseq WEB app (dev build d2ab7726ab); focused
passes on the desktop nightly (8ffbb22) and on the stable Logseq.app (b09316a): see
docs/manual-test.md, "Stable app pass". The owner uses both desktop apps. Test graph
`planner-desktop` (kept; modified by the passes). The `logseq` CLI follows whichever app
started last: `npm run tracker` may need `--revision <rev>`.

Read in this order: this section, "Next" below, then the Progress log entry of whatever
you touch (it records what was verified live, the decisions taken and what was not
verified). docs/manual-test.md is the row-by-row checklist with results.

How the work was run (rules set by the owner):
- One task per sub-agent, on a lower model than the coordinator (Sonnet by default, Opus
  for design-heavy or review work). The coordinator reviews, validates and keeps this file
  current. Sub-agents never edit tasks.md and never claim live behaviour.
- Dependencies between tasks are order constraints only: independent tasks may run in
  parallel (parallel sub-agents on isolated worktrees or disjoint files).
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
- [x] **N03 Owner decisions** —
      (a) done: MIT LICENSE added (6a89ccc).
      (b) done: one lateness rule (771140f). The owner chose "Scheduled or Deadline"; built as:
          due date = Deadline, else Scheduled; an open task is late when its due day is past.
          A past Scheduled date with a future Deadline is not late. Confirm or change.
      (c) done 2026-10-04: the owner confirmed the lateness rule (b) and every "Decisions
          taken" list in the Progress log for T05, T07, T08, T09, T10, T11 and T13a, except
          two from T07: saving always creating a new view, and deleting without a
          confirmation. Both changed in N23.
- [x] **N04 Known limitations to fix or accept** — split on 2026-10-04 into one item each,
      N25-N33 below (one tasks.md item per change). Already fixed under N04: the Agenda's
      Overdue bucket is capped at 100 per page (20a8892); saved-view writes run one at a
      time (the store's promise queue). Each new item carries a recommendation; the owner
      decides fix or accept.
- [x] **N25 Deleting a tag triggers no refresh** — the view updates on the next change or
      the 30 s poll. Accepted by the owner on 2026-10-04; stays in the README's known limits.
- [x] **N26 Reopening after a stale hide reloads twice** — closed 2026-10-04: not reproduced on the
      stable desktop app. Counting the plugin's queries from the host: reopening after a
      change made while hidden ran one burst of 5 queries (one reload) and nothing in the
      next 6 s, twice; without a change, 1 query (the saved views). Earlier unit tests
      agree. The "two reloads" were seen in the web app only (manual-test A7, E6).
- [x] **N27 Refresh time at 2,000 nodes** — 165-254 ms with single runs at 320, and
      187-432 ms after a Kanban drag (target 250 ms plus the 50 ms debounce); DEV build,
      web app. Accepted by the owner on 2026-10-04 for 1.0 (a production build is still to be measured); stays in the README's known limits.
- [x] **N28 Done and canceled rows have low contrast in Logseq's default themes** — already fixed before the split (7b84fd8, the `--pl-label-done` token):
      done titles measure 7.61 in Logseq's default light, 6.11 in default dark and 6.94 in
      Inkwell dark (manual-test F9). The N04 list was stale; nothing to do.
- [x] **N29 Arrow keys in the saved-views and Done-when popovers** — done 2026-10-04: Arrow Up / Down
      walk the buttons, checkboxes and fields of the saved-views, Done-when and Kanban Show
      popovers in order and wrap; a saved view's × is skipped (Tab reaches it; from a ×,
      Down goes to the next row, Up to its own). Listbox popovers keep their own handling.
      `src/ui/popover-keys.test.ts`. Unit tests only.
- [x] **N30 A task linked to two nodes is listed under the first only** (Agenda by node) —
      done 2026-10-04, the owner's decision: by node the task is listed under each node it
      links, and counts as open in each; within one nested parent's group it is listed
      once; by date it stays one entry, under the first node. Unit tests only.
- [x] **N31 A "Planner views" page in Recycle is not restored automatically** — the error
      says where it is. Accepted by the owner on 2026-10-04; stays in the README's known limits.
- [x] **N32 A Calendar band continuing on both sides shows its title mid-row** — fixed before the split (2026-10-04 follow-ups) and seen live on
      2026-10-04 (stable app): "‹" at 5 px, the title at 15 px, "›" at the right end.
- [x] **N33 No Content-Security-Policy on the plugin page** — done 2026-10-04 (f71adad): the built
      page carries `default-src 'none'; script-src 'self'; style-src 'self'
      'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self';
      base-uri 'none'; form-action 'none'`, added at build time only (vite.config.ts), so
      the dev server is untouched. Live on the stable desktop app (lsp:// origin, which
      unpacked and marketplace installs share): no violation, all four views, a popover,
      docking and real date edits work; `new Function` in the SDK is not reached. Not
      checked: a plugin served to the Logseq web app.
- [x] **N24 Test memory: N21's workspace tests in their own file** — done 2026-10-04.
      happy-dom 20.14.5 keeps memory for every tree replaced through `innerHTML` (a probe
      re-rendering 2,000 rows 150 times ran out of a 4 GB heap), so
      `src/ui/workspace.test.ts` retains about 1.9 GB by its last test and a worker
      sometimes died ("Worker exited unexpectedly") once N21 added seven tests there. They
      moved to `src/ui/workspace-prefs.test.ts` (a fresh worker); `stop()` now also
      removes the document's dragend / drop listeners, and the test files stop their
      workspaces after each test. Seven full runs in a row passed. Left: the big file is
      still near the limit; split it further or try a newer happy-dom when it grows.
- [x] **N08 Kanban: choose which columns show** — owner request 2026-10-03 ("we may only
      want to show TODO, Doing and Done"). A "Show" control in the Kanban toolbar, after
      Columns: a checkbox per value of the column property, in order, plus "No <prop>"; the
      button reads "All" or "3 of 7". Unticked columns and their cards leave the board. At
      least one column stays shown. Stored in the view config per column property
      (`hiddenColumns: {propIdent: [value uuid | "none"]}`), saved with the view; a saved
      view without the key loads with nothing hidden; unknown uuids are ignored. The Move
      menu still lists every value (moving a card to a hidden column takes it off the
      board). Lane counts count the cards shown. Swimlane values are not selectable (later
      if asked). Acceptance: unit tests first (config default / validation / migration,
      board model, toolbar markup, toggle handling, last-column guard); live: hide Backlog,
      In Review, Canceled and No Status on #Project → three columns, cards of hidden
      columns gone, counts right; save, reopen the view; switch the column property and
      back; real mouse clicks on the desktop app.
- [x] **N09 Project tracker graph** — owner request 2026-10-03: replicate this task list in
      a Logseq graph (`planner-project`) as real example data for Planner. tasks.md stays
      the source of truth; the graph is a copy, refreshed by `npm run tracker` after each
      task. One #Project (Planner), #Milestone nodes, one #Task per item here (id in the
      title, Status from the checkbox, Scheduled from the first commit that names the id,
      Start / End as DateTime = first / last commit time, so work is tracked in hours),
      Owner (Danzu, Claude) and Team (Product, Dev, QA, Security, Docs) choice properties;
      sub-agents are recorded by team, not as named people. Acceptance: script tests
      (parse, mapping, plan of CLI calls); live: the graph shows in Planner's four views on
      #Milestone and #Task, a second run changes nothing, a status change here shows after
      a re-run with the app open.
- [x] **N10 Hours in the Timeline (Day zoom)** — owner note 2026-10-03: DateTime is a
      supported property type, so work can be tracked in hours. Today the Timeline lays
      everything out on day tracks (DateTime keeps HH:MM for labels only) and REQUIREMENTS
      lists "calendar day view and hour grid" as out of scope. Add a "Day" zoom to the
      Timeline: one day, one column per hour; a span with DateTime ends is placed by its
      times, a Date-only span covers the whole day; task markers sit at their hour; Prev /
      Next step one day. Design first (range model is day-based: `TimelineRange`, `place`,
      `indexOn`), then TDD. Acceptance on the tracker graph (N09), whose work all falls on
      one day: milestones and tasks show as bars across the hours they took. Start after
      N09 lands.
- [x] **N11 Tracker: planned schedule, 2 hours per task** — owner request 2026-10-03 for the
      demo graph: every task gets 2 hours and starts after the task it depends on. Owner
      decisions: working hours (weekdays 09:00–17:00; a task that would pass 17:00
      continues the next working day at 09:00); back-dated start so the finished work ends
      about now; default dependency = the previous task. Order: tasks with commits by their
      first commit, then the rest by id. Fixed `scheduleStart` in
      `scripts/tracker-meta.json` (2026-09-25T15:00 local: 21 started tasks end Fri 2 Oct
      17:00, open tasks follow from Mon 5 Oct 09:00); `after` overrides per task. Graph:
      Start / End / Scheduled from the schedule (commit times only order the tasks and set
      Doing), a `depends_on` node property (the owner chose this exact title), milestone Start / End from their tasks.
      Clarified by the owner the same day: dependencies must not force sequential
      execution. Real dependencies are recorded per task (`after`); tasks with none between
      them overlap; `scheduleStart` is set so the started work ends Fri 2 Oct 17:00.
      Acceptance: unit tests for the scheduler; live: Timeline Week and Day on #Milestone
      and #Task show parallel bars across working days, a second run plans nothing.
- [x] **N12 Dependency connectors in the Timeline** — owner request 2026-10-03: use
      `depends_on` to draw a line from a task to the task that depends on it (T07 → T09).
      A "Depends on" setting in the Timeline picks one of the tag's node properties (default:
      the one titled like "depends on" / `depends_on`, else None), saved with the view. For
      every node whose dependency is also on screen, a connector runs from the end of the
      dependency's bar to the start of the node's bar, in every zoom. A node that points to
      another through that property is its dependent, not one of its tasks: it leaves the
      rollup ("4 of 4 done" on T07 today) and the expandable task rows. Acceptance: unit
      tests (schema: node properties; config; links in the layout; the path geometry; the
      rollup exclusion); live on `planner-project`: #Task Week and Day show T07 → T08–T11,
      T08–T11 → T12, and the counts no longer include dependents.
- [x] **N13 Move the tag and filter panel to the right** — owner request 2026-10-03, logged
      and scoped, not started. Reason: Planner will also run in Logseq's right sidebar
      (N06), where a panel on the left of the view makes no sense; do the move now so the
      workspace and the sidebar surface share one layout: view on the left, panel (tag
      tree, filters) on the right.
      Scope:
      (1) Layout: `.pl-body` becomes view then panel (`1fr 220px`); the `aside` moves after
          `main` in the DOM so reading and Tab order match what is seen (top bar, settings
          bar, view toolbar, view, panel); its border moves to its left edge. Rename the
          region from "sidebar" to "panel" in code, hooks and docs (`data-region`, the
          `--pl-sidebar` token), so "sidebar" only means Logseq's right sidebar from now on.
      (2) Collapse: a toggle in the settings bar hides and shows the panel (the view takes
          the full width); the state is kept per graph with the plugin's other state, not in
          the view config. Needed for the narrow sidebar surface and useful in the
          workspace. Filters that are active while the panel is hidden show as a count on
          the toggle.
      (3) Narrow widths: below a set width (about 640 px, the future sidebar surface) the
          panel opens over the view as a drawer from the right and closes on Escape or an
          outside click; nothing overlaps at 200% zoom (checklist row I10).
      (4) Unchanged: the Timeline's sticky label column stays on the left of the grid; the
          macOS window-button padding; the Close button; popovers near the right edge
          (Saved views, the Kanban Move menu) must still fit next to or over the panel.
      (5) Out of scope here: rendering Planner inside Logseq's right sidebar (N06); making
          the panel resizable; moving the settings bar.
      Acceptance: unit tests for the markup order, the toggle (state, focus, aria-expanded,
      active-filter count), the drawer mode; docs (REQUIREMENTS, README, docs/design.md,
      docs/manual-test.md rows that name the left sidebar); live on the desktop app with
      real clicks: all four views, both themes, keyboard order, the panel toggle, a narrow
      window.
      Owner said "go" on 2026-10-03 with the coordinator's defaults: the panel is open by
      default in the workspace and closed by default at narrow widths (drawer); the tag
      tree stays in the panel.
- [x] **N14 Views over more than one tag** — owner request 2026-10-03, logged and scoped,
      not started. Example: #Milestone and #Task in one view. Today a view has one tag (plus
      the tags that extend it); dates, filters, Kanban columns and "Depends on" all come
      from that tag's properties.
      Scope, in two steps:
      Step 1, union of tags.
      (1) Selection: the tag list and the Tag menu allow more than one tag (a tick per tag
          row; a plain click still switches to one tag). The Tag control reads
          "#Milestone + #Task". A node carrying two selected tags shows once.
      (2) Dates: Start / End are mapped per tag, each with its own default rule (Milestone:
          Start / End; Task: Start / End or Scheduled / Deadline). The settings bar gets one
          "Dates" control with a row per tag.
      (3) Shared properties: filters, Kanban Columns / Swimlanes, Done when and Depends on
          offer the properties every selected tag has (same property, not same title).
          A node of a tag without the Kanban column property cannot occur under this rule.
          New: a "Tag" filter group and a Tag swimlane, so one tag can be hidden or laned.
      (4) Views: Timeline, Calendar, Agenda and Kanban show the union. The Timeline can
          group rows by tag (a heading row per tag) or list them by date.
      (5) Config: `tag` becomes `tags` with per-tag dates; saved views with one tag load
          unchanged (same handling as the other added keys).
      Step 2, parents and children.
      (6) When a selected tag's node references a node of another selected tag (a task that
          points to its milestone), the Timeline can nest it under that node as a full row
          with its own bar, in place of today's marker-only task row; the rollup on the
          parent stays. The Agenda by node does the same. This is the "milestones with their
          tasks" view; it also covers the follow-up noted under N10 (task bars under a
          milestone).
      (7) The link used for nesting is any reference except the "Depends on" property
          (N12 rule).
      Out of scope: views defined by a free query; different filters per tag; nesting more
      than one level; tags that share no date property and no choice property still work
      but get no filters.
      Risks: the 2,000-node target now applies to the union; the default-view rule and the
      "unknown tag" fallback must handle a list; the tag tree's "include child tags" tick
      applies per selected tag.
      Acceptance: unit tests (config migration, per-tag dates, shared-property rule, union
      load, grouping, nesting, rollups); live on `planner-project` with #Milestone + #Task:
      each milestone with its tasks as bars under it, connectors between the tasks, Kanban
      by Status over both tags, a view saved and reopened.
      Owner said "go" on 2026-10-03 with the coordinator's assumptions: build both steps
      (the nested picture is the goal), any number of tags (tested with two to four),
      colours stay per node. Details fixed for the build: a node carrying several selected
      tags takes its dates from the first of them in selection order; "include child tags"
      stays one setting for the whole view; the Timeline gets an Arrange control (By date /
      By tag / Nested) shown only with two or more tags, Nested being the default there;
      nested children are expanded by default and collapsible per parent; a child with
      several parents sits under the first.
- [x] **N15 Window move / resize while the workspace is open** — owner report 2026-10-03:
      "we cannot resize the application until we escape or click on close". Logged and
      investigated, not fixed.
      Measured on the desktop test instance (Logseq-DB 2.0.1 nightly, build 94327e9, real
      mouse drags posted with CGEvent, window bounds read from the OS):
      - Resizing works with Planner open: bottom-right corner, right edge (1 to 3 px
        inside and outside the border), bottom edge and top edge all changed the window
        size, the same as with Planner closed. The blocked resize was not reproduced here.
      - Moving does not work with Planner open: a drag on an empty part of Planner's top
        bar leaves the window where it is; with Planner closed the same drag on the host
        header moves it. Cause: the `-webkit-app-region: no-drag` put on the frame in
        de90392 (needed so clicks on the top bar land) removes the host's drag strip.
        Double-click on the top strip to zoom the window is lost the same way (not tested).
      - A drag region declared inside the plugin frame (`[data-region=topbar]`) is ignored
        by the app: tried live, the window did not move.
      Not known: which app and which gesture the owner used (the stable Logseq.app b09316a
      was not tested; edge drag, the green button and a title-bar double-click are
      different paths).
      Options:
      (a) Start the frame below the host header (top 48 px): the host's own strip stays
          visible and draggable, nothing to maintain; Planner is no longer edge to edge and
          the host toolbar shows above it.
      (b) Keep the frame full height and add drag strips from the host side
          (`logseq.provideStyle`): the top few pixels across the window and the
          window-button area, leaving the controls clickable. Needs a live check that a
          drag region inside the no-drag container is honoured; the strip is thin.
      (c) Leave as is and document it.
      Decision (owner, 2026-10-03): option (a). Plan:
      (1) Frame geometry: in `FULL_SCREEN` (src/sdk.ts) the container starts under the host
          header: `top: var(--ls-headbar-height, 3rem)`, `height: calc(100vh -
          var(--ls-headbar-height, 3rem))`. The host sets `--ls-headbar-height: 3rem` and
          `#head` measures 48 px (read live on Logseq-DB); the style is inline on a host
          element, so the host variable resolves. Same rule in the web app.
      (2) Remove what the full-height frame needed: `WebkitAppRegion: no-drag` (no drag
          region lies under the frame any more) and the macOS window-button padding
          (`macWindowButtons`, `html.pl-mac-desktop .pl-top`, checklist row A9).
      (3) The host header stays usable while Planner is open, so decide its behaviour: the
          Planner toolbar button becomes a toggle (open / close); Escape and Close stay;
          host navigation (Home, back / forward, search) happens under the frame and
          Planner stays on top until closed. Check that the host's left sidebar, when open,
          does not show through or steal the frame's left edge (z-index 999 today).
      (4) Planner's own top bar keeps its place as the first row of the frame (title, view
          switch, Saved views, Close); no height change.
      (5) Docs: REQUIREMENTS ("full-screen workspace" becomes "workspace under the app
          header"), README, docs/design.md, docs/manual-test.md (A rows on the frame, A9
          retired, new rows below), CHANGELOG.
      (6) Tests first: sdk.test.ts (top / height values on both paths, no app-region key),
          app.test.ts (toolbar button toggles; no `pl-mac-desktop` class), CSS test for the
          removed rule.
      Acceptance, on the desktop app with real mouse input (`click`, `drag`, `bounds` tools
      of the `test-logseq-desktop` skill): the window moves by the host header with Planner
      open; resizes by every edge and the corner; double-click on the header zooms it;
      every Planner top-bar control and the host toolbar button take a click; the frame
      starts exactly at the header's lower edge at 100% and at a zoomed app (the test
      instance runs at 144%); light and dark. Web app: frame under the header, no overlap.
      Order: independent of N13 (panel) and N14; can run in parallel with them, but it
      touches `src/sdk.ts` and `src/app.ts`, which N13 does not.
- [x] **N16 Host shortcuts while Planner is open** — owner report 2026-10-03: with Planner
      open no Logseq shortcut works (Cmd+Shift+P, Cmd+K, `t t`). Reproduced on the desktop
      test instance: keyboard focus is inside the plugin frame, so key events never reach
      the host; with Planner closed the same keys work. Prototype checked live: a listener
      in the frame that re-dispatches the key event on the host document's body (the frame
      is same-origin on the desktop app) makes `t t` switch the theme (Planner follows),
      Cmd+K open search above Planner with focus in its field, Escape close it with Planner
      still open, and Cmd+Shift+P open the command palette.
      Build: forward `keydown` / `keyup` that Planner did not handle to the host. Not
      forwarded: events Planner prevented; Escape, Tab, Enter, Space, arrows, Home / End /
      Page keys without Cmd / Ctrl; keys typed in a text field, except Cmd / Ctrl combos
      that are not editing keys (A, C, V, X, Z, Y). When the host prevents the forwarded
      event, prevent the original too. Cross-origin frame (web app, dev server): no
      forwarding possible, do nothing. Acceptance: unit tests for the rule; live: the three
      reported shortcuts with Planner open, typing a view name still works, Escape still
      closes a popover and then Planner.
- [x] **N17 Upstream report: CLI writes leave `:block/refs` empty** — filed 2026-10-04 as
      logseq/db-test#1399 (re-run on 8ffbb22-dirty: tag and property refs missing, inline
      `[[page]]` refs present, EDN import builds them all). Was: to draft for the owner's
      review, then file (Logseq DB / CLI builds go to logseq/db-test). Seen 2026-10-03 on
      CLI and worker 8ffbb22-dirty (Logseq-DB 2.0.1 nightly): blocks created or updated with
      `logseq upsert task` / `upsert block --update-properties` through the CLI's own worker
      (`server list`: owner-source cli) have no `:block/refs` at all (no tag, property or
      node-value refs), so linked references and any `[?b :block/refs ?x]` query miss them;
      the same write while a desktop app owns the worker (owner-source electron), even a
      same-value one, builds the full refs; `graph import --type edn` builds them too.
      Repro to write up: create a graph, `upsert task` with a node property, query the
      block's refs; open the graph in the app, repeat the write, query again. Before
      filing: re-run on the current build, search for duplicates, description only.
- [x] **N18 Upstream report: `createJournalPage("YYYY-MM-DD")` lands a day early** — filed
      2026-10-04 as logseq/db-test#1400 (only west of UTC; `create_journal_page` unchanged on
      master). Was: to draft
      for the owner's review, then file. Seen 2026-10-04 on Logseq-DB 2.0.1 nightly
      (8ffbb22), @logseq/libs 0.3.x, time zone UTC−5: `logseq.Editor.createJournalPage
      ("2026-12-01")` returned the page "Nov 30th, 2026"; `"2026-12-03T12:00:00"`, a local
      `Date` and local-midnight ms gave the intended day. Likely the bare date is parsed as
      UTC and then read in local time. Planner passes local noon, so it is not affected.
      Before filing: re-run on the current build, check east of UTC by reasoning or a
      second zone, search for duplicates.
- [x] **N19 Validate in the owner's app, with real mouse input** — done 2026-10-04 on the stable Logseq.app 2.0.1 (b09316a), a second
      instance driven over CDP with real mouse clicks and drags (CGEvent); the owner's own
      window was not touched. The owner's app is this stable build (their Logseq.app had
      `planner-project` open). Results in docs/manual-test.md, "Stable app pass". Passed:
      top bar and toolbar clicks (A15, A16), window move and resize by every edge (A12,
      A13), saved views Update / delete confirmation / arrow keys (B12, B12a, N29), Edit
      dates in both surfaces incl. a diamond (N6, N13), a failed write (N10), Undo (N15:
      one Undo per property, two for a move), the remembered state over restarts and two
      graphs (O1-O4, O6), the band title (N32), the CSP (N33). Three bugs found and fixed:
      (1) 5b65c72: the sidebar handle could not be dragged toward a docked Planner, the
      frame swallowed the drag: likely the owner's "cannot resize" report (the window
      itself always resized); (2) c78dcee: every Date edit failed on this build, since its
      `createJournalPage` returns null where the nightly returns the page; (3) 724bb24: a
      host error showed as "[object Object]". Left over: N34.
- [x] **N20 Connector routing when bars touch** — done 2026-10-04: every connector is one S
      curve (cubic Bézier) from the dependency's right edge middle to the dependent's left
      edge middle, control points half the distance out and in, at least 24 px; no stub
      route, no elbow. The owner asked for a curve ("to avoid the overlapping perception")
      after a first fix (4d957f3) that dropped a straight line from under the dependency's
      end. Accepted by the owner on 2026-10-04 ("much better").
      Was: in Week zoom two-hour bars touch end to start, so every connector took the elbow
      route and the lines piled into a ladder.
- [x] **N21 Remember panel, surface and Edit dates per graph** — done 2026-10-04, the owner's
      decision: all of it persists. `src/ui-state.ts` (`createUiStore`, `parsePrefs`): the
      panel (wide / narrow), the surface, Edit dates and the view on screen (serialised
      config + saved view id), one entry per graph (key: the graph's url) in the plugin's
      settings under `uiState` (`uiStateDeps()` in sdk.ts: `getCurrentGraph`,
      `logseq.settings`, `updateSettings`). Per device, never in the graph. The workspace
      reads it on the first load of a graph (after `reset()` too) and writes after a render
      when it differs from the last write; a restored Sidebar goes through `setSurface`;
      unreadable settings or a gone tag give the default view silently. Unit tests only:
      NOT run in the app. Assumed from the SDK source, not probed: `updateSettings` merges
      deeply (LSPlugin.core `settings.patch`), so one graph's entry leaves the others.
      manual-test section O (O1-O6) is the live check. Was: session only, no per-graph UI
      store, pending an owner decision.
- [x] **N22 Tracker test derives its task list from tasks.md** — done 2026-10-04:
      `scripts/tracker-lib.test.mjs` reads the ids from tasks.md and the dependency map from
      `tracker-meta.json` (every task in exactly one milestone, each start at the latest End
      of its dependencies). A new task needs a milestone in the meta and no test edit. Was:
      the test pinned the ids and the dependency map.
- [x] **N23 Saved views: Update and a delete confirmation** — owner request 2026-10-04
      (N03c). With a saved view open, the Saved views menu has **Update "name"**
      (`data-action=update-view`): `views.update(id, config)`, name kept, the menu closes; a
      failed write shows the error and leaves the menu open. **×** no longer deletes at
      once: the row becomes **Delete "name"?** (`data-view-deleting`) with Cancel
      (`data-view-delete-cancel`, focused) and Delete (`data-view-delete-confirm`);
      opening or closing a menu drops the question (`State.viewDeleting`, session state).
      No browser dialog. Unit tests only; manual-test rows B12 and B12a are not run.
- [ ] **N34 Owner's own look before the release** — left from N19. (1) open: the owner is
      trying the new build in their own app (2026-10-04; their Logseq-DB.app had
      `planner-desktop` open). (2) done: the owner double-clicked the header, the window
      zooms (A14). (3) O5 passes in a test instance (nightly, 2026-10-04): tag deleted while
      Planner was hidden: after a restart the default view on the other tag, no error;
      deleted while open: the default view at once with "unknown tag … Showing the default
      view instead". The owner's own run (2026-10-05) was a view of several tags, saved as
      "DeleteMeView": after the restart it reopened as Kanban on the two tags left
      (#Project + #Client project), no error, as REQUIREMENTS says for a gone tag.
      (4) done, nothing to report: on the stable app `addTagProperty` from a plugin adds
      the plugin's own property to its own tag, and a user property to a user tag when the
      property is given by ident or uuid; by bare name it answers "Not a valid property"
      (names resolve in the plugin's namespace). From the host page `add_tag_property`
      worked by uuid and by title; "Not a valid tag" was not reproduced.
- [x] **N35 Edit dates: say what it does** — done 2026-10-09, seen live on the nightly (planner-project, Workspace surface, 2026-10-09); owner request. Clicking "Edit dates"
      in the Timeline toolbar looks like nothing happened: it only flips the toggle (N06c);
      the one hint, `#pl-tl-edit-help`, is hidden for screen readers. Show it: a visible
      hint next to the toggle while on ("Drag a bar to move it, an end to resize it"),
      a grab cursor / visible handles on editable bars, a clearer pressed state. Sketch
      first (owner rule). Built the small version without sketches: while on, a visible
      hint "Drag a bar to move it, drag an end to resize it" (`data-tl-edit-hint`, `.pl-hint`)
      follows the toggle, and the resize handles show a faint tint (grab cursor existed).
      Seen live: hint appears and goes with the toggle, handles tinted. Left: the sidebar
      width, where the toolbar wraps.
- [x] **N36 Timeline: read the full title** — done 2026-10-09, seen live on the nightly (planner-project, Workspace surface, 2026-10-09); owner request. The label column is
      fixed (`--pl-tl-label-w: 240px`) and titles end in an ellipsis. Two ways, probably
      both: wrap titles to two lines, and a draggable divider that sets the label width
      (remembered per view or per graph, N21). Watch: taller rows must keep the bar tracks,
      today line and `drawLinks` connectors aligned. Same wrapping rules as N37.
      Built (owner picked "wrap + resizable divider"): titles clamp at two lines; a divider
      `data-tl-resize` on the head corner drags `--pl-tl-label-w` (160-640 px, double-click
      resets), kept per graph in `UiPrefs.labelWidth`, not in a saved view; the in-page block
      has no divider. Pointer only (the head is `aria-hidden`). Seen live: drag to the
      minimum wraps "Decisions and follow-ups" to two rows (41 px), today line still on
      the bar grid, reload restores the width, double-click resets. Live check moved the
      minimum 140 -> 160 px ("Decisions" broke mid-word at 140). Not seen: connectors
      with wrapped rows, Day zoom, narrow sidebar.
- [x] **N37 Kanban: narrow columns, taller cards** — done 2026-10-09, seen live on the nightly (planner-project, Workspace surface, 2026-10-09); owner request. A column can
      be ~800 px wide (two columns fill the workspace). `.pl-kb` is `minmax(220px, 1fr)`
      with `width: max-content`; the title is already nowrap + ellipsis, so find in the app
      what stretches the track before fixing. Target: columns ~280 px (decide), titles wrap,
      cards grow in height, several columns visible without horizontal scroll; scroll only
      for many columns. Cause found: `white-space: nowrap` titles in a `width: max-content`
      grid, so the longest title anywhere sized every `1fr` column. Fix without sketches
      (owner said go ahead): columns `minmax(240px, 320px)`, left-aligned, titles wrap to
      three lines (`-webkit-line-clamp: 3`), cards grow. Seen live (#Project, 7 columns): every column 320 px; a 120-character title
      wraps to three lines and the column stays 320. Not seen: the owner's own board; with the
      panel open only ~2.5 columns fit a 1960 px window (maybe 280 px later).
- [x] **N38 Kanban cards: tag and property values** — done 2026-10-09, both parts seen live on the nightly; owner request. (1) Tag
      chip on the card (`PlannerNode.tag`), when the view has two or more tags. DONE
      2026-10-09, seen live (#Task + #Project on `planner-project`: "#Task" / "#Project" first
      in each card's meta line; none with one tag): `KanbanInput.tagTitles`, `KanbanCard.tag`,
      `.pl-kb-tag`, also in the card's aria label.
      Part 2 (owner chose "choice properties only"): cards already listed every other choice
      value (`meta`); a **Card fields** menu (`data-control=kb-fields`, checkbox
      `data-kb-field-value`, after Swimlanes, only when a property is left to choose) now picks
      which: Kanban config `hiddenFields` (idents; [] = all; an older stored config loads as []),
      `KanbanInput.hiddenFields`, `cardFieldProps` (all but column, lane and Priority). Seen live
      (#Task + #Project): Owner off -> "0 of 1", values gone from the cards, `hiddenFields` in
      the graph's `planner-ui-state`; on again -> back. Dates and other types on cards: not done.
      (2) Chosen property values on the card: a "Card fields" menu in the Kanban toolbar,
      saved in the view config (versioned JSON, old configs keep working); `nodePull` and
      `normalize.ts` carry the extra values. Do (1) first. After N37 (card height).
- [x] **N39 Less chrome: a focus / compact mode** — done 2026-10-09, seen live on the nightly (workspace and sidebar); owner request. In the
      sidebar surface the top bar, settings bar and view toolbar take ~350 px of ~1100.
      Options (sketch two or three, owner picks): collapsible settings bar with a one-line
      summary (recommended), a focus mode that hides all bars to a thin strip, settings
      moved into the Panel, responsive icon buttons. State remembered per graph and per
      surface (N21 `UiPrefs`); a clear way back to the controls.
      Built (owner chose the compact header + focus mode, for the workspace and the sidebar,
      after clickable mockups): ONE header row of icon tabs (the pressed one named; all named
      from 640 px, container query) + ⤢ focus + ⚙ settings + ⋯ menu (surface switch, Panel,
      Close, Saved views); ⚙ opens the settings bar in place (not a popover); focus hides the
      header, settings and view toolbar behind one strip `data-region=focus-strip` (view name,
      tags, ⌄). Both are session state (`settingsOpen`, `focus`), not remembered per graph and
      not in a saved view. All old selectors kept (controls stay in the DOM, hidden when
      folded); tests moved with the layout (Panel and surface now in `[data-region=more]`).
      Seen live: sidebar (418 px) header 155 px before the view toolbar's content, with
      settings open 265, focus 41; workspace ⋯ menu, nested Saved views, settings, focus.
      Left: remembering settings/focus per graph; the Panel (docked) stays visible in focus.
- [x] **N40 Sidebar surface beside the native right sidebar** — done 2026-10-09, seen live on the nightly with a synthetic pointer (real mouse not run: the test window was not frontmost); owner request.
      Toggling Logseq's native right sidebar while Planner is docked overlaps it. Reference:
      `logseq-dev/plugin-dev/logseq-outline-canvas` (`src/index.ts` ~472-552, "mirror"
      mode): reserve the strip with host CSS (`provideStyle`, `margin-right` on
      `#app-container-wrapper`), so the native sidebar opens to its left; the two open and
      close independently; width drag sets iframe and margin together. Changes N06a / N19:
      the host closing its sidebar no longer closes Planner, opening Planner no longer
      forces it open; `sidebarFrame` / `dock.ts` and their tests change. Decide the width
      model (fixed strip or draggable). Live test on the nightly and the stable app.
      Built (owner chose: draggable edge kept per device; the host's toggle stays untouched):
      `dockFrame` + `dockHostStyle` (sdk.ts), `installDockResize` (ui/dock-resize.ts), the app wiring;
      `dock.ts`, `sidebarFrame` and `setRightSidebarVisible` are gone, and with them "the host
      closing its sidebar closes Planner" (N06a) and the resizer-drag guard (N19). Seen live: with
      the native sidebar open it sits at 567-821 and Planner at 821-1369, no overlap; closing and
      opening it left Planner where it was; the handle: +160 px, -100 px, double-click back to 548
      (40%); switching to Workspace gives the margin back. Not seen: a real mouse drag (CDP drags
      stall when a step leaves the frame, hence the document / host listeners), the stable app
      b09316a, a window resize while docked, Planner hidden by the host while docked.
- [x] **N41 UI state follows the graph** — done 2026-10-09, seen live on the nightly
      (`planner-project`); owner request ("let's write in the graph", views are graph-specific).
      The on-screen view and the Timeline title width (N36) are written into the graph: hidden
      string property `planner-ui-state` on the "Planner views" page (`STATE_KEY`; JSON
      `{v:1, view, labelWidth}`), `graphStateDeps()` in sdk.ts, `GraphStateDeps` + `graphStateText` /
      `parseGraphState` in ui-state.ts. Panel, surface and Edit dates stay in device settings
      (owner's choice). `load`: the graph's copy wins, else this device's (migration); `save`: the
      graph is written only when view or width changed, one write at a time, latest state wins,
      a failure is dropped. The device copy keeps everything. Live: drag + zoom wrote the
      property (read back); a different width written into the graph beat the device's on reload;
      a reset wrote back. Probe first: `upsertBlockProperty` on the page uuid works, the page's
      blocks (saved views) are unchanged. Not seen: a second device, the stable app, a page in
      Recycle (the write fails quietly), the first write creating the page on a graph without it.
- [x] **N42 Kanban card fields: any simple property** — done 2026-10-09, seen live on the nightly (planner-project, #Task); owner request ("review the UX,
      allow choosing what to show, more than the narrowed list"). Requirement written in
      REQUIREMENTS.md, Kanban "Card contents" (owner's choices: all simple types; value only
      with the name as tooltip; chosen per tag, saved with the view). Work: schema discovery of
      every property of a tag with its type (today `TagInfo` knows date / choice / node props
      only); `cardFields` per tag in the view config (old `hiddenFields` configs keep working:
      default = today's shared choice values); the node pull widened by the chosen idents only
      (keep the T13a timings: re-run the 2,000-node check); a value formatter per type; the Card
      fields menu grouped by tag; tooltips + aria label. Tests first, then live. After N39.
      Built: `TagInfo.fieldProps` (`FieldProp`: choice, text, number, checkbox, url, node, date,
      datetime; hidden properties left out), config `cardFields` (per tag ident, ordered; absent =
      the N38 default, so old views look the same; `hiddenFields` still applies to that default),
      `src/core/fields.ts` (`cardFieldsOf`, `offeredFields`, `extraFieldProps`, `fieldTexts`, and
      `priorityProp` moved there), the pull adds an attribute only for chosen text / number /
      checkbox / url / node fields (`nodePull(..., fields)`, `RawData.fields`, so `readRaw` re-asks
      when the choice changes; a dated or choice field adds nothing), `PlannerNode.extras`, the
      menu one group per view tag (`data-kb-field-tag` + `data-kb-field-value`), values as bare
      chips with the property name as `title`, several values joined in one chip cut at the card's
      width. Seen live on #Task: the menu lists Deadline, Scheduled, Start, End, Owner, Team,
      Milestone, depends_on; ticking depends_on (a node property) read the nodes again and the
      cards show its titles; saved with the view into the graph. Not done: the 2,000-node timing
      re-run (the default pull string is unchanged, asserted by a test), dates / numbers /
      checkboxes / urls on real data (no such property in the test graph; unit tests only), the
      property name in the card's aria-label (tooltip only), Planner's own Priority / column
      properties offered.
      Seen: clicking the already active view tab resets that view's settings (`switchKind`), which
      cleared the card fields in a test run; it is the old behaviour for every Kanban setting.
- [x] **N43 Keep Planner open when a node is opened while docked** — done 2026-10-10, seen live on the nightly
      (planner-project). Owner request: clicking a node in the sidebar surface closed Planner. `nodeOpener(deps,
      keepOpen)`: in the Sidebar surface a click only calls `openPage` (Planner and its reserved strip stay); the
      Workspace surface still hides Planner; Shift+click and the in-page block opener unchanged. Focus is left with
      the opened page. Seen live: docked Kanban card open button → route changed, container still visible, host
      margin 620 px; Workspace → container hidden.
- [x] **N44 Dock beside other docked plugins (step 1: measure)** — done 2026-10-10, seen live on the nightly
      (planner-project, with Outline Canvas open at 48vw). Owner report: Planner and Outline Canvas both pinned
      to `right: 0` and each set `margin-right` on `#app-container-wrapper`, so one covered the other and the
      host reserved one strip, not both. `src/ui/dock-neighbours.ts`: `neighbourOffset` (the widest visible
      foreign frame touching the right edge; full-screen / floating ones ignored) and `installNeighbours`
      (watches only the other frames' class / style and added frames). Docked Planner sits at
      `right: <offset>px`, reserves offset + width with an `html`-prefixed rule that outranks the other plugin's,
      follows it showing / resizing / hiding, and keeps its wanted width (squeezed, not forgotten). Seen live:
      canvas 947–1821, Planner 459–947, margin 1362 = 874 + 488; canvas at 30vw → Planner 787–1275, margin
      1034; canvas hidden → Planner 1333–1821, margin 488. Step 2 (not done): a shared `{id, width}` registry
      Outline Canvas also publishes and reads, for a stable order; Outline Canvas still covers itself over
      Planner when it opens after Planner until it adopts it (Planner moves left of it instead: seen).
- [x] **N45 Dock order shared with Outline Canvas (step 2)** — done 2026-10-10. Unit tests and Planner side seen
      live on the nightly; the Outline Canvas side is unit tests + typecheck + build only (the instance loads the
      installed copy in `~/.logseq/plugins/outline-canvas`, shared with the owner's app, which was not replaced).
      `docs/dock-order.md`: a docked plugin stamps its container `data-dock-seq`, yields to visible frames stamped
      lower or not stamped, reserves offset + width under `:root` × (rank + 1). Planner: `installNeighbours` gained
      `stamp` / `unstamp` / `rank`, `dockHostStyle(..., offset, rank)`, a frame stamped after Planner does not move
      it. Outline Canvas (`src/dock.ts` + glue in `src/index.ts`, its repo): same contract, `right: <offset>px`,
      margin `calc(offset + width)`. Seen live (Planner, canvas simulated by DOM): canvas unstamped → Planner left
      of it (margin 1034 = 546 + 488); canvas stamped later → Planner back on the edge (margin 488); stamped earlier
      → left of it again; closing Planner removes its stamp. Not done: Outline Canvas running with the contract
      beside Planner in a real app, the stable app, real-mouse resize of either plugin.
- [x] **N46 Calendar time grids: Week, 3 days, Day** — done 2026-10-10, seen live on the nightly (planner-project, docked).
      Owner request (reference: a time-box widget: day columns, hour axis, blocks with times, a now line, done
      struck through). Owner's choices: 3 days = yesterday, today, tomorrow, arrows move 3 days; Week and Day are time
      grids too; 24 hours; tasks' Scheduled and Deadline shown. Requirement in REQUIREMENTS.md, Calendar. Built:
      `CalendarView` = month | week | 3days | day (config `layout`; a stored `week` now draws the grid), `calendarRange`
      / `shiftCalendarAnchor` (1 / 3 / 7 days), `layoutCalendar` → `CalendarLayout.grid: TimeGrid` for the grids
      (`weeks` empty): `GridBlock`s by minute (a same-day timed span, a timed point, a task's timed Scheduled /
      Deadline; 30 min default, 20 min minimum), overlap columns (`col` / `cols`), the all-day row (bands with lanes,
      chips: untimed items and multi-day spans), `now`, `focusMinute`; `src/ui/calendar.ts` `renderGrid` (sticky head +
      all-day row over a 24-hour body, `--pl-start` / `--pl-len` minutes, `HOUR_PX` 48 kept equal to the CSS), the
      workspace scrolls a new range to its focus minute (`scrollGrid`, `gridScrollTop`) and keeps the scroll on a redraw
      of the same range. Seen live: 3 days 9 – 11 Oct and 6 – 8 Oct (four DateTime nodes as blocks 09:00 – 17:00, hour
      axis, sticky head flush at the top (found live: the sticky box stopped 12 px low under the view's padding), opens
      at the focus minute), Week 7 columns, Day one, Today keeps the user's scroll. Not done: dragging blocks (edit
      dates in the grid), hour zoom, working-hours collapse; overlapping blocks, a Scheduled block and the all-day row
      on real data (unit tests only); the now line's look; the workspace (wide) surface; the stable app; real-mouse use.
- [x] **N48 Header controls as icons** — done 2026-10-11, seen live on the nightly (planner-project: wide, docked, 320 px).
      Owner request, option C of the mockups (artifact "Planner header options"): the ⋯ menu is gone. `.pl-tools` holds
      six icon buttons (focus corner brackets, ⚙, Panel funnel + `.pl-badge`, dock toggle `toggle-surface`, Saved views
      bookmark menu, Close ×), wrapping under the tabs below 480 px. The open saved view's name is in the Saved views
      button's label. Unit tests plus live; not seen: the stable app.
- [x] **N61 Pre-release docs pass** — done 2026-10-11 (production-readiness review C1, C2, C3, E).
      README: top bar icons, Workspace / Sidebar section rewritten (macOS full window, dock toggle, dock order), four writes,
      Calendar time grids and their editing, the UI state in the graph, the one host font read. CHANGELOG `[Unreleased]`: an
      "Added (N39 to N60)" block and a note that N57 reverses N15 on macOS. Screenshots retaken on the nightly (planner-project):
      kanban, timeline-nested, day-zoom, sidebar (docked, with a page open) and a new calendar-3days; in-page-block.png is
      unchanged (a page block, no Planner chrome). C3 (manifest): left as it is. The host (`handler/plugin.cljs`) lists marketplace
      packages on the web app only when `web` is true or `effect` is not true, so Planner, with neither, is listed everywhere;
      adding `effect: true` would hide it from the web marketplace unless `web: true` is also set, and none of the owner's other
      plugins declare either. Not done: the in-page-block screenshot. The shared repo was pushed afterwards as private: `hdansou/logseq-plugin-config` (main, 55f922a).
- [x] **N60 The shared config package is vendored (release blocker)** — done 2026-10-11.
      Production-readiness review D1: the `file:../logseq-dev/plugin-dev/logseq-plugin-config` dependency (N53) made `npm ci` fail in
      CI and in the release workflow (the sibling folder is not there). The package's sources and tests are copied into
      `src/vendor/plugin-config` (README there: source commit, change upstream first), the dependency and its lockfile
      entries are gone, imports are relative. `npm ci --dry-run`, typecheck, 1,214 tests and the build pass. The shared repo keeps
      its own copy for the owner's other plugins.
- [x] **N59 The workspace's top bar is clickable (macOS)** — done 2026-10-11, seen live with a REAL mouse click on the nightly.
      Owner report after N57: the view tabs could not be switched. The host header is a window drag region
      (`-webkit-app-region: drag`, the reason for N15) and Electron swallows real clicks on what is drawn over it; CDP clicks
      bypass it, so unit and CDP checks of N57 missed this. `noDragStyle(pluginId)` (`NO_DRAG_STYLE_KEY`) is provided while the
      workspace covers the header and emptied when docked. Seen: computed `-webkit-app-region` is `no-drag` on the frame
      container (`drag` on `#head`), and a real left click on the Calendar tab at its screen point switched Timeline to
      Calendar. Not seen: the click failing without the style (the owner's report stands for that), the stable app.
- [x] **N58 Security audit hardening** — done 2026-10-11 (skill security-audit on the whole repo: risk low, 0 `npm audit` findings).
      SEC-001: `assertPluginId` (letters, digits, `.`, `_`, `-`) before the plugin id goes into a `[data-pid="…"]` selector
      (`dockHostStyle`, the frame lookups). SEC-002: `hostIconFontUrl` only follows a font URL on the stylesheet's own origin
      (the fetch runs with the host's privileges). The SEC-002 test was written together with its code, not seen red first.
      Left as informational: `style-src 'unsafe-inline'` (inline styles carry numbers only), `^` ranges and the local `file:`
      package dependency (pin or publish before release).
- [x] **N57 The workspace covers the whole window (macOS)** — done 2026-10-11, seen live on the nightly.
      Owner request, reversing N15: the host controls above the workspace were clickable but acted on the page behind it.
      `workspaceFrame(top)`; on macOS `app.ts` uses `workspaceFrame("0px")` and sets `data-window-controls="left"` on the root (removed
      when docked), `workspace.css` gives `.pl-top` and `.pl-strip` 84 px of left padding for the window buttons. Seen: the frame at
      0,0 over the whole window, the first tab at 86 px, a point at (120, 24) lands on Planner's frame, Escape closes it. Cost: the
      window cannot be moved by the strip above Planner (only by the window's frame outside it), and a double-click there no
      longer zooms. Not seen: Windows / Linux (they keep the header: window controls at the right, unchecked), the stable app,
      macOS native full screen (no window buttons; the 84 px stays).
- [x] **N56 Short Calendar blocks show their title** — done 2026-10-11, seen live on the nightly (planner-project, 3 days, 1–3 Oct).
      Owner report: an item with one date (a point or deadline, a 30-minute block = 23 px) lost its title in the time grids: the
      stacked title and time did not fit and the flex column squeezed the title out. Blocks of `SHORT_BLOCK_MIN` (30) minutes or
      less carry `data-cg-short` and lay out as one row (title takes the rest, time and node never shrink). Seen: "Tasks with
      only a deadline" and "08:00" on one line, title 14 px high, not clipped. Not seen: the stable app, the 20-minute minimum
      block (15 px) on real data.
- [x] **N55 Icon characters in values and titles** — done 2026-10-11, seen live on the nightly (probe characters in the frame).
      Owner report: closed values and titles made of tabler-icons characters (private-use code points the host draws with its
      icon font) showed as boxes in the Agenda. Owner rule (memory: plugins follow the host's style): borrow the host's font,
      do not bundle one (a 779 KB copy was built first and dropped). `src/ui/host-icons.ts`: `hostIconFontUrl` finds the host's
      `tabler-icons` @font-face in its stylesheets, `borrowHostIconFont` fetches it with the host's fetch and adds it to the
      frame as "Planner Icons" (private-use range, from the bytes, so the frame's font-src policy does not apply); called once
      from `registerApp` when the host document is reachable. "Planner Icons" is FIRST in the base font stack: it only covers the private-use range, and
      with it last a system fallback font (the generic family) claimed those code points first (pacman U+EEBC drew as a CJK
      character, focus U+EB8D as "abc": the owner's boxes). Seen live: the owner's two icons, tabler `pacman` U+EEBC and `focus`
      U+EB8D, one to three of each, draw as in the host. Not seen: the real Effort / Priority values on the owner's graph, the stable
      app, the in-page block (it lives in the host document), the web app (no host document, boxes stay).
- [x] **N54 Checked on the stable app** — 2026-10-11, Logseq 2.0.2 (revision 533ac43; b09316a in CLAUDE.md is older), fresh profile and a
      throwaway graph (since removed). Seen: the icon header (six tools, dock toggle "Dock to the right" then "Back to the workspace",
      docked frame at the window top, full height), a saved view stored under `planner-view-json` (text, hidden), the views page
      and the hidden "Plugin state: Planner", and the views page renamed back to "Planner views" and renamed forward again on the
      next open with the view still listed. No error bar. Not seen: a real pre-N50 graph.
- [x] **N53 Planner uses the logseq-plugin-config package** — done 2026-10-11, seen live on the nightly (throwaway graph).
      Owner request. `package.json` depends on the sibling repo (`file:../logseq-dev/plugin-dev/logseq-plugin-config`, source
      consumed as is); `src/storage.ts` re-exports `fenceJson` / `unfenceJson` / `propertyText`, `configSchemaFor` wraps
      `propertySchemaFor`, the views page goes through `findOrRenamePage`; `src/sdk.ts` has one `configSdk()` adapter and
      `graphStateDeps` is `createStateStore`. No behaviour change: all 1,176 tests pass unchanged. Seen live: saved view
      listed, state page hidden, no error. The cost: a build needs the sibling repo checked out. Not seen: the stable app.
- [x] **N52 Views page renamed "Plugin views: Planner"** — done 2026-10-11, seen live on the nightly (throwaway graph).
      Owner decision (option 3, docs/plugin-config.md): one page per role, `Plugin <role>: <plugin>`. `PAGE_TITLE` is now
      "Plugin views: Planner"; a graph whose page still has the old title (`LEGACY_PAGE_TITLE`) gets it renamed on the first
      read or save (`renamePage` with the uuid, blocks kept), and the old page is used as it is when the rename is refused.
      The UI-state fallback looks on both titles. Seen live: a "Planner views" page with a saved view renamed itself and the
      view listed. Not seen: the stable app, a real pre-N52 graph.
- [x] **N51 Saved-view config in a hidden text property** — done 2026-10-11, seen live on the nightly (throwaway graph).
      Owner request (docs/plugin-config.md). The `string` property stayed visible on the page; a text (`default`) property
      with `hide: true` is hidden and can hold a code block. A property's type cannot change once it has data, so the config
      moved to a new key, `planner-view-json` (`CONFIG_KEY`; the old `planner-view-config` is `LEGACY_CONFIG_KEY`). Written
      as pretty JSON in a json fence (`fenceJson`), read back compact (`unfenceJson`; an unfenced value is accepted),
      `propertyText` takes a string or a text property's value object. A read falls back to the old key; a write removes
      it, only after the new value reads back. Seen live: a saved view stored under the new key with the property hidden;
      a view with only the old property listed, opened and updated, the old property gone. Not seen: the stable app, a real
      pre-N51 graph (the throwaway graph was set up to look like one).
- [x] **N50 UI state on its own hidden page** — done 2026-10-11, seen live on the nightly (throwaway graph).
      Owner request (docs/plugin-config.md). `STATE_PAGE_TITLE` "Plugin state: Planner" holds `planner-ui-state` and
      `:logseq.property/hide?` true, so it is out of All pages and search; "Planner views" keeps only the user's views.
      `graphStateDeps` reads the new page, falls back to the old value on "Planner views", and a write removes that one.
      Seen live: the page is hidden, holds the property, the old page is untouched in a fresh graph. Not seen: a real
      pre-N50 graph's migration (unit tests only), the stable app.
- [x] **N49 Docked Planner from the window top; the way back is named** — done 2026-10-11, seen live on the nightly.
      Owner request: reclaim the strip above the docked frame (on macOS; elsewhere the window controls sit at the right, so it
      stays under the header; `dockTop()` in app.ts, a unitless `0` would make the `calc` height invalid, so `0px`). The dock
      button now shows where it goes (side-pane icon "Dock to the right", window icon "Back to the workspace", `data-surface-to`)
      because the lit icon was not read as the way back. The strip above Planner is no longer a window drag area.
- [x] **N47 Edit dates in the Calendar time grids** — done 2026-10-10, seen live on the nightly (planner-project, docked).
      Owner request ("do drag and edit first"). `CalendarInput.edit` / `pending`, `GridBlock.edit` / `span` / `pending`,
      `TimeGrid.editing`, pure `gridDelta(block, mode, range, days, quarters)` (days stay on the range, a move stays inside its
      day, a resize keeps 15 minutes); `src/ui/grid-edit.ts` (`installGridEdit`: pointer drag with a transform for a move and
      the minute variables for a resize, Alt+Arrow keys), the Edit dates toggle `data-cal-edit` in the grid toolbar (the Timeline's
      session state), blocks `data-cg-editable` / `data-cg-move` / `data-cg-locked` / `data-cg-pending`, handles
      `data-cg-handle`, `#pl-cg-edit-help`; the workspace writes through `editDates` (`EditTarget`: a Timeline row or a
      block, 96 steps per day). Seen live: a real-mouse drag of N05 down 30 minutes wrote and read back (11:30 – 13:30),
      two Alt+Up put it back (11:00 – 13:00). Not seen: resize edges with the real mouse and on real data (no DateTime span
      block on screen besides these; unit tests with a hand-made grid), the stable app, the wide workspace surface. N34's End
      read 10:00 while checking: the owner had changed it from 11:00, not this item's write.
- [x] **N05 Release** — DONE 2026-10-11. Public repo https://github.com/hdansou/logseq-planner (CI green on the first push: `npm ci`,
      typecheck, test, build), tag `v1.0.0`, release https://github.com/hdansou/logseq-planner/releases/tag/v1.0.0 with
      `logseq-planner.zip` (116 KB; README, LICENSE, package.json, icon.svg, dist/), marketplace pull request
      https://github.com/logseq/marketplace/pull/929 (`packages/logseq-planner/manifest.json`, `supportsDB` / `supportsDBOnly`, no
      `effect`). Waiting on the marketplace review. Earlier line: 2026-10-11: the owner said go; version 1.0.0, the author email rewritten to the GitHub noreply address
      before the first push (backup bundle `../logseq-planner-before-rewrite.bundle`), CHANGELOG cut. Earlier note: prepared locally on 2026-10-04, NOT published; waits for the owner's
      go-ahead. Done: MIT LICENSE; `package.json` marketplace metadata (repository
      `hdansou/logseq-planner`, `private` removed, version still 0.1.0); `.github/workflows`
      ci.yml and publish.yml (Node 24; the zip holds README, LICENSE, package.json, icon.svg,
      dist/: 102 KB); README rewritten for the marketplace with five screenshots under
      `docs/screenshots/` (taken on `planner-project`, Logseq's default light theme);
      `docs/marketplace-manifest.json`; `npm audit` 0. Left, in order, each outward-facing:
      create the public repo, `git remote add` and push, bump to 1.0.0 and cut the
      CHANGELOG, tag v1.0.0 and push the tag (publish.yml builds the release zip), check
      the release, fork logseq/marketplace and open the manifest PR. Before that the owner
      should try the build in their own app (stable Logseq.app was never tested).
- [x] **N06 Later surfaces (out of v1)** — side panel (after N13), in-page block,
      drag-to-edit dates (REQUIREMENTS.md). Split on 2026-10-04:
      **N06a Sidebar surface** (done 58e37ae, see the Progress log). Prototype checked live on the desktop app: with
      Logseq's right sidebar open (`#right-sidebar.open`, 40% wide, a 3 px `.resizer` at
      its left edge, the main content shrinks beside it), setting the frame's `left` /
      `width` to the sidebar's rectangle minus the resizer shows Planner next to the page
      at 705 px, no overflow, panel docked. Build: a Workspace / Sidebar switch in
      Planner's top bar; in Sidebar mode Planner opens the host's right sidebar
      (`set_right_sidebar_visible`), lays its frame over it (from the header's lower edge,
      leaving the resizer free) and follows its size with a ResizeObserver; when the host
      closes the sidebar Planner goes back to the workspace mode hidden state (closes);
      the mode is remembered for the session. Desktop app only (the web app's frame cannot
      read the host document): the switch is not shown there. The sidebar's own content is
      covered while Planner is docked. Acceptance: unit tests for the geometry and the
      mode switch; live with real mouse input: page and Planner side by side, drag the
      host's resizer and Planner follows, all four views usable at the sidebar's width
      (panel as a drawer under 640 px), close and reopen.
      **N06b In-page block** (done 4f288e8, see the Progress log). Probe on the desktop app: a block
      `{{renderer :planner, <saved view name>}}` fires `onMacroRendererSlotted` in a DB
      graph (slot id, arguments, block uuid) and `provideUI({slot, template})` renders the
      HTML in the page; `data-on-click` reaches the plugin's model. Build: the block shows a
      read-only picture of the named saved view (same layouts and markup as the
      workspace's view area: Timeline, Calendar, Agenda or Kanban), a header with the view
      name and an "Open in Planner" button; a click on an item opens the node; no menus,
      no drag, no connectors; it refreshes when the graph changes; an unknown view name
      shows a message with the names that exist. Styles are provided to the host scoped
      under the block's root class, with the `--pl-*` tokens mapped to the host's own
      variables. A slash command "Planner view" inserts the block. Acceptance: unit tests
      (argument parsing, template for each kind, scoping of the CSS, refresh, unknown
      view); live: a saved Timeline view and a saved Kanban view shown in a page, an edit
      refreshes them, a click opens the node, "Open in Planner" opens that view, light and
      dark.
      **N06c Drag to edit dates** (done 951ff58, see the Progress log). Write probe on the desktop
      app through the plugin SDK: a DateTime property (user Start, built-in Scheduled) takes
      epoch ms with `upsertBlockProperty(uuid, <ident without colon>, ms)` and reads back
      the same number; a Date property takes the db id of the day's journal page (journal
      day number, ISO string and ms are rejected); `createJournalPage` returns the existing
      page or creates it, but a bare "YYYY-MM-DD" lands on the previous day west of UTC
      ("2026-12-01" gave Nov 30th at UTC−5): pass a local Date or "YYYY-MM-DDT12:00:00".
      Build, Timeline only: an "Edit dates" toggle in the toolbar, off by default (v1 was
      read-only by the owner's decision), not saved with the view. When on: drag a bar to
      move it (Start and End shift together), drag its left or right edge to change one
      end, snapped to the zoom's track (a day; 15 minutes in Day zoom); a one-date point
      moves. Not editable: spans derived from tasks, task markers, a property that is not
      one of the node's own mapped Start / End, Date-only values in Day zoom. DateTime
      values keep their time of day when moved by days. Writes are optimistic, read back,
      and rolled back with an error if the read differs (as the Kanban move does). Keyboard:
      Alt+Left / Right on a focused bar moves it one track, Alt+Shift+Left / Right changes
      its End. Works in the workspace and the sidebar surface, not in the in-page block.
      Acceptance: unit tests (track delta to new dates for both types, time kept, the
      journal-day argument, guards, rollback); live on `planner-project` (DateTime) and on
      `planner-desktop-2` (Date): move, resize both ends, keyboard, a failed write, the
      graph read back with the CLI, connectors and rollups follow.
      Decision note (2026-10-03, owner asked whether Planner should be resizable
      independently of the app): yes, through the right-sidebar surface. Logseq's sidebar
      has its own width handle, so a Planner rendered there is sized by the host and shows
      next to the page; the workspace stays the maximised mode. Not building a floating,
      resizable window: it covers the page, and the host's draggable / resizable main-UI
      mode keeps its own layout and ignores the position Planner sets (the reason
      `draggable` was never turned on). Fallback if the sidebar proves too narrow: a docked
      split in the workspace with a draggable divider. Revisit after the sidebar surface
      exists. Consequence: N13 (panel on the right, narrow-width drawer) comes before this
      and matters more.
- [x] **N07 Query Builder follow-up (other repo)** — its theme code has the same
      theme-switch race fixed here in 2c90798; not checked there.
- [x] **N62 Agenda in a narrow frame** — done 2026-10-11 (owner: the docked Agenda truncated every title). Under 640 px an entry is two lines (title up to two lines, node chip / meta / date under it); "00:00" is no time (`withoutMidnight`); the Overdue bucket keeps only "N days late" (date in the tooltip). Seen in the nightly (d24abc9), docked, `planner-project`: long title clamped to two lines, Overdue by date shows lateness only; not seen on the stable app.
- [ ] **N64 Matrix view (prototype, branch `feat/matrix-view`)** — started 2026-10-12 (owner: a priority matrix, Eisenhower or Impact × Effort, over any two properties; mocks reviewed on the phone). A fifth view: two choice properties of the view's tags as axes (Across, Down); Quadrants (each axis in two bands: the value uuids of the first band are saved, a value added later joins the second band, a gone uuid is ignored; Reverse flips an axis; − / + move the split) or Every value (a row and a column per value); a card sits in the cell of its two values, a card missing either is in the Unplaced list under the grid; a move (drag, or the card's ⋯ menu) writes each changed axis's band first value, read back, as a Kanban move; to Unplaced removes the values; quadrant labels editable, "" = the default (a preset's when the axes are named Urgency / Importance or Effort / Impact, else the two bands); done cards hidden unless Show done; saved with a view; read-only in a page. Priority defaults to down, high end first. Unit tests (core, config, workspace, block). Seen in the nightly (d24abc9), docked at 975 px, `planner-project`, #Task by Priority and Status: quadrants, Every value (scrolls sideways), the ⋯ menu move wrote Priority Urgent and read it back (undone afterwards). Not seen: drag with a real mouse, the narrow (< 640 px) layout, the stable app, dark mode, the in-page block. Open (owner): the split for an odd value count (now: the smaller half first), the drop value (now: the band's first), the time range (phase 2: length, Prev / Next, carry-over, done summary; dates = Start / End, the fallback still to decide), Task blocks.
- [x] **N63 Node colours carry no status meaning** — done 2026-10-11 (owner: red / green / blue dots read as late / on time / done). The six node hues are their own tokens (teal, indigo, pink, purple, brown, slate), not the host highlights; the Agenda's node dot is its Status icon (as a task's), neutral without one. Seen in the nightly (d24abc9), `planner-project`; all six README screenshots retaken. Not seen: dark mode, the stable app.

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
- 2026-10-03 defect reported by the owner after the desktop pass: "unable to switch from
  timeline to calendar". Cause: the full-screen frame covers the host header, whose top
  48 px is a window-drag region; real clicks on Planner's top bar never arrived. The
  desktop pass used CDP clicks, which bypass drag regions, so it passed wrongly. Fixed in
  de90392 (`WebkitAppRegion: no-drag` in `FULL_SCREEN`, 506 tests). Verified with real
  mouse events posted by a small CGEvent tool (skill `test-logseq-desktop`,
  `scripts/click.swift`): before the fix a click on Calendar left Timeline; after it
  Calendar, Kanban, Saved views (open, close) and Close all respond. Rule from now on:
  anything in the top 48 px of the desktop window is checked with real clicks. Side
  effect: the window cannot be dragged by its top strip while Planner is open.
- 2026-10-03 icon (dd072f8): three staggered bars in the toolbar (inline SVG, `currentColor`)
  and in icon.svg; the calendar glyph matched the Journals calendar plugin. Seen in the
  desktop toolbar; the plugin-list icon was rendered from the file only.
- 2026-10-03 N08 done (0001f26, 25b9f3a). 529 unit tests. Live on the desktop app (graph
  `planner-desktop-2`; the owner's own app had `planner-desktop` open), rows D16–D20 in
  docs/manual-test.md: hide four columns with real mouse clicks, last-column guard,
  per-property memory, save / reopen (stored JSON read with the CLI), Move to a hidden
  column. Decisions taken (change if wrong): only columns are selectable, not swimlanes;
  the Move menu lists hidden values; a list that would hide every column hides none;
  Show resets to "All" on a view-kind switch, as Sort and Swimlanes do (kept only in a
  saved view). Not verified: disabled-checkbox look in dark mode; focus after moving a
  card to a hidden column falls to the document. Note: the owner tests in the stable
  Logseq.app (b09316a); every desktop check here ran on Logseq-DB.app (8ffbb22).
- 2026-10-03 N09 done (445f186, 3324724). 553 unit tests. `npm run tracker` mirrors this
  file into the graph `planner-project` (Logseq-DB build, CLI 8ffbb22): 25 tasks, 6
  milestones, the project; Start / End are DateTime (first / last commit time); Team,
  Owner, Milestone, Start and End were added to the built-in Task tag. Live in Logseq-DB
  (second instance): #Milestone Timeline shows "Foundation, 3 Oct 13:07 – 3 Oct 14:08, 7 of
  7 done" and so on; #Task Kanban by Status with Team swimlanes (Product 1, Dev 20, QA 3,
  Docs 1); a second run plans nothing; ticking N09 here and re-running with the app open
  moved the N09 card to Done without reopening Planner.
  Defect found live: blocks written through the CLI's own worker have no `:block/refs`, so
  no task showed under its milestone; a CLI write while an app has the graph open builds
  them. The script now reports blocks without references and rebuilds them when the app
  has the graph open (22 rebuilt). Likely an upstream CLI defect; not filed.
  Rule: run `npm run tracker` after each task, with `planner-project` open in Logseq-DB
  when new tasks were added. T13a is not an item line here, so its commits count for T13.
  Decisions taken (change if wrong): milestone grouping and team / owner defaults in
  `scripts/tracker-meta.json`; sub-agents appear as teams, not as people; the project's
  owner is Danzu, milestone owners Claude.
- 2026-10-03 N10 done (77eab27). 581 unit tests. Timeline zoom Day | Week | Month |
  Quarter; Day = one day on 96 tracks of 15 minutes, 24 hour columns, items placed by
  their times, a now line, Prev / Next by a day; the track model replaced day indices in
  every zoom (Week / Month / Quarter place as before). Live on the desktop app, graph
  `planner-project` (rows C1.14, C1.15, C1.18, C1.19 in docs/manual-test.md): the four
  dated milestones are bars across their hours, expanded tasks show their start ring at
  its time, #Task with Start / End mapped shows 20 task bars, navigation and the later
  jump work, a view saved in Day zoom reopens in Day zoom.
  Not verified: C1.16 and C1.17 (seed graph: deadline diamond at 17:00, #Meeting times),
  a span clipped across midnight, a Date-only span in Day zoom, the opening scroll in a
  narrow window (the test window was wide enough for nearly all 24 hours).
  Decisions taken (change if wrong): 15-minute tracks at 12 px; a Date-only point sits at
  00:00; a span whose end is before its start shows as one track at its start; the
  Calendar's day view and hour grid stay out of scope.
  Seen on the data: tasks under a milestone show only their Scheduled ring, not their
  Start–End bar (a task's own span shows only in the #Task view). Candidate follow-up.
  Working rule from the owner: keep the desktop test instance running between checks
  (reload the plugin with `LSPluginCore.reload`), do not relaunch it each time.
- 2026-10-03 N11 done (9db0489 plus the N07 / N11 dependency entries). 606 unit tests. The
  tracker writes a planned schedule: 2 working hours per task, weekdays 09:00–17:00,
  start = latest End among its dependencies (`after` in `scripts/tracker-meta.json`;
  real dependencies recorded, so independent tasks overlap), fixed `scheduleStart`
  2026-09-29T15:00 so the started work ends Fri 2 Oct 17:00; a many-valued node property
  `depends_on` on each task. The graph was recreated for the new property. Live in
  Logseq-DB (`planner-project`): 26 tasks, all with references after a run with the app
  open, a second run plans nothing; #Task Timeline Week shows the bars from Tue 29 Sep to
  Mon 5 Oct with T08–T11 in parallel; Day zoom on Thu 1 Oct shows nine two-hour bars
  (T06 09:00, T07 11:00, T08–T11 13:00, N08 / N10 / T12 15:00); Agenda marks N03 (Doing,
  planned Fri 2 Oct) late.
  Seen on the data, not changed: (1) Planner counts any reference as a task link, so in
  the #Task view a task's dependents show as its sub-tasks ("T07 Workspace shell, 4 of 4
  done" = T08–T11 via `depends_on`); (2) after switching graphs in one app session Planner
  showed "Invalid view config: unknown tag …Meeting…" once (the last view of the previous
  graph); it falls back to the default view.
- 2026-10-03 N12 done (27b841d, 65ccad2, 94327e9). 653 unit tests. Tags carry their node
  properties; a "Depends on" setting (default: the property titled like `depends_on`)
  is saved with the view; a node that points to another through it is a dependent, not a
  task of it; the Timeline draws an SVG connector per dependency whose two ends are on
  screen, measured from the bars after each render. Live on the desktop app,
  `planner-project` (rows C1.20–C1.22): 33 connectors in Week zoom, 11 on Thu 1 Oct in Day
  zoom, None removes them and brings the old rollup back, #Milestone unchanged.
  Not verified: C1.23 (saved view round trip of the setting), connectors into a rotated
  point (diamond), a redraw after a theme or font change, cost at 2,000 nodes with links.
  Seen: in Week zoom bars that touch end to start make every connector take the elbow
  route, and the lines crowd; Day zoom reads well. The "Depends on" menu lists every
  node property of the tag (Milestone too).
- 2026-10-03 N15 done (a066651). 656 unit tests. The workspace frame starts under the host
  header (`top: var(--ls-headbar-height, 3rem)`); the no-drag marking and the macOS
  window-button padding are gone; the toolbar button toggles Planner; the command palette
  still only opens. Live on the desktop app with real mouse input (rows A11–A13, A15,
  A16): frame exactly under the header, window moves by the header and resizes by corner,
  right and bottom edge with Planner open, top-bar controls and the toolbar toggle take
  clicks. Host navigation is not intercepted: Planner stays on top until closed.
  Not verified: A14 (double-click on the header to zoom the window); the web app path
  (`setMainUIInlineStyle` with `calc()` and a host variable); dark mode; the owner's
  original report of a blocked resize was never reproduced (Logseq-DB only; the stable
  Logseq.app was not tested).
- 2026-10-03 N16 done (7d26266, 9d6aab9). 708 unit tests. `src/ui/host-keys.ts`: keys
  Planner does not use are re-dispatched on the host document's body (desktop app only;
  the frame is same-origin there), and focus is handed back to the Planner frame when the
  host's focus falls to its body while Planner is visible. Live on the desktop app (rows
  I11–I15, I17): `t t`, Cmd+K and Cmd+Shift+P work with Planner open, text typed in the
  view-name field stays there, Escape closes a host dialog, then a Planner menu, then
  Planner. Keys were sent through CDP, which goes through the app's normal focus routing
  (unlike mouse clicks on drag regions). Not verified: I16 (web app: nothing forwarded);
  every other host shortcut; non-US keyboard layouts.
  Test note: a host search dialog left open keeps the toolbar button unclickable for
  playwright; close it by clicking its field and pressing Escape.
- 2026-10-03 N13 done (cef037a, 43679d7, 89aa29d) and two N04 items (20a8892, fc8a1d8),
  built in parallel (N04 on branch `n04` in its own worktree, merged in 7b84fd8 with one
  one-line conflict in workspace.ts). 731 unit tests.
  N13: view then panel (`aside[data-region=panel]`, "sidebar" renamed to "panel"
  everywhere), a Panel toggle in the settings bar with the count of active filters, a
  drawer under 640 px. Panel state is kept per mode (wide / narrow) for the session; it is
  not persisted, because the plugin has no per-graph UI store (last view and tag are in
  memory too). Live on the desktop app (rows A17–A21): layout in all four views, Tab
  order, toggle and count, drawer at an emulated 620 px window, Escape and outside click.
  N04: the Agenda's Overdue bucket pages by 100; done and canceled titles use
  `--pl-label-done` (label mixed 72% over the surface): measured 7.61 / 6.11 in Logseq's
  default light / dark and 6.94 in Inkwell dark (F9 now passes).
  Not verified: real mouse clicks and a real window resize (the screen was locked, the
  frontmost process was loginwindow; clicks were made in the app and the width was
  emulated over CDP); A22 (popovers near the right edge); H15 (Overdue paging on the
  large seed); the toggle's position when the settings bar wraps (it lands on a third row
  at 430 px).
  Seen: in a narrow window Logseq's own left sidebar, when open, becomes an overlay that
  covers most of Planner; closing it is the host's control. N04 still open: tag deletion
  triggers no refresh; refresh time at 2,000 nodes; saved-view writes not serialised.
- 2026-10-04 N07 done, in the Query Builder repo (16d44d4 there, BUG-8): it had the same
  defect, tokens resolved only at the theme event. Fixed the way 2c90798 does (resolve at
  once, again after 250 ms and 1000 ms, last call wins). Live on the desktop test
  instance: switching between two dark themes, Query Builder's tokens right after the
  event were the old theme's and matched the host 1.8 s later. Not pushed there.
- 2026-10-04 N14 done (4f84882, 285a6ca, 8eb07ab). 805 unit tests. Config: `tags` list
  with per-tag `dates`; stored one-tag views are converted in `parseViewConfig`. Tag
  checkboxes in the panel, a Dates popover with two or more tags, shared choice
  properties, a Tag filter and a read-only Tag swimlane, Timeline Arrange (By date / By
  tag / Nested), children nested one level under the node they reference, the Agenda by
  node likewise. Live on the desktop app, `planner-project`, #Milestone + #Task (rows
  K1–K7, K9, K11): union loads in 93 ms, six milestones with 31 task bars under them,
  rollups right, 38 connectors, Kanban and Agenda over both tags, saved view round trip.
  Deviations accepted: "Depends on" offers the node properties of any selected tag (the
  shared rule would hide `depends_on`, which only #Task has); a #Task block that is a node
  of the view is never also a marker row, in one-tag views too; nested progress is used
  only in Timeline Nested and Agenda by node.
  Defect found live, to fix: in a view that goes from one tag to several, "Depends on"
  stays None; it should take the default property (`depends_on`) unless the user chose.
  Not verified: K8 (a view saved before N14; unit-tested), K10 (collapse kept across a view
  switch), a drag across Tag lanes, cost at 2,000 nodes, real mouse clicks.
- 2026-10-04 follow-ups (f3ff6b8, 1dcf23d, 9b46e05, 7f7f8f4). 812 unit tests.
  "Depends on" is left unset until the user picks, so the default rule follows the tags:
  live, #Milestone shows None, ticking #Task gives depends_on with 38 connectors, and an
  explicit None survives tag changes. Saved-view writes go through one queue: live, two
  saves clicked back to back both persisted (read back with the CLI). Calendar band title:
  the `margin-left: auto` rule matched the "‹" marker too; fixed, not re-run live (the
  demo graph has no span over three weeks). The double reload after a stale hide was not
  reproduced in unit tests (one load); a regression test was added and no code changed —
  the README and the checklist still list it; the likely cause is host change events that
  arrive after the frame is shown, which are real changes.
  N04 still open: tag deletion triggers no refresh; refresh time at 2,000 nodes; the
  double reload (unconfirmed cause); auto-restore of a recycled views page; CSP.
- 2026-10-04 N06a done (58e37ae). 832 unit tests. A Workspace | Sidebar switch in the top
  bar (desktop app only); in Sidebar mode Planner opens the host's right sidebar and lays
  its frame over it (`sidebarFrame`, `src/ui/dock.ts`: ResizeObserver, class observer and
  window resize on the host), closes when the host closes the sidebar, docks again on the
  next open. Live on the desktop app (rows L1–L3, L5–L8, in-app clicks): page and Planner
  side by side at 705 px, the frame follows a width change, four views without overflow,
  close / reopen / host close / back to Workspace.
  Not verified: a real-mouse drag of the host's handle (L2) and real clicks — the test
  window could not be brought to the front while the owner was working in another app,
  and a click on a background window only activates it; L4 (drawer under 640 px while
  docked); L9 (web app shows no switch).
  Known behaviour: a click on a node still opens it and hides Planner, even when the page
  is beside it; focus returns to Planner when it falls to the host body while docked.
- 2026-10-04 N06b done (0377009, 4f288e8). 891 unit tests. `{{renderer :planner, <saved
  view name>}}` shows a read-only picture of that saved view in the page; one shared
  `renderViewArea` feeds the workspace and the block; the views' CSS is scoped under
  `.planner-block` and the tokens are declared from the host's variables; blocks refresh
  on graph changes; slash command "Planner view". Live on the desktop app (rows M1–M8):
  Timeline and Kanban views in a page, the unknown-name message, refresh after a Status
  change in about 2 s, a click on a row name opens the node, Open in Planner selects the
  view, Inkwell light and dark.
  Not verified: M9 (slash command), M10 (host styles outside the block, beyond one font
  size read), clicks on a bar and a Kanban card, Open in Planner while docked, Logseq's
  default themes, the web app. Known: a block in Day zoom opens at 00:00; the slash
  command leaves the caret after the braces; the Agenda's heading ids repeat when one
  view is shown twice on a page.
- 2026-10-04 N06c done (00dbc6c, 951ff58). 959 unit tests. An "Edit dates" toggle in the
  Timeline toolbar (off by default, session only); with it on, bars move and resize by
  pointer or by Alt+Arrow keys, snapped to the zoom's track; DateTime values are written
  as epoch ms, Date values as the journal page of the local day; optimistic with read-back
  and roll-back through the shared `writeInOrder` (also used by the Kanban move now).
  Live on the desktop app (rows N1–N5, N8 pass; N7, N9, N11, N12 partial): DateTime move
  in Week zoom keeps the time, Day zoom moves by 15 minutes, both handles resize, the
  minimum is one track, Escape aborts, a click still opens the node, Alt+Left moves; on
  `planner-desktop-2` a Date span moved to the right local days and Day zoom locks Date
  values. The demo graph was put back with `npm run tracker` afterwards.
  Not verified: N6 (a diamond), N10 (a failed write), N13 (sidebar surface), N14 (block
  stays read-only; unit-tested), N15 (Logseq's Undo after an edit), dashed bars and task
  markers as locked, pointer capture when the pointer leaves the frame.
  Test note: a bar whose row is scrolled below the frame's edge takes no drag from
  playwright's mouse; scroll the row into view first.
  Seen again: after a graph switch in one app session Planner shows "Invalid view config:
  unknown date property … Showing the default view instead." once — the last view of the
  previous graph is kept across graphs. To fix (N04).
- 2026-10-04 graph switch fixed (ea0f740): on `onCurrentGraphChanged` the workspace, the
  view store cache and the in-page block registry are reset; live, switching
  planner-project → planner-desktop-2 → planner-project with Planner used in between
  shows each graph's default view and no error. In-page block width fixed in three steps
  (4e99d9f, 22fd810, d0ec6cd): Logseq wraps the slot in shrink-to-fit containers and its
  content column cannot shrink below the block's intrinsic width; host wrapper rules
  (`HOST_WRAP_CSS`) plus `contain: inline-size` on the block; live, the block spans
  446..1360 inside the page's visible 1368 and "Open in Planner" is fully shown.
  Release preparation (3dfa558, 8460665) and screenshots: see N05. 972 unit tests.
  Known: after the plugin reloads, blocks on the page already open stay empty until the
  page renders again.
- 2026-10-04 session wrap-up, for the next session:
  Start with: (1) ask the owner which app they run Planner in and test there (the stable
  Logseq.app was never tested); (2) a real-mouse pass with the owner present (top bar,
  sidebar handle drag, Edit dates drag) — rows L2, N6, N10, N13, N15; (3) the owner's
  decisions (N03c) in one batch; (4) publishing (N05) only on the owner's word.
  Follow-ups worth a task: connector routing when bars touch (Week zoom ladders);
  remember panel / surface / Edit dates per graph (no per-graph UI store exists);
  `scripts/tracker-lib.test.mjs` pins the task ids, so every new task needs a test edit —
  derive that list from tasks.md; two upstream reports to draft (CLI-owned worker writes no
  `:block/refs`; `createJournalPage("YYYY-MM-DD")` lands a day early west of UTC).
  Tooling kept: `~/.claude/skills/test-logseq-desktop` has `frame.mjs` (drive the plugin
  frame), `click.swift`, `drag.swift`, `bounds.swift`. The test instance was stopped.
