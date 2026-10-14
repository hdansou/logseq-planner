# Limits and known issues

Planner 1.3.0 was validated in the Logseq desktop app
(Logseq-DB nightly builds of 2026-10-01 to 2026-10-13, and the stable Logseq.app 2.0.2, revision 533ac43; an earlier
pass on build b09316a) and partly in the Logseq web app.

These come from the progress log in [tasks.md](../tasks.md) and the results in
[docs/manual-test.md](manual-test.md).

**Scope**

- Planner writes only Kanban and Matrix moves, date moves (When in the Kanban and the Matrix, Agenda and Calendar drags), its UI state and, with
  Edit dates on, date edits in the Timeline and the Calendar grids. The in-page view never edits anything.
- Edit dates was checked live on the desktop app (move and resize of a DateTime and a Date span, Day zoom, Escape,
  Alt+Arrow keys). Not checked: a diamond, a failed write, the sidebar surface, the block staying read-only (unit-tested
  only), Logseq's Undo after an edit, and pointer capture when the pointer leaves the frame.
- The Matrix was checked live on the stable Logseq.app 2.0.2 and a nightly (2026-10-12): quadrants, Every value, a
  drag and a ⋯ menu move (both read back), dark mode, the narrow layout and the in-page block. The drag used in-app
  input over CDP, not a real mouse. When as an axis was checked with a real mouse on a nightly (2026-10-13). It has no
  date range yet: it shows every node of the tag that is not done.
- No view defined by a free query, no filters per tag. No zoom of the Calendar's hour height or collapsing of working hours, no year zoom in the Timeline, no manual card order in Kanban, no Agenda range other than 14 days.
- The sidebar surface is desktop only. It was checked live there, with a real-mouse drag of Logseq's sidebar handle
  on the stable app; not the narrow drawer while docked, and not the web app (which shows no switch).
- The in-page block was checked live on the desktop app, but not the slash command (the caret lands after `}}`), the
  host's page styles outside the block (beyond one font size), clicks on a bar or a Kanban card, Open in Planner while
  docked, Logseq's default themes, or the web app.

**Where it was tested**

- Desktop app: Logseq-DB 2.0.1 nightly builds (2026-10-01 and later), on CLI-seeded persisted graphs. The checks were the
  focused desktop pass in docs/manual-test.md, the sidebar and in-page block rows, and Edit dates. Most of the older
  checklist rows (sections A to J) were run in the Logseq web app dev build of 2026-09-02 (checkout `d2ab7726ab`) on an
  in-memory test graph in headless Chrome, and not repeated on the desktop.
- Stable Logseq.app 2.0.1 (build b09316a): a focused pass on 2026-10-04 with real mouse input (docs/manual-test.md,
  "Stable app pass"): the top bar, window move and resize, the sidebar handle, Edit dates in both surfaces, saved
  views, the remembered state across restarts and graphs, and the Content-Security-Policy. It found and fixed three
  problems there. The rest of the checklist was not repeated on it. No other Logseq build was tested.
- Real mouse clicks were checked on the desktop top bar only after the first desktop pass failed on them (fixed); later
  passes mostly used in-app clicks over CDP because the window could not be brought to the front.
- Sync is untested. Changes that arrive by sync are caught by the 30-second check, not by an event. A second desktop
  window on the same graph refreshes within about 2.5 s. `DB.onChanged` was seen firing for local edits, another
  browser tab, the plugin's own writes and undo.
- Switching graphs in one session is covered by unit tests only; the fix has not been re-run live.
- Dragging to a Kanban column that is scrolled out of view did not register in the web test tool (it passes on the
  desktop through auto-scroll), and dragging from the card's button in Firefox was not checked. Use the Move menu.
- Logseq's default dark theme was checked on the Timeline only. VoiceOver was not tried.
- In docs/manual-test.md, some rows are marked partial or not run; the file lists them.

**Behavior**

- Deleting a tag does not trigger a refresh. The tag stays listed until the next graph change
  or the 30-second check. Planner then falls back to the default view and shows a message.
  A created tag appears at once.
- If the page "Plugin views: Planner" is in Recycle, saving fails with a message. Restore the page or
  delete it in Recycle (More menu), then save again. Planner does not restore it for you.
- Reopening Planner after it was hidden with stale data runs two reloads; the second changes
  nothing.
- A Date property value that points at no journal page (for example a value Logseq left as
  its empty placeholder) counts as no value.
- Nodes and tasks in Recycle, or on a page in Recycle, are not shown.
- A choice property that allows several values is not offered for filters, Kanban or done
  values.

**Large tags**

Measured on one tag with 2,000 nodes and about 2,000 linked tasks, in the web app, dev
build, headless Chrome (T13a, after commit 4d45a0b):

| Measure | Result |
|---|---|
| First load | 326 to 350 ms (target: under 1 s) |
| Live refresh (`refresh.totalMs`, five edits per view) | Timeline 179 to 184 ms, Calendar 165 to 169 ms, Agenda 169 to 179 ms, Kanban 181 to 186 ms (two Timeline runs at 260 ms) |
| End of a write to the redraw | about 215 to 235 ms with the 50 ms debounce, with occasional runs near 310 ms (target: under 300 ms) |

On the desktop app (production build, 2,000 nodes) a tag switch took 351 ms to the first paint and a Kanban refresh
294 to 373 ms (over the 300 ms target on 4 of 5 runs). A graph where few tasks link the tag was not measured.
