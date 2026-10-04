# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Version 0.1.0 is in progress: the workspace and the four views are built and were checked in the Logseq web app
(see the limits in README.md). It has not been released.

### Changed

- The tag and filter panel is on the right of the view (N13): the body is the view, then the panel (`1fr 220px`), in
  that DOM and Tab order; the panel's border is on its left edge and it is labelled "Tags and filters". Renamed from
  "sidebar" (class `pl-panel`, `data-region="panel"`, token `--pl-panel`), so "sidebar" only means Logseq's right
  sidebar. The unused generic `.pl-panel` fill rule in theme.css is gone (Agenda groups and Kanban cells have their own).
  The no-matches empty state now says "Change the filters in the panel."
- A **Panel** toggle, last in the settings bar (`data-action="toggle-panel"`, `aria-expanded`, `aria-controls="pl-panel"`),
  hides and shows the panel (N13); hidden, the view takes the full width (`.pl-body.is-panel-closed`, the panel gets
  `hidden`). With filters ticked and the panel hidden it reads "Panel · 2" (accessible name "Panel · 2 filters
  active"). Focus stays on it. Session state only: nothing is persisted.
- Narrow frames (N13): under 640 px (`@media (max-width: 639px)`, `NARROW_MEDIA`) the panel is a drawer over the view
  from the right edge (`.pl-body[data-panel-mode="drawer"]`, `min(260px, 85%)`, shadow, under popovers), closed by
  default. Escape closes an open menu, then the drawer, then Planner (each prevented, so never forwarded to the host);
  a click on the view closes it too. Wide and narrow keep their own open state; the width listener is removed on
  unload (`stop()`).
- The workspace starts under the app header instead of covering the whole window (N15): the frame's top and height
  come from the host's `--ls-headbar-height` (fallback 3rem), so the window moves by the host header, zooms on a
  header double-click and resizes by its edges as usual. The toolbar button now toggles Planner (opens, and hides
  it while shown); the command palette entry and `g shift+p` still only open it. Removed with the full-height frame:
  `-webkit-app-region: no-drag` (the earlier fix for clicks on the top bar, now superseded) and the macOS
  window-button padding (`macWindowButtons`, `pl-mac-desktop`).
- New icon: three staggered bars (a small Gantt) in the toolbar and the plugin list. The calendar glyph looked like the
  Journals calendar plugin's button.

### Added

- Edit dates in the Timeline (N06c): an **Edit dates** toggle in the Timeline toolbar (`data-tl-edit`, `aria-pressed`;
  off by default, session state, never saved with a view; workspace and sidebar, never the in-page block). When on,
  drag a bar to move its Start and End together, drag its first or last 6 px (`data-tl-handle="start|end"`) to change
  one end, drag a diamond to move its date; deltas snap to the zoom's track (a day, or 15 minutes in Day zoom), a span
  keeps one track and its order, nothing leaves the range; only the bar's inline placement changes during the drag
  (pointer capture, no HTML5 drag), the live refresh waits; under 4 px is a click; Escape or `pointercancel` aborts.
  Alt+Left / Right on a focused bar moves it one track, Alt+Shift+Left / Right changes its End (Start when only that
  end can change); handled, so never forwarded to Logseq; one description (`#pl-tl-edit-help`) names the keys. Locked
  (`data-tl-locked`, default cursor, no handles): spans derived from tasks, task markers, Date values in Day zoom; a
  clipped end has no handle. Writes: DateTime as epoch ms keeping the time of day (local calendar arithmetic, DST-safe),
  Date as the day's journal page id (`createJournalPage` at local noon, which may create the page); each read back
  (a Date also by journal day); optimistic with `data-tl-pending`; a failure returns the bar and shows the error; when
  the second of two writes fails the first is put back and the error says whether that worked. New
  `src/core/date-edit.ts`, `src/core/write.ts` (`writeInOrder`, now also behind `writeMove`), `dateWriteDeps()` in
  src/sdk.ts. Not checked live yet (docs/manual-test.md, section N).

- In-page block (N06b): `{{renderer :planner, <saved view name>}}` shows a read-only picture of a saved view in a page,
  with a header (name, tags, **Open in Planner**), drawn by the same `renderViewArea` as the workspace's view area
  (`src/ui/view-area.ts`, extracted for it). Clicks reach the plugin through `data-on-click` model handlers
  (`plannerOpenNode`, `plannerOpenView`). Styles go to the host once with `provideStyle`, every selector scoped under
  `.planner-block` and the `--pl-*` tokens declared from the host's own variables (`src/ui/block-style.ts`). Blocks
  redraw on graph changes through the workspace's `DB.onChanged` subscription, shared (`shareFeed`); one load per saved
  view per pass. Slash command **Planner view** inserts the macro. The Agenda and Kanban "Show more" buttons carry
  `data-rest` (what is left), which the block shows as "N more". `Workspace.openView(id)` opens a saved view by id.
  Not checked live yet.
- The sidebar surface (N06a, desktop app). A **Workspace | Sidebar** switch in the top bar, before Saved views
  (`[data-surface="workspace|sidebar"]`, `aria-pressed`; the root `.pl-ws` carries `data-surface-mode`), rendered only
  when the host document is reachable. Sidebar opens Logseq's right sidebar (`setRightSidebarVisible(true)`) and lays
  the frame over it: pure `sidebarFrame(sidebarRect, resizerRect, HEADBAR)` in sdk.ts (left = the resizer's right edge
  + 2 px, width = to the sidebar's right edge, top and height as the workspace frame; null for a closed sidebar),
  applied with `setFrame`. `startDock` (src/ui/dock.ts) follows the sidebar with the host window's ResizeObserver, a
  MutationObserver on its `class` and the window `resize` event, all stopped on close, on switching back and on
  unload. The user closing the sidebar hides Planner and keeps the mode; the next open docks again. Closing Planner
  leaves the sidebar open; switching back restores `WORKSPACE_FRAME`. Session memory only. The top bar wraps
  (`flex-wrap`, wrapped rows to the right edge) so it fits the sidebar's widths. `AppDeps` gains `setFrame` and
  `setRightSidebarVisible`; `showMainUI` no longer styles the container. Not checked live yet.
- Parents and children in views over several tags (N14, step 2). A node of the view that references another node of
  the view (not through the Depends on property) is its child; the node query pulls the refs as ids for views over two
  or more tags only (`PlannerNode.links`). Pure `nestItems` (layout-common.ts) decides in row order: the first
  candidate that is not itself a child, a node with children is never a child, the later of two nodes referencing each
  other is the child, one level deep (grandchildren are top-level rows), and recomputes each item's progress over its
  children (view done values, canceled left out) and its tasks that are not nodes. The Timeline's Arrange gets
  **Nested** (the default with two or more tags): child rows under their parent (`data-tl-child-of="<parent uuid>"`,
  `.pl-tl-child`), parents open by default with a toggle (`data-tl-nested`) whose collapsed state is kept for the
  session; a collapsed parent's children get no row and no connector. The Agenda by node lists a child as an entry of
  its parent's group, never as a group of its own. Calendar and Kanban do not nest.
- Views over several tags (N14, step 1). A checkbox before each tag in the panel's tag tree (`data-tag-check`,
  "Include #Title") adds the tag to the view or removes it; the last one is disabled; a click on the tag's name still
  shows it alone, and the Tag menu still picks one tag. Every selected tag is pressed; the Tag control reads
  "#Milestone + #Task". The view shows the union of the tags' nodes (one node query and one task query, the tags' ids
  as one collection input `[?tag ...]`), each node once; each node belongs to the first selected tag it carries,
  directly or through a child tag (`PlannerNode.tag`). Start / End are per tag (`dates` in the config): with one tag
  the Start and End menus as before, with several one **Dates** menu (`data-control="dates"`, "Dates: 2 tags") with a
  row per tag (`data-dates-tag` + `data-dates-field`). Filters, Kanban Columns / Swimlanes / Show, Done when and the
  Priority sort offer the choice properties every tag shares, Depends on the node properties of any tag (`mergeTags`); with two or more tags a **Tag** filter
  group (`"@tag"`) and **Tag** swimlanes, read-only (drops across lanes refused, the ⋯ menu lists columns only). The
  Timeline gets an **Arrange** control (`data-tl-arrange`) with two or more tags: By date, or By tag with a heading row
  per tag (`data-tl-group`). A #Task block that is itself a node of the view is no longer also a task row of the node
  it references (it still counts in that node's progress). The saved-view name suggestion is the first tag plus "+N".
  The config's `tag`, `start` and `end` became `tags` and `dates`, and a Timeline gets `arrange`; a view saved before
  loads as one tag with its dates (by date), and a tag that is gone is dropped from a saved view.
- Dependencies (N12): a **Depends on** setting after End, shown when the tag has a node property (own or inherited,
  any cardinality): None or one of the tag's node properties; default: the one titled like "depends on"
  (`depends_on`, "Depends on", "depends-on"), else None. Saved with the view as `dependsOn`; a view saved before it uses
  the default rule; a property the tag no longer has counts as None. With a dependency property, a #Task that points
  to a node through it is that node's dependent, not one of its tasks: it leaves the node's rollup and task rows in
  every view. The property is pulled with the nodes and the tasks (no `pull [*]`).
- Timeline dependency connectors (N12): a line with an arrow from the end of each dependency's bar (or point) to the
  start of its dependent's, in every zoom, for pairs whose both nodes have a row in the range; a right-angle detour
  when the dependent starts before the dependency ends. One svg (`data-tl-links`) over the grid, under the bars,
  ignoring the pointer, one path per link (`data-tl-link="<from>:<to>"`); the geometry is measured from the drawn bars
  after every render and on a window resize. A bar or point with dependencies adds ", depends on A, B" to its label.
- Tracker (N11): `npm run tracker` writes a planned schedule instead of commit times. Every task gets 2 hours
  (weekdays 09:00-17:00 local) and starts after the tasks it depends on (`after` map in the meta file; default: the previous task, tasks with
  commits first by first commit, then the rest by id; independent tasks overlap). Start / End / Scheduled are the plan, so dates before today are
  planned values. New "depends_on" node property (many) on the Task tag. `scripts/tracker-meta.json` gains
  `scheduleStart`, `taskHours`, and optional `hours` / `after` overrides.
- Timeline **Day** zoom (N10), first in the zoom control (Day | Week | Month | Quarter): one day on 96 tracks of 15
  minutes under 24 hour columns ("00" … "23"). Spans are placed by their DateTime times (start rounded down, end rounded
  up, at least one quarter hour); a Date-only start is 00:00 and a Date-only end runs to the end of the day, so a
  Date-only span covers the day; spans past midnight are clipped and marked. One-date nodes and task markers sit at
  their time (Date-only: 00:00). The today line marks the current time and moves on the live refresh. Prev / Next move
  by one day; the earlier / later buttons jump to the nearest node's day. The view opens scrolled to the day's first
  timed item (08:00 on a day without one) and keeps the user's scroll while the same day is redrawn. Saved views carry
  `"zoom": "day"`. The layout's positions are now tracks (a day in Week / Month / Quarter, 15 minutes in Day):
  `--pl-tl-days` / `--pl-tl-day` are renamed `--pl-tl-tracks` / `--pl-tl-track`, and the range has a `tracks` count.
- Project tracker graph (N09): `npm run tracker` mirrors tasks.md into the `planner-project` Logseq graph (a #Project, #Milestone
  nodes, one #Task per item; Status, Team, Owner, Milestone, and Scheduled / Start / End from the git log as exact times;
  Start and End are DateTime properties). Idempotent, `--dry-run`, metadata in `scripts/tracker-meta.json`; Team, Owner,
  Milestone, Start and End are also added to the built-in Task tag. Tests: `scripts/tracker-lib.test.mjs`.
- Kanban **Show** menu (N08): choose which columns of the column property show, plus "No <prop>"; the button reads
  "All" or "3 of 7". Hidden columns and their cards leave the board, lane counts count the cards shown, and at least
  one column stays shown. Stored per column property in the view config (`hiddenColumns`) and saved with the view; a
  view saved before this shows every column. The card's Move menu still lists every value.
- Lateness counts the Scheduled date (N03b): a task's due date is its Deadline, or its Scheduled date when it
  has no Deadline, and an open task is late when its due day is before today (`dueDate` / `isLate` in
  `layout-common.ts`, the only definition). A scheduled-only task past its date gets a red scheduled marker in the
  Timeline (border) and is Overdue in the Agenda, filed and counted from that date. A past Deadline with a later
  Scheduled date is now Overdue (it was filed by the later date). The Calendar still shows Deadlines only.
- Requirements, task plan, design notes (Inkwell-based) and agent instructions for v1.
- Scaffold (T00): toolbar button and "Planner: open" command open an empty Planner;
  Escape and Close hide it. `@logseq/libs` ^0.3.4.
- Live probe (T01): `npm run probe` records tag schema, node, task-ref, date, `DB.onChanged`
  and closed-value write shapes as fixtures; findings in `docs/probes.md`.
- Theme (T02): `src/ui/theme.ts` mirrors the host mode onto `<html class="dark">` and resolves host
  tokens into `--pl-*` (shui channels in `hsl()`, hover must differ from float); re-resolved on
  theme and mode change, and again 250 ms and 1000 ms later (the host's stylesheet load is not
  observable), last resolve wins. `src/ui/theme.css` holds Inkwell defaults and the base component styles.
- Schema discovery (T03): `src/core/schema.ts` lists tags as a tree (built-in vs own, parents via
  `extends`) with date/DateTime and choice properties including inherited ones, and each choice's
  closed values with the checkbox flag and Canceled-by-ident; `datascriptQuery` added to `src/sdk.ts`.
- Nodes and tasks (T04): `src/core/queries.ts` loads the nodes of a tag (extending tags on or off) and
  the #Task blocks that reference them; `src/core/normalize.ts` maps Date values (journal page
  `journal-day`) and DateTime values (epoch ms, injectable zone offset) to local `YYYY-MM-DD` / `HH:MM`
  and choice values to the tag's closed values.
