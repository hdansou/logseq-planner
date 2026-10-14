# Contributing

How to build, test and change Planner. The conventions come from [CLAUDE.md](CLAUDE.md).

## Development

```bash
npm ci
npm run dev        # Vite dev server on http://localhost:8293 (--strictPort); removes dist/ first
npm run preview    # serves the build on http://localhost:8294 (--strictPort)
npm run typecheck  # tsc --noEmit
npm test           # Vitest, src/**/*.test.ts and scripts/**/*.test.mjs
npm run build      # production build into dist/
npm run probe      # live probe and seeds; see docs/probes.md
npm run tracker    # mirror tasks.md into the planner-project graph (see below)
```

Load the dev server in Logseq with Settings > Advanced > Developer mode, then Plugins >
Load plugin from web url > `http://localhost:8293/`.

`npm run probe` drives a Logseq web app that is already open and refuses any graph other than
`plugin-test` or `Demo`. Options:

- `--seed`: import the small seed (`scripts/seed.edn.mjs`).
- `--seed-large [N]`: import the load-test seed of N nodes, 2,000 by default
  (`scripts/seed-large.edn.mjs`).
- `--writes`, `--other-window`: record write and multi-window behavior.
- `--timings`: print the dev-only load and refresh timings.

Tests sit next to the code as `src/**/*.test.ts`. The pure core runs in Node. DOM tests start
with `// @vitest-environment happy-dom`. SDK calls are injected, so tests pass fakes, and
core tests use the probe fixtures in `src/core/__fixtures__/`.

Conventions (from [CLAUDE.md](CLAUDE.md)):

- One item of [tasks.md](tasks.md) per change. Write its acceptance test first.
- Commit subjects are `feat|fix|docs(...): summary (Tnn)`. Docs go in the same commit as the
  code.
- `npm run typecheck`, `npm test` and `npm run build` pass before every commit.
- Live checks use the `plugin-test` graph only.

Further reading:

- [ARCHITECTURE.md](ARCHITECTURE.md): the code map, data flow and design decisions.
- [REQUIREMENTS.md](REQUIREMENTS.md): scope and acceptance criteria.
- [docs/design.md](docs/design.md): visual design and theme tokens.
- [docs/probes.md](docs/probes.md): what the live probe observed about the Logseq API.
- [docs/manual-test.md](docs/manual-test.md): the end-to-end checklist and its results.

# Project tracker graph

`npm run tracker` mirrors this repository's task list into a Logseq DB graph, so Planner has
real project data: one `#Project` (Planner), one `#Milestone` per group of tasks, and one
`#Task` per item of [tasks.md](tasks.md) (id in the title, Status from the checkbox, Team,
Owner, Milestone, depends_on). **tasks.md is the source of truth; the graph is a copy.** Run it
after each task; it only writes differences, so a second run changes nothing. Groups, team and
owner overrides live in `scripts/tracker-meta.json`; a task in tasks.md that is in no milestone
stops the run.

**Start, End and Scheduled are a planned schedule, not history.** Every task gets 2 hours and
starts after the tasks it depends on, so dates before today are planned values, not the time the
work happened. The rule:

- Order: tasks with at least one commit naming `(ID)` come first, by first-commit time (ties by
  id), then the others by id (T before N, numeric). Commit times only order the tasks and set
  Doing; they are never written as dates.
- Dependency: a task without an entry in `after` depends on the previous one in that order (the
  first has none). A task starts at the latest End of its dependencies, so dependencies only set
  the earliest start: tasks with no dependency between them overlap (no resource limit).
  "depends_on" holds all of a task's dependency blocks (node property, cardinality many).
- Working time: weekdays 09:00-17:00 local time. A start outside it (before 09:00, at or after
  17:00, a weekend) moves to the next working moment; a task that would pass 17:00 continues the
  next working day at 09:00.
- Graph values: task Start = scheduled start, End = scheduled end, Scheduled = Start (epoch ms of
  the local time). A milestone's Start / End = earliest Start / latest End of its tasks; the
  project's Start = the first task's Start (no End). Backlog tasks are scheduled like any other.

Meta keys (`scripts/tracker-meta.json`): `scheduleStart` (`"2026-09-25T15:00"`, local time without
zone; a fixed constant, never taken from the clock, so a rerun gives the same dates), `taskHours`
(2), optional `"hours": {"N05": 4}` per task and `"after": {"N05": ["N04", "N03"]}` (ids) to
replace the default dependency; `"after": {"T00": []}` means no dependency (starts at
`scheduleStart`). Every current task has an entry. An `after` naming an unknown id, or a
dependency cycle, stops the run. `scheduleStart` is chosen so the last committed task ends Fri
2 Oct 2026 17:00.

The CLI cannot create a node-typed property, so "depends_on" comes from the EDN the graph is
created with: a graph made before N11 lacks it and the run says so; remove it
(`logseq graph remove -g planner-project`, with no app holding it) and run again.

```bash
npm run tracker                       # graph planner-project (created on the first run)
npm run tracker -- --graph <name>     # another graph
npm run tracker -- --dry-run          # print the CLI calls, write nothing
```

It drives the `logseq` CLI (no shell) and checks the CLI revision first (`--revision`, default
`8ffbb22`). The graph is created and imported once; later changes use `logseq upsert`, so they
work while the desktop app has the graph open. Logic and CLI shapes: `scripts/tracker-lib.mjs`,
`scripts/tracker.mjs`.
