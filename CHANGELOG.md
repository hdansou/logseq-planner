# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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

### Fixed
- Theme (T07): a host font family is followed by a generic fallback stack, so a family the frame cannot load no
  longer renders in serif; `--pl-tint-soft` is derived from `--pl-tint` instead of the host's `--accent` (the default
  theme sets it to the strong primary, which made selected rows unreadable); focus is a 2px `--pl-ring` outline.
- Workspace (T07): opens on the first own root tag with dates (not a child tag that sorts first); the linked-task
  count covers the filtered nodes only; built-in tags start collapsed behind a disclosure button and open when a
  built-in tag is selected.
- Saved views (T07): when appending a view fails, the page is looked up again, so a page moved to Recycle
  mid-session gives the Recycle guidance instead of "appendBlock returned no block".

### Changed
- The saved-views page lookup ignores a page in the recycle bin (`deleted-at`), so views are no longer appended to a recycled page.
- Done-value override is now a list of closed-value uuids, not titles (a rename no longer breaks it).
