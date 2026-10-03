# Planner

Timeline, Calendar, Agenda and Kanban views over any tag in a Logseq DB graph, in a
full-screen workspace.

> **DB graphs only.** Planner reads tags as classes and their Date, DateTime and choice
> properties.

Status: in development. The workspace shell works (tag, dates, done values, filters, saved
views); the four views arrive in later tasks (see [tasks.md](tasks.md)).

## Usage

- Click the calendar button in the toolbar, run **Planner: open** from the command
  palette, or press **g** then **Shift+P** while not editing a block.
- Pick a tag in the left column or the **Tag** menu; Start, End and done values follow the
  tag's own properties and can be changed in the settings bar. Tick choice values in the
  left column to filter (nothing ticked = everything shown).
- **Saved views** (top bar) saves the current view to the page "Planner views" in the graph,
  opens a saved one or deletes it.
- Press **Escape** (closes an open menu first) or click **Close** to hide Planner.

## Development

```bash
npm install
npm run dev        # Vite dev server at http://localhost:8293 (preview: 8294)
npm run typecheck  # tsc --noEmit
npm test           # Vitest
npm run build      # Production build into dist/
```

In Logseq: Settings > Advanced > Developer mode, then Plugins > ⋯ > Load plugin from web
url > `http://localhost:8293/`.

## License

MIT