- Spans, rollups, filters (T05): `src/core/nodes.ts` resolves a node's span (mapped Start/End, one date =
  point, derived from linked tasks' Scheduled/Deadline, else undated), rolls tasks up as
  done / (all - canceled), decides done/canceled values (built-in flags, name guess for user choices,
  explicit list wins) and filters nodes by choice values. `PlannerTask` now carries `deadline` and
  `scheduled` as local dates; `loadTasks` takes an optional zone.
- Saved views (T06): `src/core/view-config.ts` (`ViewConfig`, defaults by the Start/End, Scheduled/Deadline,
  first-date rule, fail-fast validation, versioned JSON) and `src/storage.ts` (cache-first CRUD on the
  "Planner views" page, one block per view, hidden string property; every write is read back and throws on a
  mismatch). Not yet verified live.
- Workspace shell (T07): `src/ui/workspace.ts` + `workspace.css`. Full-screen frame (container styled directly,
  `setMainUIInlineStyle` when cross-origin; room for the macOS window buttons on desktop); top bar with the view
  switch, saved views (list, open, save current, delete) and Close; settings bar (tag, child tags, Start, End, done
  values); tag tree (own tags first, built-in tags, children nested); choice filters with "No value" and counts;
  per-view toolbar slot; empty states (no tags, no date properties, no nodes, no matches) and a placeholder per view
  kind. Store and validation errors are shown in a dismissible message. Escape closes an open menu first, then
  Planner. Default shortcut `g shift+p` (non-editing), checked free against the host keymap.
