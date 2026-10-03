# Planner v1 spec

Status: approved decisions, 2026-10-03. Prototype: https://claude.ai/artifact/KU9Z831Y9y974EUW1yVcud
(earlier directions: https://claude.ai/artifact/PcLSYsadAVzw13RGmePww4)

## Goal

Show the nodes of any tag in a Logseq DB graph, including tags users create, as a Timeline,
Calendar, Agenda or Kanban board, in a full-screen workspace.

## Users

People who plan in Logseq DB graphs: tasks (#Task), their own project tags (#Project),
meetings, client work. They want to see what is due, how projects are going, and move
cards through a workflow, without leaving Logseq.

## Constraints

- Must: work with DB graphs only (`supportsDB`), any tag, built-in or user-created.
- Must: read both date property types: Date (ref to a journal page) and DateTime (ms).
- Must: include tags that extend the chosen tag (`:logseq.property.class/extends`), with a toggle.
- Must: follow the Logseq theme (light/dark, tokens copied into the iframe).
- Must: respect Logseq's start-of-week setting (`preferredStartOfWeek`).
- Must not: add schema to the user's graph other than the plugin's own saved-view storage.
- Must not: write anything except (a) saved views, (b) a Kanban card move (column and lane).
- Performance: comfortable up to ~2,000 nodes of the chosen tag (load all, filter in plugin).
  Open-to-first-view under 1 s on such a graph; live redraw after a change under 300 ms.

## Design decisions

1. **One tag per view.** A view = tag (+ child tags) + start/end mapping + filters + view
   type + Kanban column property. Alternatives: several tags per view (later, if asked).
2. **Dates come from the tag's own date properties.** The user picks Start and End from
   the tag's Date/DateTime properties (own and inherited). If unset, a node's span comes
   from its tasks' dates (shown as derived). If only one date exists, the node is a point.
   No new Start property is created.
3. **Tasks belong to a node by reference.** A #Task block belongs to node N when its
   `:block/refs` contains N (inline link or node property). Tasks with no ref are not
   rolled up. Rollup = done / (all − canceled).
4. **Kanban columns come from a choice property** of the tag (closed values), default
   Status when present; a "No <prop>" column holds nodes without a value.
5. **Read-only except Kanban.** Dragging a card writes its column property (and lane property
   when swimlanes are on); dropping on "No <prop>" removes the value. Date dragging is out
   of v1.
6. **Saved views live in the graph** on a plugin-owned page, one block per view, config
   stored as a hidden string property holding JSON (string + hide, per the DB plugin
   lessons). They sync with the graph and are reusable by the later panel and block.
7. **Live updates.** `DB.onChanged` triggers a debounced reload (~250 ms) of the open view;
   scroll position and expanded rows are kept.
8. **Click opens the node** in the main area and hides the workspace; Shift+click opens it
   in the right sidebar and keeps the workspace open.
9. **Stack:** TypeScript, no UI framework, Vite, Vitest + happy-dom, `@logseq/libs ^0.3.4`
   (same as Query Builder). Pure logic is separated from the host adapter so it can be
   tested without Logseq.

10. **"Done" for any tag.** Built-in Task Status uses its Done/Canceled flags. For a user
    choice property, values named Done, Completed, Canceled, Cancelled or Closed count as
    done by default; the view settings let the user tick which values mean done. Saved
    with the view. Used for rollups, Agenda hiding, Kanban and "late" marking.

## Views

### Calendar
- Layouts: **Month** and **Week**. No day view (Agenda covers it) and no hour grid.
- Week view: 7 day columns, items sorted by time; a DateTime value's time shows as a label
  on the card (`10:00`). Spans run as bands across the top of the week.
- Content: the tag's span nodes as bands (stable lanes), point nodes as chips, and the
  **deadlines of linked tasks** as chips in their node's color. Task Scheduled dates are
  not shown.
- Month: up to N items per day, then "+N more". Navigation: previous, next, today.
- Week start follows `preferredStartOfWeek`.

### Timeline
- Zoom: **Week** (one column per day, wide), **Month** (narrow day columns),
  **Quarter** (one column per week).
- Rows: one per node, sorted by start; a node with linked tasks expands to task sub-rows.
  Bars show % done; derived spans dashed; one-date nodes as diamonds; today line;
  undated nodes listed in a footnote. Bars clipped at the range edge are marked.
- No dependency arrows (Logseq has no dependency property).

### Agenda
- Range: **Overdue**, then each of the **next 14 days**, then collapsed **Later** and
  **No date** sections.
- Group by node (progress + open tasks, overdue first) or by date.
- Done and canceled are hidden; a **Show done** toggle shows items completed in the range.
- Tags without linked tasks list their own nodes as Upcoming / Earlier.

### Kanban
- Columns: closed values of a chosen choice property (default Status), plus "No <prop>".
- **Swimlanes** (optional): rows by a second choice property, plus "No <prop>" lane.
- Card order inside a column: **sorted by a field**, due/end date by default, or priority,
  or title. No manual ordering.
- Dragging a card writes the column property; dragging it across lanes also writes the
  lane property. Dropping on a "No <prop>" column or lane removes that value.
- Cards: title, progress (when tasks link to it), other choice props, due/end date with
  late marking; tasks show their referenced node.

## Data model (plugin side)

```
TagInfo      { id, ident, title, own: boolean, parentId?, dateProps: PropInfo[], choiceProps: PropInfo[] }
PropInfo     { ident, title, type: 'date' | 'datetime' | 'choice', values?: { id, title }[] }
ViewConfig   { id, name, tagId, includeChildren, start: ident | 'derive', end: ident | 'derive',
               view: 'timeline' | 'calendar' | 'agenda' | 'kanban', kanbanBy?: ident,
               calendarLayout: 'month' | 'week', timelineZoom: 'week' | 'month' | 'quarter',
               agendaGroup: 'node' | 'date', showDone: boolean,
               kanbanLane?: ident, kanbanSort: 'due' | 'priority' | 'title',
               doneValues: valueId[], filters: Record<ident, valueId[]> }
PlannerNode  { id, uuid, title, tagIds, props: Record<ident, value>, start?, end?, derived,
               tasks: TaskRef[], done, total }
TaskRef      { id, uuid, title, status, scheduled?, deadline? }
```

Dates inside the plugin are local ISO day strings (`YYYY-MM-DD`).

## Out of scope (v1)

- Side panel and in-page block surfaces (next, in that order).
- Dragging or resizing to change dates; editing in a detail panel.
- More than one tag per view.
- Repeating tasks; calendar day view and hour grid; Timeline year zoom; dependency arrows.
- Kanban manual card order; Agenda horizon other than 14 days.
- Marketplace release (prepared after v1 works).

## Open questions

- Does `DB.onChanged` fire for changes from sync and other windows? (Probe, task 1.)
- Exact shape of class properties and inherited properties from the API. (Probe, task 1.)
- Does writing a closed value with `upsertBlockProperty` work for user choice properties and
  built-in Status alike, and does it land in undo history? (Probe, task 1.)
