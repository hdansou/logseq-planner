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