- Timeline layout (T08): `src/core/timeline-layout.ts` computes the Week (21 day columns), Month (56 day columns) and
  Quarter (17 week columns) ranges around an anchor and the week start, rows sorted by start with bars as day indices
  (clipped and flagged at either edge), points, derived spans, progress, task rows with Scheduled/Deadline markers (late
  when open past the deadline), the undated list and the today index. Day arithmetic runs on calendar days (DST-safe);
  `today` is injected. `resolveSpan` accepts a view without a Start property.
- Display titles (T08): `src/core/display-title.ts` shows the referenced node's title for an inline `[[uuid]]` ref, and
  a neutral `(link)` instead of a raw uuid when the node is not loaded.
- Timeline view (T08): `src/ui/timeline.ts` + `timeline.css` replace the Timeline placeholder. Toolbar with prev / next,
  Today, the range label and the Week / Month / Quarter zoom (zoom is saved with a view; the anchor is not). One row per
  dated node on a grid of day tracks: bars in the node's category colour with a progress strip, dashed when derived from
  tasks, squared off with a mark where clipped at the range edge, diamonds for one-date nodes, an edge hint for a node
  wholly outside the range; expandable task rows with status icons and Scheduled / Deadline markers (late deadlines in
  red); today line in the accent colour; undated nodes in a footnote. Click on a row, bar, diamond, task or footnote
  name opens the node and hides Planner; Shift+click opens it in the right sidebar (`openPage` / `openInSidebar` in
  `src/sdk.ts`). Week start is a workspace option (Sunday until T09 wires Logseq's setting).
- Calendar layout (T09): `src/core/calendar-layout.ts` computes Month (whole weeks covering the anchor's month, days of
  other months flagged) and Week (the anchor's seven days) for any week start. Span nodes are bands whose lane stays the
  same across every week row of the range, split per week with continuation flags; one-date nodes and linked tasks'
  Deadlines (not Scheduled; late when open past the deadline; a task linked to two nodes once) are chips on their day,
  untimed first then by time. Month shows 3 item rows per day and counts the rest as "+N more"; Week shows everything.
  Prev / next move by a month (to the 1st) or a week. Undated nodes are listed apart.
- Week start (T09): Logseq's `preferredStartOfWeek` (0–6 = Monday–Sunday, default 6 = Sunday; a number live, a numeric
  string accepted) is read through `hostWeekStart()` in `src/sdk.ts` on every open and drives the Timeline and the
  Calendar. A missing or invalid value fails with a visible error instead of falling back to Sunday.
- Calendar view (T09): `src/ui/calendar.ts` + `calendar.css` replace the Calendar placeholder. Toolbar with prev / next,
  Today, the range label ("October 2026", "27 Sep – 3 Oct 2026") and the Month / Week switch (the layout is saved with a
  view; the anchor is not: it is session state shared with the Timeline, and opening a saved view keeps the period on
  screen). Month: weekday headers, five or six week rows, days of other
  months shaded, today's number in the accent colour; bands in the node's category colour, squared off with a mark where
  they continue into the previous or next week, dashed when derived from tasks; chips for one-date nodes and task
  deadlines (⚑, the node's colour, late ones in red, done ones struck through), the time when there is one; "+N more"
  opens the Week layout on that week. Week: seven tall day columns, chips with time and node. Undated nodes listed under
  the grid. Click opens the node or task and hides Planner; Shift+click opens it in the right sidebar.
- Agenda layout (T10): `src/core/agenda.ts` files the visible nodes and their linked tasks into Overdue, Today, each of
  the next 14 days, Later, No date and Earlier, or groups them by node (own dated line, tasks underneath, overdue groups
  first). A node is filed by its span, a task by Scheduled / Deadline; an open entry that ended is overdue (a node only
  when its tag has a done notion, else Earlier). Done (a node by the view's done values, a task by its Status flags) and
  canceled entries are hidden unless Show done, which reveals those under Today, a day, Earlier (14 days back at most) and
  No date. Entries sort by date, then time, then title; empty buckets are not listed. `today` is injected.
- Agenda view (T10): `src/ui/agenda.ts` + `agenda.css` replace the Agenda placeholder. Toolbar with a Group by Node / Date
  switch and a Show done toggle (both are saved with a view). By date: a panel per non-empty bucket (Overdue in red, Today in
  the accent colour, each of the next 14 days, then folded Later than 14 days, No date and Earlier), tasks with their node's
  chip. By node: a panel per node with its dates, Status and Owner, progress and its tasks underneath. Entries are
  buttons with the status icon, date and "N days late"; click opens the node or task and hides Planner, Shift+click opens
  it in the right sidebar. An empty agenda says so and points at Show done. `toggleButton` joins the shared HTML helpers.
- Kanban model and writes (T11): `src/core/kanban.ts` builds the board from a choice property (every closed value in
  order plus "No <prop>"), optional swimlanes from a second one (plus "No <prop>"), per-column and per-lane counts, done
  columns by the view's done values, and cards (display title, end date or "no date", late flag, task progress, Priority,
  the other choice values) sorted inside each cell by due/end date (undated last), Priority (the tag's Priority choice,
  last value highest, none last) or title. `moveDescriptor` turns a drop into property writes: the column property when
  it changes, the lane property when it does, a removal when the target is "No <prop>". `writeMove` sends each write as
  T01 observed working (`upsertBlockProperty(uuid, <full ident without colon>, <closed value entity id>)`,
  `removeBlockProperty(uuid, <same key>)`), reads the value back and throws a clear error when the graph does not hold
  it. The SDK side is `kanbanWriteDeps()` in `src/sdk.ts`. Not yet verified live.
- Kanban view (T11): `src/ui/kanban.ts` + `kanban.css` replace the last placeholder. Toolbar with the Columns and
  Swimlanes property menus (None, or a second choice property) and the Sort switch (Due, Priority when the tag has a
  Priority choice, Title); all three are saved with a view. The board: column headers with status icons and counts (done
  columns greyed), a lane heading with its count per swimlane, cells on the fill ("No <prop>" outlined), cards with the
  node's colour, title, task progress, Priority, other choice values and end date (late in red). A wide board scrolls
  sideways inside the view. Click on a card opens the node and hides Planner; Shift+click opens it in the right sidebar.
  Moving a card: HTML5 drag and drop between cells, or the card's ⋯ Move menu (keyboard), both through
  `moveDescriptor` and `writeMove`. The move shows at once with the card flagged pending (not draggable, menu disabled);
  then the writes run and are read back, and the board is reloaded from the graph either way, so a write the graph
  does not hold puts the card back and its error shows in the error bar. A tag without a choice property shows "#Tag has
  no choice properties" instead of a board. `menu` and `options` moved to `src/ui/html.ts`. Not yet verified live.
- Live updates (T12): `src/ui/changes.ts` turns `DB.onChanged` (a bare wake-up) into one quiet reload 100 ms after
  the last event of a burst, plus a 30 s poll while Planner is visible; hidden, it only marks the data stale and
  refreshes once on the next show. `Workspace.refresh()` re-reads week start, tags (so new tags, properties and closed
  values appear) and the view's data; redraws only when a signature of tags/nodes/tasks/titles/today differs; keeps
  anchor, expanded rows, scroll of the view and panel, unfolded `details`, focus; waits while a popover is open or
  a card is dragged, and after a pending Kanban write.
- Large seed (T13): `scripts/seed-large.edn.mjs` builds a deterministic load-test seed (tag `#Load item`, N nodes,
  linked tasks, its own page "Planner load test"); `npm run probe -- --seed-large [N]` imports it in chunks (docs/probes.md).
- Dev timings (T13): `src/dev-timings.ts` (dev builds only, `import.meta.env.DEV`; a test builds for production and checks
  it is absent) records the first load (query time, render time) and every live refresh (debounced trigger to DOM updated)
  through the optional `Timing` hook of `createWorkspace`, exposed as `window.__plannerTimings`;
  `npm run probe -- --timings` prints it (docs/probes.md).
- Manual checklist (T13): `docs/manual-test.md`, the live end-to-end pass as tables (open / shell / views by tag / Kanban
  moves / live refresh / themes / week start / large graph / accessibility) with the seed's real values, the timing
  targets and the known gaps.
- Tests (T14): `src/ui/hostile.test.ts` renders a node, a task, a tag, a property, a closed value and a saved-view name
  titled `<img src=x onerror=alert(1)>" onmouseover="x</button>` in all four views and the menus, and checks that no
  element or attribute is created from them and that attributes carrying them stay intact.
- Documentation (T14): README (requirements, install as an unpacked plugin, use, data and privacy, limits and known
  issues with the measured performance, development) and ARCHITECTURE.md (layers, module table, data flow, refresh and
  write paths, state, test seams, design decisions). The marketplace release and screenshots are not part of 0.1.0 yet.

### Fixed
- The in-page block stays inside its page column (N06b): it measured 1273 px in a narrower column and the header's
  "Open in Planner" button was clipped. The root is now `display: block; width: 100%; max-width: 100%; min-width: 0;
  box-sizing: border-box` and no longer scrolls itself; only the view (`.pl-block-view`, `overflow: auto`, `max-height:
  70vh`) scrolls, so the header stays whole (name and tags truncate with an ellipsis, the button never shrinks). Unit-tested on the stylesheet text and the markup; the widths have not been re-measured live.
- Planner starts fresh when the graph changes (N04): after switching graphs in one Logseq session it showed "Invalid view
  config: unknown tag/date property … Showing the default view instead." because the workspace kept the previous
  graph's view (`openBody` in `src/ui/workspace.ts` validated the old config against the new graph's tags). The app now
  listens to `App.onCurrentGraphChanged`: the workspace is reset to a first open (tags, view, nodes, saved views, error,
  expanded and folded sets, pending writes), the saved-view cache is dropped, the in-page block registry is cleared, and
  a shown Planner loads the new graph at once (a hidden one on its next show). Kept: the surface, the panel's open state
  and Edit dates. Unit-tested; the live switch has not been re-run.
- A Calendar band that continues from the previous week and into the next keeps its title at the left edge, after the
  "‹" marker, in every week row (N04): the rule that pushes the "›" marker right (`margin-left: auto`) also matched the
  "‹", which moved it and the title to the middle. It now applies to the last marker only. Unit-tested on the markup
  order and the stylesheet text, not re-run live.
- Saved-view writes run one at a time (N04): create, update and remove of the view store go through one promise queue
  inside `createViewStore`, so two saves (or a save and a delete) started together no longer interleave their
  read-modify-write and lose one. A rejected write is returned to its caller and the queue moves on. Unit-tested,
  not re-run live.
- **Depends on** follows the default rule when the view's tags change (N14): a new view left the setting explicitly
  None when its first tag had no dependency property, so ticking a second tag that has `depends_on` still showed None
  and drew no links. The setting is now "not chosen" (key absent, `dependsOnOf` applies the default rule to the
  current tags) until you pick a value in the menu, and a tag change keeps a choice only while a tag of the view has
  the property (None always stays).
- Done and canceled titles keep a readable contrast (N04): they used `--pl-label-2`, the host's `--muted-foreground`,
  which measured 3.33 (light) and 2.98 (dark) on Logseq's default themes. A new token `--pl-label-done`, a 72% mix of
  the primary label and the surface, colours them in the Agenda, Timeline, Kanban (cards and done column heads) and
  Calendar; `--pl-label-2` keeps dates, hints and counts. The mix is derived, not read from the host, so the host
  token map is unchanged.
- The Agenda's Overdue bucket renders its first 100 entries, then a "Show 100 more of N" button (the same button
  and page size as the node groups; `data-ag-more="overdue"`); the heading keeps the real total and a live refresh
  keeps the expanded count (N04). It used to render every entry (923 at 2,000 nodes).
