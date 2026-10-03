# Planner — requirements (v1: workspace)

Status: approved 2026-10-03. Prototype: https://claude.ai/artifact/KU9Z831Y9y974EUW1yVcud
(earlier surface directions: https://claude.ai/artifact/PcLSYsadAVzw13RGmePww4)

## Goal

Show the nodes of any tag in a Logseq DB graph, including tags users create, as a Timeline,
Calendar, Agenda or Kanban board, in a full-screen workspace.

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
- **Any tag, one per view.** Built-in or user-created; tags that extend it are included
  (toggle). Filters come from the tag's choice properties.
- **Dates from the tag's own properties.** Start and End are picked from the tag's Date or
  DateTime properties (own and inherited). Defaults: properties named Start/End, else
  Scheduled/Deadline, else the first date property. A node with no Start/End takes its
  span from its linked tasks (drawn dashed). One date = a point. No date = listed apart.
  Planner never creates date properties.
- **Tasks belong to a node by reference.** A #Task block belongs to node N when its
  `:block/refs` contains N (inline link or node property). Rollup = done / (all − canceled).
- **Done values.** Built-in Task Status uses its Done/Canceled flags. For a user choice
  property, values named Done, Completed, Canceled, Cancelled or Closed count as done by
  default; the user can change the set; it is saved with the view. Used for rollups,
  Agenda hiding, Kanban and late marking.
- **Saved views** stored in the graph on a plugin-owned page (one block per view, config as
  a hidden string property holding JSON). Sync with the graph; reused later by the side
  panel and in-page block.
- **Live updates.** The open view redraws after graph changes (debounced), keeping scroll
  and expanded rows.
- **Click** opens the node in the main area and hides Planner; **Shift+click** opens it in
  the right sidebar and keeps Planner open.
- **Theme.** Follows the active Logseq theme and light/dark mode; Inkwell values are the
  defaults where Logseq exposes no variable (see `docs/design.md`).
- **Week start** follows Logseq's `preferredStartOfWeek`.

### Timeline
- Zoom **Week** (wide day columns), **Month** (narrow day columns), **Quarter** (week columns).
- One row per node sorted by start; progress strip on each bar; derived spans dashed;
  one-date nodes as diamonds; nodes with tasks expand to task sub-rows; today line; bars
  clipped at the range edge are marked; undated nodes in a footnote. Prev / next / today.

### Calendar
- **Month** and **Week** layouts, all-day only (no hour grid, no day view).
- Span nodes as bands with stable lanes; point nodes as chips; **linked tasks' deadlines**
  as chips in their node's colour (Scheduled dates not shown).
- Week: one column per day, items sorted by time, DateTime time shown as a label.
- Month: up to 3 items per day, then "+N more" (opens that week). Prev / next / today.

### Agenda
- **Overdue**, then each of the **next 14 days**, then collapsed **Later** and **No date**
  (and **Earlier** for tags without a done notion, e.g. meetings).
- Group by **node** (progress, open tasks, overdue first) or by **date**.
- Done and canceled hidden; **Show done** reveals those in the range.

### Kanban
- Columns = closed values of a chosen choice property (default Status) + "No <prop>".
- Optional **swimlanes** by a second choice property + "No <prop>" lane.
- Cards sorted by **due/end date** (default), **priority** or **title**; no manual order.
- Drag writes the column property, and the lane property when moved across lanes; dropping
  on "No <prop>" removes the value. Optimistic, rolled back if the write fails.

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
  tagged nodes with mapped properties, and #Task refs. Date (journal ref) and DateTime (ms)
  both normalised to local ISO days; DateTime keeps HH:MM for labels.
- Writes: saved views (hidden string property, schema ensured before each write) and Kanban
  moves (closed-value property write). Nothing else.
- Performance target: up to ~2,000 nodes of the chosen tag, loaded at once and filtered in
  the plugin. First view < 1 s; redraw after a change < 300 ms.
- Full-screen main UI per the skill's ui-positioning recipe; registrations deferred out of
  `main()`; debounced `DB.onChanged` plus a slow poll because hidden iframes throttle timers.

## Non-goals (v1)

- Side panel and in-page block surfaces (next, in that order).
- Dragging or resizing to change dates; a detail/edit panel.
- More than one tag per view.
- Repeating tasks; calendar day view and hour grid; Timeline year zoom; dependency arrows.
- Kanban manual card order; Agenda ranges other than 14 days.
- Creating properties on the user's tags (e.g. a one-click "add Start/End").
- Marketplace release (prepared after v1 works).

## Open questions (answered by the live probe, tasks.md T01)

- Does `DB.onChanged` fire for changes from sync and other windows?
- Exact API shape of class properties, inherited properties and closed values.
- Does a closed-value write via `upsertBlockProperty` work for user choice properties and
  built-in Status alike, and does Undo revert it?
