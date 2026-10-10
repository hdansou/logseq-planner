# Dock order: plugins docked on the window's right edge

Logseq has no dock slot for plugins. Two that pin a frame to `right: 0` cover each other, and each reserves the
space with a `margin-right` on the same `#app-container-wrapper`, so the host reserves one strip, not both
(seen 2026-10-10: Planner over Outline Canvas). This is the contract Planner (N44, N45) and Outline Canvas share.
Both repos carry the same code (`src/ui/dock-neighbours.ts` here, `src/dock.ts` there): keep them equal.

1. **Stamp.** A plugin that docks puts `data-dock-seq="<n>"` on its own container
   (`.lsp-iframe-sandbox-container[data-pid=<id>]`), `n` = one above every stamp on the page, and removes it when it
   stops docking (hides, or goes full-screen).
2. **Yield.** It sits to the left of every *visible* container stamped lower than its own, or not stamped at all (a
   plugin that does not know the contract): `right = offset`, `offset` = the widest of those frames' distance from the
   window's right edge (frames not touching the edge, full-screen and empty ones are ignored). It ignores higher stamps:
   whoever docked first keeps the edge.
3. **Reserve.** Its host rule sets `margin-right: offset + width !important` on `#app-container-wrapper`, under
   `:root` repeated `rank + 1` times (`rank` = how many frames it yields to) before `body:has(<own container visible>)`,
   so on the shared wrapper the innermost plugin's rule, the widest strip, outranks the others'.
4. **Follow.** It watches the frames it yields to (class, style, stamp, added frames) and the window's size, and
   re-measures; it never watches its own frame.

A plugin that does not know the contract still works: it is treated as docked first. It will cover a later plugin only
if it is itself stamped lower, which never happens.