- Logseq's shortcuts work while Planner is open on the desktop app (N16): keyboard focus sits in the plugin frame, so
  Cmd+K, Cmd+Shift+P and `t t` never reached the host. A document listener now re-dispatches keys Planner did not use
  (`src/ui/host-keys.ts`) on the host document, with `keyCode`. Not passed on: events Planner prevented (Escape now
  calls `preventDefault`), Escape / Tab / Enter / Space / arrows / Home / End / Page keys without Cmd or Ctrl, and keys
  typed in a field unless Cmd or Ctrl is held and the key is not an editing key (A, C, V, X, Z, Y, Backspace,
  Delete, arrows). No effect in the web app or dev server (cross-origin frame). When a host dialog opened this way
  closes, the host's focus fell to its body and Planner's keys were dead until a click; while Planner is shown and the
  host window has focus, focus now returns to the plugin frame (a focused host element is left alone).
- Clicks on the top bar (view switch, Saved views, Close) land on the desktop app: the host header under the
  full-screen frame is a window-drag region, so the frame now sets `-webkit-app-region: no-drag` (`FULL_SCREEN` in
  `sdk.ts`, on both the container and the `setMainUIInlineStyle` fallback). Superseded by N15 (see Changed): the
  frame no longer covers the header and the property is gone.
