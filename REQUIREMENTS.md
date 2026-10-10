# Planner — requirements (v1: workspace)

Status: approved 2026-10-03. Prototype: https://claude.ai/artifact/KU9Z831Y9y974EUW1yVcud
(earlier surface directions: https://claude.ai/artifact/PcLSYsadAVzw13RGmePww4)

## Goal

Show the nodes of any tag in a Logseq DB graph, including tags users create, as a Timeline,
Calendar, Agenda or Kanban board, in a workspace that fills the window under the app header.

## User stories

- As someone who plans in Logseq, I pick my own #Project tag and see every project on a
  timeline with how far along it is, so I know what is on track.
- As a task user, I see what is overdue and what is due in the next two weeks in one list.
- As a project lead, I open a month or week calendar and see project spans and the
  deadlines inside them.
- As a team member, I move cards across a Kanban board (Status columns, optional Owner
  swimlanes) and the change is saved on the node.
- As a returning user, I save a view (tag, dates, filters, layout) and it is there on my
  other devices because it lives in the graph.
- As a user of any theme (Inkwell or another), Planner looks like the rest of my Logseq.

## Features

### Across all views
- **Any tag, one or more per view** (N14). Built-in or user-created. A click on a tag in the
  tree shows that tag alone; the checkbox before it adds it to the view or removes it (the
  last tag cannot be removed). A view over several tags shows the union of their nodes, each
  node once; the Tag control reads "#Milestone + #Task". Tags that extend a selected tag are
  included (one toggle for the whole view). Each node belongs to the first selected tag, in
  selection order, that it carries directly or through a tag extending it: that tag gives its
  Start / End, its Tag filter value and its heading in the Timeline arranged by tag.
- **Shared properties** (N14). Filters, Kanban Columns / Swimlanes / Show, Done when and the
  Priority sort offer the choice properties every selected tag has (own or inherited), the
  same property by ident, not by title. One tag shares all of its properties. Depends on
  offers the node properties of any selected tag (a dependency property applies to the nodes
  that have it: #Task's `depends_on` in a #Milestone + #Task view). With two or more
  tags the panel adds a **Tag** filter group (which tags to show) and the Kanban offers **Tag**
  swimlanes, read-only (a card keeps its tag; drops across lanes are refused). Ticking a tag
  drops the filters, done values and Kanban settings the tags no longer share.
- **Dates from each tag's own properties.** Start and End are picked per tag from its Date or
  DateTime properties (own and inherited): with one tag the Start and End menus, with several
  one Dates menu with a row per tag. Defaults per tag: properties named Start/End, else
  Scheduled/Deadline, else the first date property. A node with no Start/End takes its
  span from its linked tasks (drawn dashed). One date = a point. No date = listed apart.
  Planner never creates date properties.
- **Tasks belong to a node by reference.** A #Task block belongs to node N when its
  `:block/refs` contains N (inline link or node property). Rollup = done / (all − canceled).
  **Dependents are not tasks** (N12): when the view has a dependency property, a #Task block T is
  not a task of N if N is among T's values of that property (only values on T itself count); every
  view follows (rollups, task rows, Calendar chips, Agenda, Kanban progress). With None, as above.
  A #Task block that is itself a node of the view (N14: #Task is one of its tags) is its own row
  or entry, never also a task row of another node; it still counts in that node's rollup.
- **Depends on** (N12). A setting after End, shown when a tag of the view has a node-typed property
  (own or inherited, any cardinality): None or one of them. Default: the node property whose title,
  lowercased with non-alphanumerics removed, is `dependson` (`depends_on`, "Depends on",
  "depends-on"), else None. Saved with the view (`dependsOn`); a view saved before it uses the
  default rule; a property the tag no longer has counts as None.
- **Done values.** Built-in Task Status uses its Done/Canceled flags. For a user choice
  property, values named Done, Completed, Canceled, Cancelled or Closed count as done by
  default; the user can change the set; it is saved with the view. Used for rollups,
  Agenda hiding, Kanban and late marking.
- **Late tasks.** A task's due date is its Deadline, or its Scheduled date when it has no
  Deadline. An open task is late when its due day is before today. One rule for every view:
  a red marker in the Timeline (the due date's marker), a red chip in the Calendar (which
  shows Deadlines only), the Agenda's Overdue bucket, filed and counted from the due date.
- **Saved views** stored in the graph on a plugin-owned page (one block per view, config as
  a hidden string property holding JSON). Save current view creates a view; with a saved view
  open, Update stores the current settings in it, name kept; deleting asks first, in the row
  (Cancel / Delete), without a browser dialog (N23). Sync with the graph; reused by the in-page block
  (N06b). A view saved before N14 (one `tag`, `start`, `end`) opens as that
  one tag; a saved view naming a tag that is gone opens with the tags that are left (none left:
  the default view and an error).
- **Live updates.** The open view redraws after graph changes (debounced), keeping scroll
  and expanded rows.
- **Host shortcuts keep working** (desktop app). Keys Planner does not use are passed to Logseq, so Cmd+K,
  Cmd+Shift+P and `t t` work with Planner open; not available in the web app (cross-origin frame).
- **Compact header and focus mode** (N39, owner 2026-10-09; both surfaces). The header is one row: icon tabs for the
  four views (the pressed one named; all named from 640 px), ⤢ focus, ⚙ settings, ⋯ more. ⚙ opens the settings bar
  (Tag, Dates, Depends on, Done when) in place; it starts folded. ⋯ holds Workspace | Sidebar, Panel, Close and Saved
  views. Focus hides the header, the settings bar and the view toolbar behind one strip that names the view and its
  tags; ⌄ brings them back. Both are session state: not saved with a view, not remembered per graph.
- **Layout** (N13). Header, settings bar, then the body: the view (its toolbar, then the view) on
  the left and the **panel** (tag tree and filters, 220 px) on its right, in that reading and Tab
  order. "Sidebar" means Logseq's right sidebar only. A **Panel** toggle, in the ⋯ menu (N39),
  hides and shows the panel (the view then takes the full width); while the panel is hidden
  and filters are ticked, the toggle shows how many values are ticked ("Panel · 2"). The choice is
  remembered per graph (N21; not saved with a view). In a frame narrower than
  640 px the panel is a **drawer** over the view from the right edge, closed by default; Escape
  (after an open menu, before Planner) or a click on the view closes it. Wide and narrow keep their
  own open state, so crossing the width without a toggle follows the defaults.
- **Remembered per graph** (N21, the owner's decision on 2026-10-04: all of it). Planner opens on a graph as it was
  left there: the view on screen (its tags and settings, and the saved view it belongs to), the side panel open or
  closed (wide and narrow apart), the surface, and Edit dates. Kept in the plugin's settings on this device, one entry
  per graph. N41 (2026-10-09, the owner's decision): the view on screen and the Timeline's title column width are also
  written into the graph (a hidden property of the "Planner views" page) and follow it to other devices; the graph's
  copy wins on open. Panel, surface and Edit dates stay on the device. A graph never used opens with the defaults. Stored settings
  that cannot be read, or that name a tag that is gone, give the default view without an error. Not remembered: the
  period on screen, expanded and collapsed rows, open menus.
- **Surfaces** (N06a, reworked by N40). Planner shows in the **workspace** (the window under the app header, the
  default) or in the **sidebar**: docked on the window's right edge, beside the page. A **Workspace | Sidebar** switch in
  the ⋯ menu, before Saved views, picks one; the choice is remembered per graph (N21). Docked, Planner takes 40% of the
  window by default (never less than 320 px, and the page keeps at least 360 px), and a handle on its left edge
  (drag, arrow keys, double-click for 40%) sets the width, kept on this device. Planner **reserves its strip in the
  host layout**, so Logseq's own right sidebar opens to the left of it: opening and closing either one, including the
  host's own toggle button, never moves or closes the other. Closing Planner (Close, Escape, the toolbar button) gives
  the strip back and keeps the mode, so the next open docks again; switching back to Workspace restores the full
  frame; neither touches the host's sidebar. A smaller window pulls a too wide Planner in. Desktop app only: the web
  app's frame cannot read the host document, so the switch is not shown there. Inside the frame nothing changes: the
  header stays one row, and under 640 px the panel is a drawer.
- **In-page block** (N06b). A block `{{renderer :planner, <saved view name>}}` (slash command
  **Planner view**) shows a read-only picture of that saved view inside the page: a header (the
  view's name, its tags "#A + #B", an **Open in Planner** button that opens Planner in the
  workspace on that view) and the same view the workspace draws (Timeline with its zoom, arrange
  and nesting; Calendar; Agenda; Kanban with its hidden columns and swimlanes), anchored on today.
  The name is matched exactly first, then ignoring case; an unknown name shows a message with the
  saved views' names (or "Save a view in Planner first."), an unreadable view its error. A click
  on an item opens the node (no Shift). The block redraws when the graph changes, whether Planner
  is shown or not, and scrolls inside itself (at most 70% of the window's height). The block does
  **not** have: the view toolbar (navigation, zoom, layout, sort), menus, popovers, filters, the
  panel, drag, the Kanban Move menu, Timeline connectors or row toggles (nested children are open,
  task rows folded), "Show more" (it reads "N more"). Its styles are scoped to the block; works in
  the desktop and the web app.
- **Click** opens the node in the main area and hides Planner; **Shift+click** opens it in
  the right sidebar and keeps Planner open.
- **Theme.** Follows the active Logseq theme and light/dark mode; Inkwell values are the
  defaults where Logseq exposes no variable (see `docs/design.md`).
- **Week start** follows Logseq's `preferredStartOfWeek`.

### Timeline
- Zoom **Day** (one day, 24 hour columns), **Week** (wide day columns), **Month** (narrow day columns), **Quarter**
  (week columns).
- **Day** zoom (N10, for work tracked in hours with DateTime properties): the grid is 96 tracks of 15 minutes. A span is
  placed by its times (start rounded down, end rounded up to the quarter hour, at least one quarter hour); a missing
  time is 00:00 for a start and the end of the day for an end, so a Date-only span covers the whole day; a span running
  past midnight is clipped. One-date nodes and task markers sit at their time (Date-only: at 00:00). The today line
  marks the current time. Prev / next move by one day. The view opens scrolled to the day's first timed item (08:00 on
  a day without one) and keeps the user's scroll while the same day is shown.
- One row per node sorted by start; progress strip on each bar; derived spans dashed;
  one-date nodes as diamonds; nodes with tasks expand to task sub-rows; today line; bars
  clipped at the range edge are marked; undated nodes in a footnote. Prev / next / today.
- **Arrange** (N14), shown with two or more tags: **By date** (one list by start), **By tag**
  (a heading row per tag in selection order, then that tag's rows by start) or **Nested** (the
  default with two or more tags). The setting is saved with the view (`arrange`).
- **Nested** (N14): a node C of the view is a child of node P of the view when C references P
  (inline link or node property, not through the Depends on property). Children are full rows
  (own bar or point, own task rows) under their parent, indented, in date order, in place of
  the marker-only task rows for those blocks; top-level rows are by date. With several
  candidate parents a node goes under the first in row order (start, end, title; undated
  last) that is not itself a child; of two nodes that reference each other the later one in
  row order is the child. One level only: a node that has children is never a child, and a
  grandchild is a top-level row. A child whose parent has no row in the range is a top-level
  row. Parents start open; collapsing one (its toggle) is kept for the session, and its
  children then have no row and no connector. A parent's count and progress are its children
  (done by the view's done values, canceled ones left out) plus its linked tasks that are not
  nodes of the view, each block once. The Calendar and the Kanban do not nest.
- **Dependency connectors** (N12): with a Depends on property, a line runs from the right end of each dependency's bar
  (or point) to the left end of its dependent's, with an arrow at the dependent, in every zoom. The line is one
  S curve (N20, the owner's choice on 2026-10-04: a curve does not read as bars overlapping), level where it leaves
  and where it arrives, also when the two bars touch or the dependent starts before the dependency ends. Only pairs whose both nodes have a
  row in the range (after filters) are drawn. One neutral colour; lines never take the pointer. A bar or point with
  dependencies adds ", depends on A, B" to its label, so the relation is not visual only. No dragging to create or edit
  dependencies, no connectors in other views, no critical path, no lag / lead.
- **Edit dates** (N06c; v1 was read-only by the owner's decision): a toolbar toggle, off by default, remembered per graph
  (N21; not saved with a view). Workspace and sidebar surfaces only, never the in-page block. When on: drag a bar's body to
  move it (Start and End shift by the same number of tracks), drag its first or last 6 px to change that end only; a
  one-date point moves. Deltas snap to the zoom's track (a day; 15 minutes in Day zoom); a span keeps at least one track
  and its start on or before its end, and nothing is dragged off the range. A drag under 4 px is a click (opens the
  node); Escape or a cancelled pointer aborts with no write. Only the node's own mapped Start / End are written: spans
  derived from tasks, task markers and Date values in Day zoom are locked (default cursor, no handles); a bar clipped at
  an edge has no handle on that side. A DateTime keeps its time of day when moved by days (local calendar arithmetic).
  Keys on a focused bar: Alt+Left / Right move it one track, Alt+Shift+Left / Right change its End (its Start when only
  the Start can change). Writes: DateTime = epoch ms, Date = the day's journal page id (`createJournalPage` at local
  noon, so it may create that journal page); each read back; optimistic (the bar shows its new place, pending, until the
  write settles); on failure the bar returns and the error bar says why; when the second of two writes fails the first
  is put back and the error says whether that worked (as a Kanban move).
- Only nodes that touch the range get a row. The dated nodes wholly outside it are counted on
  one line above the grid ("412 earlier · 1,105 later"); each side is a button that moves the
  range to the nearest of those nodes (approved 2026-10-03, T13a: at 2,000 nodes the out-of-range
  rows made most of the Timeline's DOM).

### Calendar
- **Month** and **Week** layouts, all-day only (no hour grid, no day view).
- Span nodes as bands with stable lanes; point nodes as chips; **linked tasks' deadlines**
  as chips in their node's colour (Scheduled dates not shown).
- Week: one column per day, items sorted by time, DateTime time shown as a label.
- Month: up to 3 items per day, then "+N more" (opens that week). Prev / next / today.

### Agenda
- **Overdue**, then each of the **next 14 days**, then collapsed **Later** and **No date**
  (and **Earlier** for tags without a done notion, e.g. meetings).
- Group by **node** (progress, open tasks, overdue first) or by **date**. By node over two or
  more tags (N14), a child node (see Timeline, Nested) is an entry of its parent's group, with
  its own dates and late state, followed by its own tasks; it gets no group of its own.
- Done and canceled hidden; **Show done** reveals those in the range.
- Folded buckets render their entries only once opened (the heading always shows the count);
  by node, the first 100 groups render, then "Show 100 more of N" (T13a). A task linked to several nodes is
  listed under each of them by node (and counts as open in each; once within a nested parent's group), and once,
  under the first, by date (N30).

### Kanban
- Columns = closed values of a chosen choice property (default Status) + "No <prop>".
- **Show**: choose which columns show (a checkbox per value, in order, plus "No <prop>"; the
  button reads "All" or "3 of 7"). Hidden columns and their cards leave the board; column
  counts of the shown columns are unchanged, lane counts count the cards shown, every lane
  stays. At least one column stays shown. Stored in the view config per column property
  (`hiddenColumns`), so switching the column property and back keeps each choice; a saved
  view without it shows every column; values that no longer exist are ignored. The Move menu
  still lists every value: moving a card to a hidden column takes it off the board (N08).
- **Card contents** (N38, N42; owner 2026-10-09): a card shows its title, progress, due text and Priority. In a view of
  two or more tags it starts its meta line with its tag (`#Task`). **Card fields** (toolbar menu after Swimlanes,
  one group per view tag): which other properties show on the card, any simple property of the tag, own or
  inherited: choice, Date / DateTime, text, number, checkbox, URL, and node / page refs by title (no rich blocks; hidden
  properties and the column, lane and Priority properties are not offered). Each is a bare value, the property's name
  as its tooltip (a checkbox shows its name when ticked); a Date or DateTime reads as the due text does ("6 Oct
  09:00"); several values are joined in one chip, cut at the card's width. The choice is the tag's own list, saved with
  the view (`cardFields`); a tag without one shows the default, the choice properties the tags share (what cards showed
  before), less the ones switched off (`hiddenFields`), so an existing view looks the same. The query stays narrow: only
  the chosen text, number, checkbox, URL and node properties add an attribute to the node pull (the T13a speed-up holds
  for every view that has none).
- Optional **swimlanes** by a second choice property + "No <prop>" lane.
- Cards sorted by **due/end date** (default), **priority** or **title**; no manual order.
- Drag writes the column property, and the lane property when moved across lanes; dropping
  on "No <prop>" removes the value. Optimistic, rolled back if the write fails; when a move
  needs two writes and the second fails, the first property is written back to its previous
  value, and the error says whether that worked (T14).
- A cell renders its first 50 cards (plus a card being moved), then "Show 50 more of N";
  column and lane counts stay the real totals (T13a).

## Technical approach

- TypeScript, plain DOM (no UI framework), Vite, Vitest; `@logseq/libs` pinned per the
  `next` dist-tag (floor ^0.3.4; 0.2.12 drops the last `datascriptQuery` input).
- Standard file set from the logseq-plugin-dev skill: `src/index.ts` entry (only file that
  imports `@logseq/libs`), `src/__sdk_guard__.ts`, `src/types.ts`, cache-first
  `src/storage.ts` (saved views, graph-backed), CLAUDE.md, tasks.md, CHANGELOG.md.
- From Query Builder: pure core (`src/core/*`, no DOM, no SDK) separate from `src/ui/*`;
  every SDK cast in `src/sdk.ts`; SDK calls injected so tests pass fakes; co-located
  `*.test.ts`, DOM tests opt into happy-dom per file; dev-only code behind
  `import.meta.env.DEV`; pinned dev port 8293 (preview 8294) with `--strictPort`.
- Data access: datascript queries for tag schema (incl. `:logseq.property.class/extends`),
  tagged nodes with mapped properties, and #Task refs. Pulls name the attributes they read
  (no `pull [*]`), and the task query is bound to tasks that reference a node of the view's tags
  (one node query and one task query per load, the tags' entity ids as one collection input). Date (journal ref) and DateTime (ms)
  both normalised to local ISO days; DateTime keeps HH:MM for labels.
- Writes: saved views (hidden string property, schema ensured before each write), Kanban
  moves (closed-value property write) and, with Edit dates on, Timeline date edits (Date / DateTime property write,
  N06c). Nothing else.
- Performance target: up to ~2,000 nodes of the chosen tags (their union), loaded at once and filtered in
  the plugin. First view < 1 s; redraw after a change < 300 ms.
- Workspace frame per the skill's ui-positioning recipe, but starting at the host header's lower edge (top and
  height from `--ls-headbar-height`, fallback 3rem), so the window moves by the header, zooms on a header
  double-click and resizes by its edges as usual (N15); registrations deferred out of
  `main()`; debounced `DB.onChanged` plus a slow poll because hidden iframes throttle timers.

## Non-goals (v1)

- A detail/edit panel. (Dragging or resizing to change dates was a v1 non-goal; it is in scope since N06c, behind the
  Timeline's Edit dates toggle.)
- Views defined by a free query; different filters per tag.
- Repeating tasks; the Calendar's day view and hour grid (the Timeline's Day zoom is in scope); Timeline year zoom.
- Kanban manual card order; Agenda ranges other than 14 days.
- Creating properties on the user's tags (e.g. a one-click "add Start/End").
- Marketplace release (prepared after v1 works).

## Open questions (answered by the live probe, tasks.md T01)

- Does `DB.onChanged` fire for changes from sync and other windows?
- Exact API shape of class properties, inherited properties and closed values.
- Does a closed-value write via `upsertBlockProperty` work for user choice properties and
  built-in Status alike, and does Undo revert it?
