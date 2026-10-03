# Task list: Planner v1 (workspace)

Spec: [docs/spec.md](../docs/spec.md)
Prototype: https://claude.ai/artifact/KU9Z831Y9y974EUW1yVcud
Started: 2026-10-03
Status: planning

Each task is one working commit (`typecheck`, `test`, `build` pass). Commit subjects carry
the task number, e.g. `Add schema discovery (TASKS 2)`. Logic tasks are RED then GREEN
inside the same commit unless the cycle is large.

## Tasks

- [ ] **0. Scaffold** — `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`,
      `src/main.ts`, `icon.svg`, `README.md`, `.gitignore`
      Done when: plugin loads in the web app, toolbar button opens an empty full-screen
      "Planner" main UI that follows the theme; `npm test` runs one smoke test.
      Est: ~30 min

- [ ] **1. Live probe** — `scripts/probe.mjs`, `docs/probes.md`, `test/fixtures/*.json`
      Seed `plugin-test` with #Project (Start/End Date, Status/Owner choice), child tag
      #Client project, #Meeting (DateTime), tasks that reference projects. Record raw API
      shapes: tag list + extends, class properties (own + inherited) with types and closed
      values, tagged nodes with property values, `:block/refs` for tasks, Date vs DateTime
      values, `DB.onChanged` payloads (local edit, other window), closed-value write via
      `upsertBlockProperty` (user prop + built-in Status) and whether undo reverts it.
      Done when: every open question in the spec has an answer in `docs/probes.md` and the
      fixtures are saved for tests.
      Est: ~45 min

- [ ] **2. Schema discovery** — `src/data/schema.ts` (+ test)
      Tags → `TagInfo[]` tree with own/built-in flag, date props and choice props including
      inherited ones.
      Done when: tests over probe fixtures pass (child tag inherits parent props; tag with
      no dates has `dateProps: []`).
      Est: ~30 min

- [ ] **3. Load nodes and tasks** — `src/data/queries.ts`, `src/data/normalize.ts` (+ tests)
      Query nodes of a tag (+ extending tags), pull mapped properties, normalize Date and
      DateTime to local ISO days, load #Task blocks whose refs hit those nodes.
      Done when: tests cover child-tag inclusion on/off, both date types, timezone edge
      (DateTime near midnight), tasks linked by inline ref and by node property.
      Est: ~45 min

- [ ] **4. Spans, rollups, done, filters** — `src/logic/nodes.ts` (+ test)
      Start/end resolution, derived spans from tasks, point nodes, done/total, done values
      (built-in flags; name guess for user props; view override), filter by choice values.
      Done when: tests cover mapped dates, derive, one-date, no-date, canceled excluded,
      done-value guess and override.
      Est: ~30 min

- [ ] **5. Saved views** — `src/store/views.ts`, `src/model/view-config.ts` (+ tests)
      Defaults per tag (Start/End or Scheduled/Deadline, Status for Kanban), validation
      (fail fast on unknown prop idents), CRUD on the plugin page as hidden string props.
      Done when: unit tests pass with a mocked host; one live save/load round trip noted
      in the progress log.
      Est: ~40 min

- [ ] **6. Workspace shell** — `src/ui/workspace.ts`, `src/ui/theme.ts`, `src/host/logseq.ts`
      Toolbar button, command palette entry + shortcut, config bar (tag, child tags, start,
      end, view switch, saved views), tag tree, filters from choice props, empty states
      (no tags, tag without dates, no nodes, no matches).
      Done when: happy-dom tests render each empty state and the config bar for a fixture
      schema; live: switching tags updates the bar.
      Est: ~60 min

- [ ] **7. Timeline view** — `src/views/timeline.ts` (+ test)
      Zoom Week / Month / Quarter; layout (range, columns, header labels, rows) as pure
      functions; rows per node sorted by start with progress, derived bars dashed, points as
      diamonds, expandable task rows, today line, edge-clipping marks, undated footnote.
      Done when: layout tests pass for all three zooms (week columns in Quarter, clipping,
      derived, points); renders in happy-dom.
      Est: ~60 min

- [ ] **8. Calendar view** — `src/views/calendar.ts` (+ test)
      Month and Week layouts honouring start of week; span bands with stable lanes, point
      chips, linked-task deadline chips in node color; Week sorts by time and shows the
      time label; "+N more" in Month; previous / next / today.
      Done when: lane assignment, week-start and time-sort tests pass; both layouts render
      in happy-dom.
      Est: ~60 min

- [ ] **9. Agenda view** — `src/views/agenda.ts` (+ test)
      Overdue, next 14 days, collapsed Later and No date; group by node (progress, open
      tasks, overdue first) or by date; Show done toggle; non-task tags as Upcoming / Earlier.
      Done when: grouping, horizon and show-done tests pass; renders in happy-dom.
      Est: ~40 min

- [ ] **10. Kanban view** — `src/views/kanban.ts` (+ test)
      Columns from closed values (+ "No <prop>"), optional swimlanes by a second choice
      property (+ "No <prop>" lane), cards sorted by due/end, priority or title; drag →
      write descriptor for column and lane → host write; optimistic update rolled back on
      write failure.
      Done when: column, lane, sort and move tests pass (incl. cross-lane writes two
      properties, drop on "No" removes); live: a move writes and survives reload.
      Est: ~60 min

- [ ] **11. Live updates and click behaviour** — `src/host/changes.ts`, wiring in `workspace.ts`
      Debounced reload on `DB.onChanged`, keep scroll + expanded rows; click opens node and
      hides UI, Shift+click opens right sidebar.
      Done when: debounce test passes; live: editing a task elsewhere redraws the view.
      Est: ~30 min

- [ ] **12. Live end-to-end pass** — `docs/manual-test.md`
      Walk all four views × #Task, #Project, #Meeting, a tag with no dates and an empty tag
      on `plugin-test`, light and dark theme; time first view on a ~2,000-node seed.
      Done when: checklist passes and timings are recorded.
      Est: ~40 min

- [ ] **13. Review and docs** — run `code-review` and `security-audit`, update README
      (install, usage, screenshots placeholder), CHANGELOG.
      Done when: review findings fixed or logged; status set to `done`.
      Est: ~30 min

Total: about 10 hours of focused work.

## Progress log

<!-- one line per task as it lands -->