- A one-point span reads as one date (N02): when a span's start and end are the same day and time (a node derived
  from one task), its label reads "Mobile app, 9 Oct 09:00 from its tasks, 0 of 1 done", not "9 Oct 09:00 – 9 Oct
  09:00". One shared `formatSpan` in `layout-common.ts` serves the Timeline and Calendar labels (`nodeLabel`) and
  the Agenda line; different times on one day, or different days, stay a range.
- No transitions under reduced motion (N02): one rule in `theme.css` under `prefers-reduced-motion: reduce`
  turns transitions and animations off for every element of the plugin frame.
- The settings bar is a labelled group (N02): `role="group"` on the "View settings" region, so assistive tech
  announces its label.
- Refresh (T14): the refresh signature uses the workspace's injected `today` and compares with the day the screen was
  drawn on, so a new day redraws the today line and the Agenda buckets (it used the machine clock and compared with
  today on both sides).
- Unload (T14): the theme and theme-mode listeners and the `ui:visible:changed` listener are unhooked on unload
  (`watchTheme` resolves with its unsubscribe; `onVisibleChanged` returns one), besides the change feed and timers.
- Workspace (T14): when reading the week start or the tags fails on open, the main area no longer claims "No tags in
  this graph" under the error; it shows only a Retry button (`data-action="retry"`, in `data-region="load-failed"`),
  which clears the error and loads again.
