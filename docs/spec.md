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
- Must not: write anything except (a) saved views, (b) a Kanban card move.
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
5. **Read-only except Kanban.** Dragging a card writes that one choice property; dropping on
   "No <prop>" removes it. Date dragging is out of v1.
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

## Data model (plugin side)

```
TagInfo      { id, ident, title, own: boolean, parentId?, dateProps: PropInfo[], choiceProps: PropInfo[] }
PropInfo     { ident, title, type: 'date' | 'datetime' | 'choice', values?: { id, title }[] }
ViewConfig   { id, name, tagId, includeChildren, start: ident | 'derive', end: ident | 'derive',
               view: 'timeline' | 'calendar' | 'agenda' | 'kanban', kanbanBy?: ident,
               agendaGroup: 'node' | 'date', filters: Record<ident, valueId[]> }
PlannerNode  { id, uuid, title, tagIds, props: Record<ident, value>, start?, end?, derived,
               tasks: TaskRef[], done, total }
TaskRef      { id, uuid, title, status, scheduled?, deadline? }
```

Dates inside the plugin are local ISO day strings (`YYYY-MM-DD`).

## Out of scope (v1)

- Side panel and in-page block surfaces (next, in that order).
- Dragging or resizing to change dates; editing in a detail panel.
- More than one tag per view.
- Repeating tasks, time-of-day / hour grids (week and day calendar views).
- Marketplace release (prepared after v1 works).

## Open questions

- Does `DB.onChanged` fire for changes from sync and other windows? (Probe, task 1.)
- Exact shape of class properties and inherited properties from the API. (Probe, task 1.)
- Does writing a closed value with `upsertBlockProperty` work for user choice properties and
  built-in Status alike, and does it land in undo history? (Probe, task 1.)
