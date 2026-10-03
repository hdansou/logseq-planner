# Planner

Timeline, Calendar, Agenda and Kanban views over any tag in a Logseq DB graph, in a
full-screen workspace.

> **DB graphs only.** Planner reads tags as classes and their Date, DateTime and choice
> properties.

Status: in development (v1 scaffold). The workspace opens empty; the views arrive in later
tasks (see [tasks.md](tasks.md)).

## Usage

- Click the calendar button in the toolbar, or run **Planner: open** from the command
  palette.
- Press **Escape** or click **Close** to hide it.

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