- Normalisation (T14): a Date property value without a journal day (the empty placeholder Logseq leaves when a value is
  removed) is no value for that node instead of an error that failed the load of the whole tag.
- Kanban (T14): a drag can no longer get stuck (a stuck drag deferred every live redraw). `dragend` and `drop`
  anywhere in the document end it, and nothing redraws the workspace while a drag is in progress: a render asked for
  meanwhile (a queued action, not only a refresh) runs when the drag ends.
- Dev probe (T14): the documented `timings` op is implemented (returns `window.__plannerTimings`, which
  `npm run probe -- --timings` reads); the hook answers only messages whose source is the host page
  (`e.source === window.parent`); the production-bundle test now checks for `plannerProbe`, the hook's real message
  key (it checked for `__plannerProbe`, which the hook never contained), besides `__plannerTimings`.
- Live updates (T14): a refresh that ended while Planner was hidden, with a change owed from during it, dropped that
  change; the data is now marked stale and the next show refreshes.
- Refresh (T14): a view set up while its tag had no date or choice property kept Start, End or the Kanban column at
  "none" after the tag gained one. On reload, `withDefaults` (`src/core/view-config.ts`) fills a null Start with the
  default Start (and then a null End with the default End) and a null Kanban column with the default column property;
  fields the user set stay. The test fake now answers a node query built for any tag list.
- Idents (T14): one ident check, `isPropertyIdent` (`src/core/schema.ts`), accepts every ident Logseq generates (both
  parts from `[0-9a-zA-Z*+!_'?<>=.-]`, as logseq `normalize-ident-name-part`), so the Kanban read-back no longer
  rejects properties named "Done?", "A+B" or "Who's". The node pull uses the same check: an ident that does not match
  is skipped (that property reads as no value; the tag stays usable) instead of being put into the query string.
- Kanban (T14): a move across a column and a lane whose second write failed left the first property written (the card
  half moved). `writeMove` now writes the first property back to its previous value (`PropertyWrite.previous`) and
  reads it back; the error says "… Status was put back to Doing, so the card has not moved." or, when that fails too,
  "Putting Status back to Doing failed too: …". The board reloads from the graph either way.
- Saved views (T14): the list was read once per plugin lifetime, so views added or deleted on another device never
  showed. The store has `invalidate()`; the workspace drops the cache and lists the views again on every show
  (`Workspace.showViews`, from `app.ts`; the first show lists them as part of the load).
- Schema (T14): a choice property that allows several values (cardinality many) is no longer offered for filters,
  Kanban columns and lanes or done values; only cardinality-one choices are (`collectProps`).
- Workspace (T14): a throw while drawing (or anywhere in a queued action) can no longer leave the action queue rejected,
  which skipped every later action. `render` never throws: the error goes to the error bar and the workspace is drawn
  again, or, when that fails too, a bare shell with the error, Dismiss and Close; `run` and `refresh()` end every step
  with a catch.
- Saved views (T14): one unreadable saved view no longer disables the feature. `list()` returns the readable views and,
  for each block whose config cannot be parsed, an `InvalidView` with the reason; the Saved views menu shows it greyed
  (`data-view-invalid`) with "Cannot be opened: <reason>" and its delete button, and offers no open.
- Saved views (T14): a stored config is checked for its shape before it is used (`checkViewConfigShape`, called by
  `parseViewConfig` and `validateViewConfig`): `filters` and `doneValues` must be plain objects of value-uuid lists
  (`null` allowed in filters only), `childTags` and `showDone` booleans, `tag` a string, `start`, `end`, `columnProp` and
  `laneProp` strings or null, and the kind and its options known values. A config such as
  `filters: {"<ident>": ""}` is rejected with a message naming the field.
- Saved views (T14): the suggested name has no markup ("Project kanban", was "#Project kanban", which made Logseq tag
  the view block #Project and show it as a card on the board). Every name is sanitised before it is written
  (`sanitizeViewName`: `#`, `[`, `]`, `{`, `}` dropped, runs of `(` or `)` folded, spaces collapsed); the UI shows the
  sanitised name. After the append the store also checks that the block has no tags (`blockTags`, a pull by `#uuid`)
  and exactly the sanitised title; otherwise, or when the config write or its read-back fails, the new block is removed
  again, and the error says so if that removal fails too.
- Queries (T14): the node and task queries take the tag's entity id (a number) instead of its title. The host EDN-reads a
  top-level string input, so a tag titled "2026 goals", "true" or ":kw" loaded no nodes (seen live), and two tags with
  the same title merged. The title join is gone; `readRaw` keys staleness on the tag id, so renaming the view's tag
  re-asks neither query.
- Queries (T14): nodes and tasks in Recycle are no longer loaded: a block with `:logseq.property/deleted-at`, or whose
  page has it (a block on a recycled page has none of its own, seen live), is left out of the node query, and of the
  task query both as the task and as the node it links (`notRecycled` in `src/core/queries.ts`).
- Workspace (T14): a click anywhere in the view toolbar (the range label, the hint, a field label, its padding) no
  longer counts as a view switch that reset the view's settings to the kind's defaults. The toolbar container's kind
  hook is now `data-toolbar-kind`; `data-view-kind` is only on the top bar's view-switch buttons.
- Linked titles (T11): an inline `[[uuid]]` ref to a node that is not among the loaded ones (a #Task linking a #Project
  page, seen live on the #Task board as "Draft brief (link)") now shows that node's title in every view. Each data load
  collects the referenced uuids (`refUuids`, `src/core/display-title.ts`) and looks up the missing ones with one
  datascript query (`loadTitles` / `TITLES_QUERY`, `src/core/queries.ts`: plain uuid strings as one collection input,
  joined on `(str ?u)`); no query is sent when every linked node is loaded. A uuid that does not resolve keeps "(link)".
- Kanban (T11): moving a card to "No Status" was reported as a failure although it worked. Removing a built-in property
  leaves the attribute pointing at the `:logseq.property/empty-placeholder` entity (seen live) instead of retracting it;
  the read-back now pulls `:db/ident` and accepts an absent attribute or the placeholder (recognised by ident) as removed,
  while a set that reads back the placeholder still fails. Normalisation has one explicit rule for choice values (only a
  closed value of the property counts; the placeholder, with or without its ident, is no value) and a task whose Status
  is the placeholder has no status, so the Kanban "No" column and lane, the filters' "No value" counts, Agenda meta and
  done logic all see no value.
- Calendar (T09): day numbers (Month) and day labels (Week) are no longer hidden behind lane-0 bands. The week row's
  first grid track is a fixed `--pl-cal-head-h` (28px) instead of `auto`, which nothing sized and collapsed to 0.
- Workspace (T08): the left column runs to the bottom of the window. The shell is a flex column whose body takes the
  remaining height; the fixed row template put the body in an auto-sized row whenever no error row was shown.
- Theme (T07): a host font family is followed by a generic fallback stack, so a family the frame cannot load no
  longer renders in serif; `--pl-tint-soft` is derived from `--pl-tint` instead of the host's `--accent` (the default
  theme sets it to the strong primary, which made selected rows unreadable); focus is a 2px `--pl-ring` outline.
- Workspace (T07): opens on the first own root tag with dates (not a child tag that sorts first); the linked-task
  count covers the filtered nodes only; built-in tags start collapsed behind a disclosure button and open when a
  built-in tag is selected.
- Saved views (T07): every write (create, update, remove) looks the live "Planner views" page up first and never
  trusts a remembered page uuid, because the host appends into a recycled page without error. A page moved to Recycle
  mid-session gives the Recycle guidance, nothing is written into the bin, the store's cache is dropped (a fresh
  `list` returns []) and the workspace re-reads the list after a failed write.
- Tag tree (T07): `[hidden]` always hides (base rule), so the collapsed built-in group is really collapsed; the
  "Built-in tags" heading gets the group spacing.

### Changed
- Cleanups (T14): one `compareDates` (`src/core/nodes.ts`, re-exported by layout-common), one day-count label
  (`dayCount`, was a `plural` in the Agenda and the Kanban) and one "node is done" rule (`isNodeDone`, Agenda and
  Kanban). `loadNodes`, `loadNodesAndTasks` and the store's `cached()` are marked test-only, `update()` as unused by the
  workspace; the stale "UNVERIFIED LIVE" notes in `src/sdk.ts` now say what T06, T07 and T11 verified.
- Queries (T13a): the node query pulls only `:db/id`, `:block/uuid`, `:block/title`, `:block/tags` and the Date/DateTime
  and choice property idents of the graph's tags (`nodePropIdents` / `nodesQuery`, built from the tag list) instead of
  `pull [*]`; the task query is bound to tasks that reference a node of the tag (same tag + `class-extends` join) and
  pulls Status (ident, title), Deadline, Scheduled and the refs' ids only, instead of every #Task in the graph with
  nested tags and ref titles. Both are asked at once (`loadNodesAndTasks`; `loadTasks` is gone). Same nodes, tasks and
  views as before; on the 2,000-node seed the node pull went from 276 ms to about 80 ms and the task pull from 314 ms to
  about 100 ms when run live by hand.
- Queries (T13a): a Date value's journal day is pulled with the node (`{<date ident> [:db/id :block/journal-day]}` in
  `nodePull`), so the separate journal-day query (`JOURNAL_DAYS_QUERY`, which queued behind the task query in the
  host's worker) is gone. A Date value without a journal day still fails fast, as before.
- Refresh (T13a): the view's node and task queries start at once with the tags already on screen, in the same batch as
  the week start and the two tag queries, instead of after them. The rows are then mapped with the re-read tags, so a
  new tag, a new or removed closed value or a renamed property shows without another query. A query runs a second time
  only when its rows are stale (`readRaw`): the node query when the pulled idents changed (a Date/DateTime or choice
  property added to or removed from any tag, or its type changed between Date and DateTime) or the view's tag was
  renamed; the task query only when the tag was renamed. When the view's tag or a property it uses is gone, the
  default view is read afresh, as before.
- Live updates (T13a): the debounce after the last `DB.onChanged` is 50 ms (was 100). One edit's events mostly arrive
  within a few ms; events of one user action that are further apart are merged by the one-more-refresh rule, not by
  the debounce length.
- Timeline (T13a): only nodes that touch the range get a row. The per-node edge hints for nodes wholly outside the
  range are replaced by one line above the grid, "412 earlier · 1,105 later"; each side is a button
  (`data-tl-jump="earlier|later"`, `data-tl-day`) that moves the range to the nearest of those nodes (latest end before
  the range, earliest start after it). The layout counts them (`earlier` / `later`) instead of building their rows.
- Agenda (T13a): a folded bucket (Later, No date, Earlier) renders its entries only once opened, by its summary or any
  other way (`toggle` event); the heading keeps the count. Opened buckets are session state, so a live refresh keeps
  them open with their entries. By node, the first 100 groups render, then a "Show 100 more of N" button
  (`data-ag-more`) adds the next 100. Summaries carry `data-ag-fold="<bucket>"` so focus returns to the right one.
- Kanban (T13a): a cell renders its first 50 cards (plus a pending card or the one whose Move menu is open), then a
  "Show 50 more of N" button (`data-kb-more="<column>|<lane>"`) adds the next 50; column and lane counts stay the real
  totals; drag and the Move menu work on every rendered card.
- Refresh (T13a): the signature of the data on screen is kept until other data is shown, so a live refresh serialises
  only the newly read data (about a megabyte of JSON at 2,000 nodes and tasks) instead of both; `viewItems` files the
  tasks by node id once instead of scanning every task for every node (2,000 × 2,000).
- The view toolbar's prev / range / next / Today markup (`viewNav`), the segmented control and HTML escaping live in
  `src/ui/html.ts`; the category colour rules are generic `[data-cat]` rules in `theme.css` (`--pl-node-fill`,
  `--pl-node-hue`) and the undated-list link is `.pl-link`, shared by both views.
- Day arithmetic, formatting, category colour, view items (`viewItems`, formerly `timelineItems`) and task / node
  labels moved from `timeline-layout.ts` to `src/core/layout-common.ts`, shared by the Timeline and the Calendar.
- The saved-views page lookup ignores a page in the recycle bin (`deleted-at`), so views are no longer appended to a recycled page.
- Done-value override is now a list of closed-value uuids, not titles (a rename no longer breaks it).
