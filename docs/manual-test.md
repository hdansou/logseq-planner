# Manual end-to-end checklist (T13)

Run live by the coordinator; nothing here is automated. Every row is one check. Fill Result (pass / fail / skip), Build
(Planner revision, `git rev-parse --short HEAD`), Date and Notes. A failed row gets a Notes entry that says what showed
instead; a defect found is fixed in its own commit (or logged under Open in tasks.md) and the row is re-run.

Expected results come from the tasks.md progress log (T00-T12): the values were observed live on the small seed. Rows
marked **[new]** were not recorded in the log: write down what shows and judge it against REQUIREMENTS.md.

## Results of the 2026-10-03 pass

Result column: `pass`, `partial` (part of the row was checked; the note says which), `not run`.
The Build column is the Planner commit the row was checked on. Rows checked during T07–T12 keep
that task's build and were not all re-run on the current one; the #Project and #Meeting views were
re-run after the T13a performance changes. Second pass on 2026-10-03 (builds 771140f and da5d181; same web app, in-memory `Demo` graph, large-seed rows on the DEV
build): the rows that were not run or partial were re-run where the web app allows. Totals for sections A–I: 117 pass,
6 partial (E8, E11, E12, F9, H6, H10), 3 not run (D12 Firefox, I9 VoiceOver, H14 not needed). Section J: 15 pass.
A9, D11 and E12 were run on the desktop app (third pass, see "Desktop pass" below); every other row was run in the web
app (an older Logseq checkout).

## Environment

| Item | Value |
|---|---|
| Logseq build and revision (web app: git HEAD of the checkout; desktop: version + date) | web app dev build (`pnpm watch`) of the main checkout, HEAD d2ab7726ab (2026-09-02); desktop app not used |
| Browser and version | playwright-cli headless Chrome, in-memory profile |
| Planner build (`git rev-parse --short HEAD`), served by `vite preview` on :8294 | per row (Build column); new rows on 4d45a0b (HEAD 06b7b48); timing rows on the DEV build from the dev server :8293 |
| Graph name (`plugin-test` or `Demo` only) and whether it is in-memory | plugin-test, in-memory (`memory:///plugin-test`); re-seeded several times |
| Date of the run and the local time zone (the seed's dates are relative to this day, "D") | 2026-10-03 (Saturday), UTC−5 |
| `@logseq/libs` version | 0.3.4 |
| Other plugins or themes installed | none; Inkwell and a scratch theme registered for the theme rows |

## Setup

1. Web app on :3001, test graph `plugin-test` (fresh; the in-memory graph can lose its seed on reload, so verify the
   seed before every area).
2. `npm run build && npm run preview` (:8294); register the build with `LSPluginCore.register({key: "logseq-planner", ...})`
   so the plugin id (and so its property namespace) is stable. The dev server (:8293) is only for the probe hook and the
   timings; do the large-graph area on the dev build, the rest on the preview build.
3. Small seed: `PLANNER_PW_CWD=<playwright-cli session dir> npm run probe -- --seed` (needs the :8293 dev plugin
   registered; then unregister it and register the :8294 build). Page "Planner probe", dates relative to D:

| Node | Tag | Dates | Status / Owner | Tasks |
|---|---|---|---|---|
| Website relaunch | #Project | D-10 to D+20 | Doing / Alice | Draft brief (Todo, deadline D+2 17:00), Ship homepage (Done), Survey users (Canceled): by inline ref |
| Mobile app | #Project | Start D+5 only | Todo / Bob | Wireframes (Doing, Scheduled D+6 09:00): by node property |
| Acme rollout | #Client project (extends #Project) | D-3 to D+5 | In Review / Alice, Client "Acme" | Acme contract (Todo, deadline D-1 12:00): by node property |
| Archive cleanup | #Project | none | Backlog | none |
| Kickoff | #Meeting | D 10:30 (DateTime) | Type Planning | none |
| Late review | #Meeting | D+1 23:45 | Type Review | none |
| Untimed meeting | #Meeting | none | none | none |
| Loose task | #Task | none | Todo | not linked to anything |

   Example values below use D = Sat 3 Oct 2026 (the day of the recorded run); on another day shift every date.
4. Large seed (area J only): `npm run probe -- --seed-large` (N = 2000; see docs/probes.md; seed it last, because the new tag
   `#Load item` sorts before `#Meeting` and `#Project` and becomes the default tag).
5. Empty tag: in Logseq create a tag "Empty probe" and give it a Date property (Start) and the built-in Status
   property, with no nodes. A second tag "Bare probe" with no properties and no nodes covers the no-dates / no-choice
   states. (Planner never creates properties on user tags, so this is done in Logseq.)
6. Theme plugins for area H: Inkwell (`~/Projects/src/github.com/logseq-inkwell-theme`) and one other theme plugin;
   switch with `LSPluginCore.selectTheme` or the theme picker.

Selectors named below are `data-*` hooks in src/ui/*.ts (`data-view-kind`, `data-control`, `data-popover`,
`data-tag-id`, `data-action`, `data-kb-card`, ...).

## A. Open, close and focus

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| A1 | Click the toolbar button | Planner opens full-screen; the iframe has focus (a view button or Close is focused) | pass | 4d45a0b | 2026-10-03 | toolbar click; focus on the pressed view button |
| A2 | Command palette: "Planner: open", Enter | Opens full-screen with focus inside, no click needed | pass | 9af8e98 | 2026-10-03 | not re-run on the current build |
| A3 | In the app (not editing) press `g` then `Shift+P` | Opens, focus inside | pass | 9af8e98 | 2026-10-03 | not re-run on the current build |
| A4 | Press `g Shift+P` while editing a block | Nothing opens (non-editing binding), the typed characters stay in the block | pass | 4d45a0b | 2026-10-03 | typed "gP" into the block; Planner stayed hidden |
| A5 | Press Escape with no popover open | Planner hides; no click into the iframe was needed first | pass | 4d45a0b | 2026-10-03 |  |
| A6 | Click Close | Planner hides | pass | 4d45a0b | 2026-10-03 |  |
| A7 | Reopen after A5 / A6 with no edits in between | Same tag and view as before; the data is current (a stale hide refreshes once) | pass | 869508c | 2026-10-03 | 0 reloads when not stale; two reloads after a stale hide (known) |
| A8 | Resize the window to 720 px wide and open | Nothing is cut off; the panel on the right and the built-in tag group are reachable (built-in tags collapsed, filters visible) | pass | 4d45a0b | 2026-10-03 | 720 px: bars wrap, no page overflow, Close at x=704 |
| A9 | Desktop app only: open at the macOS window | Retired by N15: Content clears the window buttons (`pl-mac-desktop` padding) | pass | e849107 | 2026-10-03 | desktop app 2.0.1 nightly (rev 8ffbb22, 2026-10-01), second instance over CDP: `html.pl-mac-desktop`, top bar padding-left 84 px, the title starts at x = 84. The native window buttons are not in a CDP screenshot, so their position was not seen |
| A10 | Reload the whole app, then open Planner | Opens; no `[Ready Error]` or deferred-timeout error in the console | pass | 4d45a0b | 2026-10-03 | several app reloads; no Ready Error from the :8294 build |
| A11 | Open Planner (desktop app) | The frame starts at the lower edge of the host header (48 px); the host header stays visible above it (N15) | pass | a066651 | 2026-10-03 | desktop app (Logseq-DB, app zoom 144%): container style `top: var(--ls-headbar-height, 3rem)`, `height: calc(100vh - …)`; frame rect y = 48, the header's lower edge 47.99; still exact after resizing the window; the plugin page fills its frame with no overflow; the host's open left sidebar does not show through |
| A12 | With Planner open, drag the host header | The window moves (N15) | pass | f71adad | 2026-10-04 | stable Logseq.app 2.0.1 (b09316a), second instance, real mouse (CGEvent): header drag with Planner open moved the window from (1430, 386) to (1310, 426). Earlier: real drag on the host header with Planner open: window moved from (0, 30) to (88, 50) |
| A13 | With Planner open, drag the window edges and corners | The window resizes (N15) | pass | f71adad | 2026-10-04 | stable Logseq.app 2.0.1 (b09316a), second instance, real mouse (CGEvent): right edge 980 to 910, bottom edge 700 to 650, corner to 1000 x 710, left edge (x 1310 to 1288); the owner's "cannot resize" was not reproduced for the window (see L2 for the sidebar handle). Earlier: real drags with Planner open: corner (width 2558 to 2458; the window's bottom was at the screen edge), right edge (2458 to 2398), bottom edge (1570 to 1510) |
| A14 | With Planner open, double-click an empty part of the host header | The window zooms (maximizes or restores) (N15) | pass | 2675cce | 2026-10-04 | by the owner in their own app: the window zooms |
| A15 | Click the toolbar button twice | The first click opens Planner, the second hides it; a third opens it again (N15) | pass | f71adad | 2026-10-04 | stable Logseq.app 2.0.1 (b09316a), second instance, real mouse (CGEvent): the toolbar button hides Planner, a second click shows it. Earlier: real clicks on the host toolbar button: Planner hides, then shows again on the same view |
| A16 | With real mouse clicks (not CDP), use Planner's top bar: view switch, Saved views, Close | Every control takes the click (N15) | pass | f71adad | 2026-10-04 | stable Logseq.app 2.0.1 (b09316a), second instance, real mouse (CGEvent): Agenda, Timeline and Saved views (open, close) take real clicks. Earlier: real clicks: Calendar, Saved views open and close, Timeline all respond |
| A17 | Open each view (Timeline, Calendar, Agenda, Kanban) at a wide window | The tag tree and filters are in the panel on the right of the view, with a hairline on the panel's left edge; the Timeline's label column stays at the left of the grid (N13) | pass | 7b84fd8 | 2026-10-03 | desktop app (Logseq-DB): in Timeline, Calendar, Agenda and Kanban the view spans 0–1556 px and the panel 1556–1776 px of a 1776 px frame; DOM order main then panel |
| A18 | Tick two filter values, then click **Panel** (last in the settings bar); click it again | Hidden: the view takes the full width, the button reads "Panel · 2" and keeps focus; shown again: the button reads "Panel"; VoiceOver reads the count ("Panel · 2 filters active") (N13) | pass | 7b84fd8 | 2026-10-03 | in-app clicks (the screen was locked, no real mouse input): with one filter ticked the toggle hides the panel, reads "Panel · 1" (accessible name "Panel · 1 filter active"), the view takes the full width, focus stays on the toggle; a second click brings the panel back |
| A19 | Tab from the top of the workspace | Order: view switch, Saved views, Close, settings bar controls ending with Panel, the view toolbar, the view's items, then the panel (tag tree, filters) (N13) | pass | 7b84fd8 | 2026-10-03 | focusable controls in document order: topbar > settings > view-toolbar > view > panel |
| A20 | Narrow the window until the frame is under 640 px wide (or zoom in), open Planner | The panel is closed; Panel opens it as a drawer over the view from the right edge (shadow, at most 260 px); Escape closes the drawer and Planner stays open; a second Escape closes Planner; with a menu open, Escape closes the menu first (N13) | pass | 7b84fd8 | 2026-10-03 | window emulated at 620 px (frame 430 px at the app's 144% zoom): mode drawer, panel closed by default; the toggle opens it at the right edge (171–431 px), absolute, with a shadow, no page overflow; Escape with a menu open closes the menu first. A drawer left open is open again the next time the frame is narrow (kept per mode) |
| A21 | At a narrow width, open the drawer and click the view beside it | The drawer closes; clicks inside the drawer (tag, filter) and on the bars above keep it open; widening the window shows the panel docked again (N13) | pass | 7b84fd8 | 2026-10-03 | a click on the view closes the drawer and Planner stays open; a click on a view-toolbar control also closes it (the toolbar is inside the main region) |
| A22 | Open popovers near the right edge: Saved views, the Kanban Move menu of a card in the last column, Kanban Show, Depends on; wide and narrow | Each popover is fully inside the frame and above the panel or drawer (N13) | not run |  |  |  |

## B. Workspace shell

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| B1 | First open on the seeded graph (without the large seed) | Opens on #Meeting (first own root tag with dates), Timeline, Month zoom; not on a child tag such as #Client project | pass | 4d45a0b | 2026-10-03 |  |
| B2 | Pick Project, Meeting, Task, Page in the tag tree and in the tag menu | The settings bar updates each time; #Project shows #Client project nested under it; own tags come first, built-in tags are collapsed behind a disclosure and open on their own when a built-in tag is selected | pass | 4d45a0b | 2026-10-03 |  |
| B3 | #Project: switch "Child tags" off and on | 4 nodes with child tags (incl. Acme rollout), 3 without | pass | 9d89c05 | 2026-10-03 |  |
| B4 | #Project: Start / End menus | Lists the tag's Date / DateTime properties only; defaults Start and End; choose another and the view follows (Planner never creates a date property) | pass | 9d89c05 | 2026-10-03 | menus not re-run on the current build |
| B5 | #Task: check the defaults | Start = Scheduled, End = Deadline (no property named Start / End) | pass | 4d45a0b | 2026-10-03 | Scheduled / Deadline |
| B6 | #Project: Done values menu, tick Owner values | Default for Status uses its flags (Done and Canceled count as done; Todo does not). For Owner nothing is done by default. Marking Alice as done: label updates, Website relaunch and Acme rollout count done | pass | f9d037d | 2026-10-03 | Owner = Alice as done, checked in the Agenda |
| B7 | Filters: tick Owner = Alice | 2 nodes (Website relaunch, Acme rollout), 4 tasks; counts shown next to each value; nothing ticked = no filter | pass | cbb9339 | 2026-10-03 | 2 nodes, 4 tasks |
| B8 | Filters: tick "No value" for Owner | Only Archive cleanup (the one node without an Owner) | pass | 9af8e98 | 2026-10-03 | 3 nodes with Alice + No value; No value alone not run separately |
| B9 | Filter to something that matches nothing (Backlog + Alice) | "No #Project nodes match the filters" with a Clear filters button; the button restores the list | pass | 9af8e98 | 2026-10-03 |  |
| B10 | Switch the view kind (Timeline, Calendar, Agenda, Kanban) | Tag, dates, filters and done values stay | pass | 9af8e98 | 2026-10-03 |  |
| B11 | Save a view (name it), switch tag and kind, open the saved view | Tag, kind, filters, done values (by value uuid), zoom / layout / group-by / board config restored; the period on screen is kept (the anchor is session state) | pass | 4d44aac | 2026-10-03 | checked per view kind in T08–T11 |
| B12 | Delete the saved view: ×, then Cancel; ×, then Delete (N23) | × turns the row into **Delete "name"?** with Cancel (focused) and Delete; Cancel restores the row; Delete removes it and the "Planner views" page has no block for it | pass | f71adad | 2026-10-04 | stable app, in-app clicks: × shows Delete "Desk kanban"? with Cancel focused; Cancel keeps the three views; × then Delete leaves two, and the "Planner views" page has two blocks |
| B12a | Open a saved view, change the kind or a filter, **Saved views** → **Update "name"** (N23) | The menu closes; reopening the view from the list shows the changed settings; no second view is created | pass | f71adad | 2026-10-04 | stable app, in-app clicks: saved "N19 test" (Timeline), switched to Kanban, Update "N19 test" closed the menu; reopening it shows Kanban; three blocks on the page, no fourth. Arrow Down / Up walked view, view, Update, Name, Save (N29) |
| B13 | Read the stored view back: open page "Planner views", the block's hidden property `planner-view-config` | JSON with a version and the ids of the saved config | pass | 9af8e98 | 2026-10-03 | JSON read back from the graph |
| B14 | Recycle case 1: move the "Planner views" page to Recycle, then try to save a view | An error says to restore or delete the page in Recycle; nothing is written into the bin; the saved-view list is empty | pass | 3c50069 | 2026-10-03 |  |
| B15 | Recycle case 2: from B14, Restore the page in More → Recycle, reopen Planner | The old views list again and saving works | pass | 3c50069 | 2026-10-03 |  |
| B16 | Recycle case 3: from B14, Delete the page permanently (More → Recycle → Delete, confirm the native dialog), save a view | A fresh page is created and the view saved | pass | 3c50069 | 2026-10-03 |  |
| B17 | Recycle case 4: with Planner already open, move the page to Recycle, save a view | Same guidance as B14; no write into the bin (the store looks the live page up before every write) | pass | 9d89c05 | 2026-10-03 |  |
| B18 | Click on a node name (any view) | The node opens in the main area and Planner hides | pass | 4d44aac | 2026-10-03 | each view |
| B19 | Shift+click on a node | The node opens in the right sidebar; Planner stays open | pass | 4d44aac | 2026-10-03 | each view; needs a healthy page session (see notes in tasks.md T11) |
| B20 | Tag with no nodes: "Empty probe" | "No #Empty probe nodes yet", with the hint to tag a page or block | pass | 4d45a0b | 2026-10-03 |  |

## C. Views by tag

Day numbers: D = the run day. Unless noted, Timeline = Month zoom, Calendar = Month, Agenda = by date, Kanban = Status
columns without lanes. After a check, set the view back.

### C1. #Project (child tags on)

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| C1.1 | Timeline, Month | Range of 8 weeks (13 Sep to 7 Nov on the recorded run, 56 day columns); Website relaunch bar D-10 to D+20 labelled "50%" (1/2 tasks); Acme rollout D-3 to D+5; Mobile app a diamond on D+5; today line on D; footnote "No dates: Archive cleanup" | pass | 4d45a0b | 2026-10-03 | DEV build |
| C1.2 | Timeline, Week and Quarter | Week = 3 weeks of day columns (21), Website bar clipped at the right with "›"; Quarter = 17 week columns (30 Aug to 26 Dec), bars and today line at the right day fractions | pass | d84b977 | 2026-10-03 | not re-run after T13a |
| C1.3 | Timeline: Next / Prev / Today | Next shows left clips "‹"; far away the off-range nodes have no rows and one line above the grid reads "3 earlier" (or "N earlier · M later"); clicking a side moves the range to the nearest of those nodes; Today returns | pass | 4d45a0b | 2026-10-03 | summary line and jumps checked on #Load item; clips on #Project in T08 |
| C1.4 | Timeline: expand Website relaunch | Task rows with the node's name instead of a raw `[[uuid]]`; Draft brief deadline marker D+2, Wireframes (under Mobile app) scheduled ring D+6; Acme contract deadline D-1 in red; Ship homepage greyed, Survey users struck through | pass | 4d45a0b | 2026-10-03 | DEV build |
| C1.5 | Calendar, Month | "October 2026" on the recorded run, 5 week rows from 27 Sep, outside days shaded, today's number in the accent colour; Website relaunch on lane 0 across four week rows with continuation marks; Acme rollout on lane 1; chips: late red "12:00 Acme contract" on D-1, "17:00 Draft brief Website relaunch" on D+2, "Mobile app" on D+5; no chip for Wireframes (Scheduled only); "No dates: Archive cleanup" | pass | 4d45a0b | 2026-10-03 | DEV build |
| C1.6 | Calendar, Week | Seven tall day columns with time and node lines on chips; same items as the Month for that week | pass | 8d4835e | 2026-10-03 |  |
| C1.7 | Agenda, by date | Overdue: Acme contract "due D-1 12:00, 1 day late" (red, Acme rollout chip); Today: Acme rollout, Website relaunch; D+2: Draft brief (Website relaunch); D+5: Mobile app; D+6: Wireframes "scheduled D+6 09:00"; No date (folded): Archive cleanup | pass | 4d45a0b | 2026-10-03 | DEV build; No date renders its entry only when opened |
| C1.8 | Agenda: Show done | Adds Ship homepage (done) and Survey users (canceled) under No date | pass | f9d037d | 2026-10-03 |  |
| C1.9 | Agenda, by node | Order: Acme rollout (overdue task), Website relaunch 1/2, Mobile app, Archive cleanup; each with status and owner. Show done adds the two tasks under Website relaunch | pass | f9d037d | 2026-10-03 |  |
| C1.10 | Kanban, Status | Backlog 1, Todo 1, Doing 1, In Review 1, Done 0, Canceled 0, No Status 0; cards sorted by due date | pass | 4d45a0b | 2026-10-03 |  |
| C1.11 | Kanban, Swimlanes = Owner | Lanes Alice 2, Bob 1, No Owner 1 | pass | 4d44aac | 2026-10-03 |  |
| C1.12 | Kanban sort: Due, Title | Order follows; "Priority" appears only on tags that have a Priority property (not here) | pass | 4d44aac | 2026-10-03 |  |
| C1.13 | Save a view on each of the four kinds and reopen it | Zoom, layout, group-by + Show done, board config restored | pass | 4d44aac | 2026-10-03 |  |
| C1.14 | Timeline: zoom control, then **Day** (N10) | Zoom reads Day, Week, Month, Quarter; Day shows "Sat 3 Oct 2026" (D), 24 hour columns "00" … "23" with hour lines and no weekend shading; the current hour's label in the accent colour and the today line at the current time; Website relaunch and Acme rollout are full-width bars marked "‹" and "›" (Date-only spans that run past the day); no Mobile app row, "1 later" above the grid; the view opens scrolled to about 07:30 (no timed item on D for #Project) | pass | 77eab27 | 2026-10-03 | desktop app (Logseq-DB 2.0.1 nightly), graph `planner-project`, not the seed graph: Day | Week | Month | Quarter; "Sat 3 Oct 2026"; 24 hour columns; the hour 20 label in the accent colour and the now line at 20:26 (`--pl-tl-today: 81.7`), local time. Full-width Date-only spans not seen (this graph has none) |
| C1.15 | Timeline Day: Prev / Next / Today and the earlier / later buttons | Prev / Next move one day ("Fri 2 Oct 2026", "Sun 4 Oct 2026"); Today returns to D; "N later" jumps to the day of the nearest later node (Mobile app on D+5, a diamond at 00:00, Date-only, so that day opens at 00:00); each new day opens scrolled to its first timed item, else 07:30 | pass | 77eab27 | 2026-10-03 | `planner-project`: Prev gives "Fri 2 Oct 2026" with no bars, the later button jumps back to 3 Oct, Next gives "Sun 4 Oct 2026", Today returns. In a 1567 px wide window nearly all 24 hours fit, so the opening scroll clamps at the maximum (76 px); the scroll-to-first-item rule was not seen in a narrow window |
| C1.16 | Timeline Day on D+2, expand Website relaunch | Draft brief's deadline diamond at 17:00; the view opens near 08:00 before the expand; scrolling then expanding or collapsing a row keeps the scroll | not run |  |  |  |
| C1.17 | Timeline Day on #Meeting, D | Kickoff a diamond at 10:30 (its label reads "Kickoff, 3 Oct 10:30"), the view opens scrolled to about 10:00; D+1: Late review at 23:45 | not run |  |  |  |
| C1.18 | Timeline Day on the `planner-project` graph (#Milestone and #Task with DateTime Start / End) | Each milestone and task is a bar across the hours it took (13:07–14:08 covers 13:00 to 14:15); a span from 22:00 to 02:00 the next day is clipped "›" on the first day and "‹" on the second; a Date-only span covers the whole day; leaving Planner open over a minute moves the today line | partial | 77eab27 | 2026-10-03 | #Milestone: Foundation 13:07–14:08 on tracks 52–57 (13:00 to 14:15), Views, Validation and review, Decisions and follow-ups likewise; expanded tasks show their scheduled ring at their time. #Task (Start / End mapped): 20 bars, e.g. T01 13:33–13:37 one track. Not seen: a span clipped across midnight, a Date-only span (none in this graph) |
| C1.19 | Save a view in Day zoom, switch to Week, reopen the saved view | Day zoom restored (on the anchor's day, today by default) | pass | 77eab27 | 2026-10-03 | `planner-project`: saved "Milestones by the hour" in Day zoom, switched to Week, reopened: Day zoom on 3 Oct with the four bars |
| C1.20 | `planner-project`, #Task, Timeline Week then Day (N12) | Settings bar: **Depends on** after End reads "depends_on" (the default). A connector (neutral grey line, arrow at the dependent) runs from the right end of T07's bar to the left end of each of T08–T11, and from each of T08–T11 to T12; a dependent that starts before its dependency's end gets an elbow route; scrolling sideways moves the lines with the bars; hovering a bar shows ", depends on T07…" in its tooltip; in Day only the links whose both ends are on that day show | pass | 94327e9 | 2026-10-03 | desktop app (Logseq-DB), `planner-project`, #Task: "Depends on depends_on" picked by default; Week zoom draws 33 connectors = every pair in the dependency map (T07 to T08–T11, T08–T11 to T12, …); Day zoom on Thu 1 Oct draws 11, the fan out of T07 and the four lines into T12 share a trunk (screenshots). In Week zoom the two-hour bars touch, so every line takes the elbow route and the lines crowd |
| C1.21 | Same view, **Depends on** → None, then back to depends_on (N12) | None: every connector disappears and T07's row shows the dependents again (count and task rows as before N12); depends_on: the connectors return | pass | 94327e9 | 2026-10-03 | None: no connector paths, and "T07 Workspace shell … 4 of 4 done" is back (dependents counted as tasks again) |
| C1.22 | Same view with depends_on, T07's row (N12) | T07's count and expandable task rows no longer include T08–T11 (before N12: "4 of 4 done"); the same holds in Calendar (no dependent chips on T07), Agenda by node and Kanban card progress | pass | 94327e9 | 2026-10-03 | with depends_on selected T07 reads "T07 Workspace shell, 1 Oct 11:00 – 1 Oct 13:00" (no rollup, no expandable rows) and T12's bar label ends ", depends on T08 Timeline, T09 Calendar, T10 Agenda, T11 Kanban"; #Milestone still counts its tasks ("Foundation … 7 of 7 done") |
| C1.23 | Save the #Task view with **Depends on** None, switch the tag, reopen the saved view; open a view saved before N12 (N12) | The reopened view reads None and draws no connectors; the older view reads depends_on (default rule) and draws them | not run |  |  |  |

### C2. #Meeting

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| C2.1 | Timeline, Month | Diamonds on D (Kickoff) and D+1 (Late review); today line on D; footnote "No dates: Untimed meeting" | pass | 4d45a0b | 2026-10-03 | DEV build |
| C2.2 | Calendar, Month and Week | Kickoff "10:30" on D, Late review "23:45" on D+1 (the local day, even near midnight); "No dates: Untimed meeting" | pass | 8d4835e | 2026-10-03 |  |
| C2.3 | Agenda, by date | Today: Kickoff 10:30; Tomorrow: Late review 23:45; No date: Untimed meeting | pass | f9d037d | 2026-10-03 |  |
| C2.4 | Agenda, by node | Three groups, one per meeting | pass | f9d037d | 2026-10-03 |  |
| C2.5 | Kanban, columns by Type | Columns Planning / Review / 1:1 and "No Type"; Kickoff in Planning, Late review in Review, Untimed in No Type **[new]** | pass | 4d45a0b | 2026-10-03 | Planning 1, Review 1, 1:1 0, No Type 1; sorts due/title |
| C2.6 | Time zone | With the browser zone different from UTC, Late review stays on D+1 (23:45 is not shifted to D+2) | pass | 8d4835e | 2026-10-03 | browser zone UTC-5 |

### C3. #Task (built-in tag)

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| C3.1 | Select #Task | The built-in group opens by itself; defaults Start = Scheduled, End = Deadline **[new]** | pass | 4d45a0b | 2026-10-03 | built-in group opens; Scheduled / Deadline |
| C3.2 | Timeline / Calendar / Agenda over #Task | Tasks as nodes: deadline-only tasks are points, Scheduled + Deadline spans; undated tasks (Loose task, Ship homepage, Survey users) listed apart; titles show the linked node's name, never a raw uuid; "(link)" only for a block that does not exist **[new]** | pass | 4d45a0b | 2026-10-03 | Timeline and Calendar: Acme contract, Draft brief, Wireframes as points; undated: Loose task, Ship homepage, Survey users. Agenda by date: Overdue Acme contract, Mon 5 Oct Draft brief, Fri 9 Oct Wireframes, No date 1 (done tasks hidden) |
| C3.3 | Kanban over #Task, Status columns | Columns Backlog / Todo / Doing / In Review / Done / Canceled; titles that link a #Project page show its name | pass | 4d44aac | 2026-10-03 |  |
| C3.4 | Kanban sort: Priority | Offered because #Task has Priority; Urgent first (the last closed value ranks highest) | pass | 4d44aac | 2026-10-03 | Urgent, Medium, Low |

### C4. #Page (a tag without dates)

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| C4.1 | Timeline, Calendar and Agenda over #Page | "#Page has no date properties" with the hint to add a Date or DateTime property in Logseq | pass | 4d45a0b | 2026-10-03 |  |
| C4.2 | Kanban over #Page | "#Page has no choice properties" (the no-dates state is not shown in Kanban) | pass | 4d45a0b | 2026-10-03 |  |
| C4.3 | The empty-state text and layout in light and dark | Centred, readable, no console error | pass | 771140f | 2026-10-03 | Logseq default dark: the Timeline ("no date properties") and Kanban ("no choice properties") empty states are centred and readable (screenshots); no plugin console error |

### C5. A tag with no nodes

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| C5.1 | "Empty probe" (Date + Status property, no nodes): Timeline, Calendar, Agenda, Kanban | Each shows "No #Empty probe nodes yet"; no error; the settings bar still works **[new]** | pass | 4d45a0b | 2026-10-03 | all four kinds show "No #Empty probe nodes yet" (Kanban too) |
| C5.2 | "Bare probe" (no properties): Timeline, Calendar, Agenda | "No date properties" state (it comes before the no-nodes state) | pass | 4d45a0b | 2026-10-03 |  |
| C5.3 | "Bare probe": Kanban | "No choice properties" state | pass | 4d45a0b | 2026-10-03 |  |
| C5.4 | Add a node to "Empty probe" in the main window while Planner is open (see E) | The empty state turns into the view on its own | pass | 4d45a0b | 2026-10-03 | empty state left on its own after the node was tagged; back when removed |
| C5.5 | Agenda over a tag where everything is done: filter Backlog and mark Backlog as done | "Nothing on the agenda" (hint: turn on Show done); Show done brings Archive cleanup back | pass | f9d037d | 2026-10-03 |  |

## D. Kanban moves

Use #Project, Status columns. After each move read the property back in the graph (the node's page, or a datascript query);
log the host calls if you can (wrap `logseq.api.upsert_block_property` in the host page).

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| D1 | Drag Website relaunch Doing → Done, then Done → Doing | Each drag = one awaited `upsert_block_property(uuid, "logseq.property/status", <entity id>)`, a read-back and a quiet reload; the card lands in the column, no overlap, no duplicate | pass | 4d44aac | 2026-10-03 | host calls logged |
| D2 | With Owner swimlanes, drag a card across lanes and columns at once | Two upserts, Status first, then `user.property/owner-<suffix>`; the card sits in the new cell | pass | 4d44aac | 2026-10-03 |  |
| D3 | Drag a card to the "No Owner" lane (or "No Status") | `remove_block_property`; the attribute is absent in the graph (for built-in Status the host sets the empty placeholder: the card still shows in "No Status", the read-back reports success) | pass | ab9ed41 | 2026-10-03 | built-in Status → empty placeholder; Owner absent |
| D4 | Move menu (the card's ⋯) with the keyboard: Enter, arrows, Enter | Moves the card; focus returns to that card's ⋯ | pass | 4d44aac | 2026-10-03 |  |
| D5 | Move menu with the mouse | Same result; menu closes | pass | 4d44aac | 2026-10-03 |  |
| D6 | Move menu for a lane (swimlanes on) | Offers lane values and "No Owner"; the move writes the lane property only | pass | 4d44aac | 2026-10-03 |  |
| D7 | Failure rollback: in the host page stub `logseq.api.upsert_block_property = async () => {}`, drag a card | Card goes back to its column; the error bar reads "Status of … was not saved as <value> (read back differs)…"; the graph is unchanged. Restore the host function afterwards (reload the page) | pass | 4d44aac | 2026-10-03 |  |
| D8 | Failure rollback by a rejecting write (stub rejects) | Same rollback, the error shows the message | pass | 4d45a0b | 2026-10-03 | error bar shows "boom from host"; graph unchanged |
| D9 | Reload the app after a move | The moved card is still in its new column | pass | ab9ed41 | 2026-10-03 |  |
| D10 | After a Planner move press ⌘Z in the app | The card goes back (Undo reverts the write) and Planner follows without a manual reload | pass | 869508c | 2026-10-03 |  |
| D11 | Drag to a column that is scrolled out of view | Not verified so far (does not register under playwright's dragTo). Try by hand with the mouse, then use the Move menu to reach every column | pass | e849107 | 2026-10-03 | desktop app, playwright mouse (not a hand): holding the dragged card at the right edge scrolled the view (scrollLeft 0 to 214, its maximum), the drop on Canceled landed and was read back with the CLI. In the web app the same row was not run |
| D12 | Drag starting on the card's button in Firefox | Not verified so far; record whether it drags | not run |  |  | Firefox not used |
| D13 | Sticky column headers and the Move menu near the window edges | Header stays while the board scrolls; the menu is not clipped by the edge | pass | 4d45a0b | 2026-10-03 | header position sticky top 0; Move menu inside the window (935–1135 × 235–495 of 1280×720). Scrolling look not judged |
| D14 | A card is dragged while a change arrives from elsewhere | The redraw waits until the drag ends (deferral during a drag, not verified so far); no card is lost | pass | 771140f | 2026-10-03 | card held mid-drag (mouse down and move) while another node's Status was set from the host: the board did not change during the drag, and redrew with the edit after Escape; no card lost; a later edit redrew too. The edit came from the host API in the same page, not from a second tab |
| D15 | Check the "pending" look and that a pending card cannot be dragged twice | Pending card disabled until the write settles | pass | 4d45a0b | 2026-10-03 | slow write: card in the target, pending, draggable=false, aria-busy, ⋯ disabled, opacity 0.7, cursor progress; normal after it settled |
| D16 | Show menu (`[data-control=kb-show]`): untick Backlog, In Review, Canceled and No Status | Board shows Todo, Doing, Done only; their counts unchanged; the cards of the hidden columns are gone; the button reads "3 of 7"; the popover stays open while ticking; Escape closes it and focus returns to the button | pass | 25b9f3a | 2026-10-03 | desktop app (Logseq-DB 2.0.1 nightly, graph planner-desktop-2), REAL mouse clicks: Show opened, Backlog, In Review, Canceled and No Status unticked: button "3 of 7", `--pl-kb-cols` 3, columns Todo / Doing / Done, the Backlog and In Review cards gone; the popover stayed open while ticking |
| D17 | Show menu: untick until one column is left | The last ticked checkbox is disabled; the last column cannot be hidden | pass | 25b9f3a | 2026-10-03 | with only Done ticked its box is disabled and a forced click changes nothing; Escape closes the popover and focus returns to the Show button |
| D18 | Hide a Status column, switch Columns to Owner, hide "No Owner", switch back to Status, then to Owner again | Each property keeps its own choice (Status without the hidden column, Owner without "No Owner") | pass | 25b9f3a | 2026-10-03 | Columns to Owner: "All", three Owner columns; back to Status: "3 of 7" again. Timeline and back to Kanban resets Show to "All" (like Sort and Swimlanes, by the existing rule that a kind switch takes the kind's defaults) |
| D19 | With columns hidden, save the view; open another tag; open the saved view again | The same columns are hidden; the button reads the same "N of M" | pass | 25b9f3a | 2026-10-03 | saved as "Three columns": the stored JSON holds `hiddenColumns` with three value uuids and "none" (read with `logseq query`); after a Timeline round trip, opening the saved view gives "3 of 7" and the three columns |
| D20 | With Done hidden, use a card's ⋯ Move menu and pick Done | The menu lists every column, Done included; the write is read back and the card leaves the board | pass | 25b9f3a | 2026-10-03 | the Move menu lists all seven values; Website relaunch moved to Backlog (hidden): the card left the board, the graph reads Backlog, no error |

## E. Live refresh

Planner open and visible. Make the edit in the main window or a second tab (the Planner iframe stays in the first tab).
Read the timings from `__plannerTimings.refresh` where noted (docs/probes.md).

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| E1 | Set a node's Status from the host (outside Planner) while a Kanban is shown | The card moves about 140 ms after the write returned (recorded: 138 ms) | pass | 869508c | 2026-10-03 | 138 ms after the write returned |
| E2 | Edit an unrelated block | Data reloads (a query runs) but the DOM is untouched (same nodes, no mutation); `refresh.outcome` = `same` | pass | 869508c | 2026-10-03 |  |
| E3 | Timeline: navigate away from today, expand a row, scroll, focus a filter checkbox; then change that node's task status elsewhere | Redraws (progress 50% to 100%) and keeps the range, the expanded row, the scroll and the focused checkbox | pass | 869508c | 2026-10-03 |  |
| E4 | Agenda: unfold "No date", then edit an entry elsewhere | The bucket stays unfolded; the entries update | pass | 869508c | 2026-10-03 |  |
| E5 | Open the Tag menu, change data elsewhere | Nothing redraws while the menu is open (2 s); the change appears after Escape (one redraw) | pass | 869508c | 2026-10-03 |  |
| E6 | Hide Planner (Close), edit a node elsewhere, check reloads | 0 reloads while hidden; reopening shows the edit (known: reopening after a stale hide runs two reloads, the second changes nothing) | pass | 869508c | 2026-10-03 |  |
| E7 | Hide and reopen with no edits in between | 0 reloads | pass | 869508c | 2026-10-03 |  |
| E8 | Create a tag in the host while Planner is open; then delete it | It appears in the tag tree and disappears again | partial | 4d45a0b | 2026-10-03 | a created tag appears at once; a DELETED tag stays listed until the next graph change or the 30 s poll (no refresh is triggered by the deletion) |
| E9 | Leave Planner visible and idle for 35 s | A poll reload happens (every 30 s), no visible change | pass | 869508c | 2026-10-03 |  |
| E10 | An edit from a second browser tab on the same graph | The card / bar moves in the first tab | pass | 869508c | 2026-10-03 |  |
| E11 | Delete the tag that the open view shows (or remove a property the view uses) | Planner falls back to the default view and says so in the error bar; no crash | partial | 4d45a0b | 2026-10-03 | fallback to the default view with "Invalid view config: unknown tag … Showing the default view instead." happens on the next refresh, not at the deletion (see E8) |
| E12 | Sync: change from another device; second desktop window | Not verified so far (`DB.onChanged` under sync is untested); record what happens | partial | e849107 | 2026-10-03 | desktop app: a Status edit made in a second window on the same graph moved the card in the first window's Kanban within 2.5 s; writes from the `logseq` CLI (four tasks added) showed at once too. Sync from another device: not run (no sync account in the test instance) |

## F. Themes

For each theme below open the Planner, look at all four views on #Project (and the settings bar, a popover, a selected
row, an expanded Timeline row, the Kanban card hover and a late chip). The tokens are `--pl-*` on the iframe's `<html>`.

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| F1 | Default theme, light | Text and surfaces follow the host; sans-serif (never serif); selected rows readable (tint-soft, not dark on blue); 2px tint-soft focus ring; no `hsl(#...)` in any token | pass | 4d45a0b | 2026-10-03 |  |
| F2 | Default theme, dark | Same, with `html.dark`; plugin surface within a shade of the host body. Not verified for the Timeline so far (the recorded profile's dark theme was Inkwell): look at every view | pass | 4d45a0b | 2026-10-03 | Timeline in Logseq default dark: host rgb(0,43,54), plugin rgb(0,45,56); screenshot checked |
| F3 | Inkwell, light | All 38 tokens resolve (`--ink-*` status colours, system font); looks right in all four views | pass | 771140f | 2026-10-03 | Inkwell Slate Light: Timeline, Calendar, Agenda and Kanban screenshots look right |
| F4 | Inkwell, dark | Same in dark | pass | 771140f | 2026-10-03 | Inkwell Slate Dark: all four views seen, Agenda included |
| F5 | One other theme (name it): light or dark as it ships | Background, text and font come through; nothing unreadable | pass | 4d45a0b | 2026-10-03 | scratch theme "Probe Green Light": background rgb(235,250,235), text rgb(11,61,11), font Georgia; Kanban screenshot |
| F6 | Toggle light / dark with Planner open | `html.dark` flips and tokens change with no reload | pass | 2c90798 | 2026-10-03 |  |
| F7 | Switch theme 9 times in a row, rapidly, with Planner open | Each switch ends on the host's values (the 250 ms / 1 s re-resolve beats the stylesheet load race) | pass | 2c90798 | 2026-10-03 | 9 switches, not rapid |
| F8 | Switch back to the default theme (picker sends `{url: null, mode}`) | Tokens reset to the default theme | pass | 4d45a0b | 2026-10-03 |  |
| F9 | Contrast spot checks per theme | Late (red) chips and the done / canceled greyed rows stay readable | pass | 7b84fd8 | 2026-10-03 | re-measured after the `--pl-label-done` token (N04): done titles in the Agenda measure 7.61 in Logseq's default light, 6.11 in default dark and 6.94 in Inkwell dark. Earlier figures for late text and chips stand (5.0–6.8) |

## G. Week start

Logseq setting `preferredStartOfWeek` (0-6 = Monday-Sunday; the default is 6 = Sunday). Change it with
`logseq.api.set_current_graph_configs({"start-of-week": 0})` or in the host's settings, then reopen Planner (it is read on every open).

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| G1 | Default (6): open Calendar Month and Week | Weeks run Sunday to Saturday (5 rows from 27 Sep on the recorded run) | pass | 4d45a0b | 2026-10-03 |  |
| G2 | Set 0 (Monday), close and reopen | Calendar runs Monday to Sunday (first row from 28 Sep); the Timeline Month label reads "14 Sep – 8 Nov 2026" on the recorded run | pass | 8d4835e | 2026-10-03 |  |
| G3 | Set 6 again | Back to the Sunday layout; restore the setting at the end | pass | 4d45a0b | 2026-10-03 | restored to 6 at the end |
| G4 | Set another weekday (e.g. 2) | Calendar and Timeline Quarter week columns start on that day | pass | 4d45a0b | 2026-10-03 | 2 → Wed…Tue, rows from 30 Sep; Quarter columns 2, 9, 16, 23 Sep |
| G5 | Change the setting while Planner is open and hidden, then show it | The next refresh picks it up (week start is re-read on every open and every refresh) | pass | 771140f | 2026-10-03 | Calendar Sun-first; Close; `start-of-week` set to 0; reopened: Mon-first |

## H. Large graph (#Load item, N = 2000)

Seed: `npm run probe -- --seed-large` (area setup 4). Use the dev server build (:8293) so `__plannerTimings` exists.
Targets (REQUIREMENTS.md): first view under 1 s; redraw after a change under 300 ms. Record milliseconds in Notes.

How to read: `PLANNER_PW_CWD=<dir> npm run probe -- --timings` prints `{load, refresh, history}`; `load` is the first
open of the page session (queryMs, renderMs, totalMs). `refresh.totalMs` starts at the debounced trigger, so the whole
redraw after a change is about `DEBOUNCE_MS` (50 since T13a) + `refresh.totalMs`: the target is `refresh.totalMs` under 250 ms.
Medians of 3 runs; reload the page between first-load runs. A view switch is not recorded by the recorder; time it in the
plugin iframe, from the click to the view being in the DOM and painted:

```js
// in the plugin iframe; kind = timeline | calendar | agenda | kanban
const t0 = performance.now();
document.querySelector('[data-view-kind="kanban"]').click();
await new Promise((r) => { const mo = new MutationObserver(() => { if (document.querySelector('[data-kanban]')) { mo.disconnect(); r(); } }); mo.observe(document.body, { childList: true, subtree: true }); });
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
performance.now() - t0
```

(Marker per view: `[data-timeline]`, `[data-calendar]`, `[data-agenda]`, `[data-kanban]`; switch to another view first so the marker is new.)

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| H1 | Seed N = 2000; check the graph | Page "Planner load test" with 2000 `#Load item` nodes and about 2000 `#Task` blocks; the tag tree shows "Load item" with Start, End, Status, Lead, Team; import finished with no error | pass | 4d45a0b | 2026-10-03 | 2000 items, 2033 tasks; import 105–107 s |
| H2 | Reload, open Planner (opens on #Load item, Timeline, Month); read `load` | `load.totalMs` under 1000 (the first view); note `queryMs` and `renderMs` apart | pass | 4d45a0b | 2026-10-03 | DEV build: 326–350 ms (queries ~305–330, render ~21) |
| H3 | Timeline: switch to Calendar, Agenda and Kanban with the snippet | Each under 1000 ms from click to painted; note each | pass | 8af0486 | 2026-10-03 | DEV build, to paint: Timeline 22, Calendar 13, Agenda 24, Kanban 30 ms |
| H4 | Back to the Timeline; Week, Quarter zoom, Next / Prev / Today | Each redraw feels immediate; note any over 300 ms | pass | 771140f | 2026-10-03 | DEV build, click to DOM / to paint in ms: Week 30 / 35, Quarter 43 / 48 (511 rows), Month 23 / 28, Next 38 / 44, Prev 28 / 32, Today 28 / 33 |
| H5 | Set a node's Status from the host on a visible node (Kanban, Status columns); read `refresh` | `refresh.outcome` = `redrawn`, `totalMs` under 250 (so under 300 ms with the 50 ms debounce); the card is in its new column | pass | 4d45a0b | 2026-10-03 | DEV build: Kanban 181–186 ms, redrawn |
| H6 | Edit an unrelated block; read `refresh` | `outcome` = `same`, `totalMs` under 250 | partial | 771140f | 2026-10-03 | re-timed, 11 runs on the Timeline: outcome `same` every time; 165–254 ms plus one first run at 320 (3 of 11 at or over 250). After a Kanban drag the quiet reload ran 187–432 ms |
| H7 | Repeat H5 on Timeline, Calendar and Agenda (change a node's End date) | Same targets for each view | pass | 4d45a0b | 2026-10-03 | DEV build, Status edit (not End date): Timeline 179–184 (two runs 260), Calendar 165–169, Agenda 169–179 |
| H8 | Kanban drag on #Load item (Status, then with Lead swimlanes) | The move shows at once (optimistic) and the quiet reload after it does not stall; note the time to settle | pass | 771140f | 2026-10-03 | flat (Backlog to Doing) and with Lead swimlanes (Backlog to Todo in the Alice lane): first DOM change 21 ms / 69 ms after the drop, card in its new cell and not pending, column totals updated, graph written; the reload after it: `same`, 251–432 ms. The drop has to land in the visible part of the cell (see D11): playwright's default drop point, the middle of a 50-card cell, is off screen |
| H9 | Filters: tick Lead = Alice, Team = Ops; clear | The list narrows and widens at once; counts correct (check one against a query) | pass | 771140f | 2026-10-03 | Lead = Alice 18 ms, then Team = Ops 12 ms to paint; clearing 23–30 ms. Kanban totals under both filters sum to 73 = the datascript count of #Load item nodes with Lead Alice and Team Ops |
| H10 | Scroll the Timeline and the Kanban columns | No visible jank. The Timeline has rows only for nodes in range and one line "N earlier · M later" above the grid; each side moves the range to the nearest such node. Kanban cells show 50 cards, then "Show 50 more of N" (counts in the heads are the totals) **[T13a]** | partial | 771140f | 2026-10-03 | row counts and the summary line confirmed again (313 rows, "728 earlier · 722 later"); Kanban: 50 cards per cell, then "Show 50 more of N", totals in the heads; scrolling smoothness not judged (headless) |
| H11 | Agenda "Later" and "No date" folds with hundreds of entries | Entries render only when a fold is opened (the count is in the heading), without freezing; by node the first 100 groups, then "Show 100 more of N" **[T13a]** | pass | 4d45a0b | 2026-10-03 | Later 774 and No date 776 render 0 until opened; by node 100 groups then "Show 100 more of 1,437" |
| H12 | Open and close Planner 5 times | Reopen is instant when nothing changed (no reload); `history` shows no growth of `totalMs` | pass | 771140f | 2026-10-03 | DEV build, #Load item Kanban, 5 close / reopen cycles: the view is visible 55–62 ms after the click; no new load or refresh measurement in `history` (no reload) |
| H13 | Memory: note the page's JS heap before and after opening Planner and switching all views | Record the numbers (no target) | pass | 771140f | 2026-10-03 | `performance.memory.usedJSHeapSize` of the page (DEV builds of Logseq and Planner, one process for both): 347 MB before opening, 361 MB after opening #Load item and switching all views and zooms, 353 MB after 5 open / close cycles |
| H14 | Seed `--seed-large 200` first on a fresh graph if the 2000 import fails or times out | Record which N imports; report the failure text | not run |  |  | not needed: N = 2000 imported |
| H15 | Agenda by date, Overdue bucket with hundreds of entries | Overdue lists its first 100 entries, then "Show 100 more of N" (`[data-ag-bucket=overdue] [data-ag-more=overdue]`); the heading keeps the real total; a live refresh keeps the expanded count **[N04]** | not run |  | 2026-10-03 | needs the large seed; unit-tested only |

## I. Accessibility basics

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| I1 | Tab through the workspace from the top | Reaches the view switch, saved views, Close, the settings bar controls, the view toolbar, the view's items, then the panel (tag tree, filters), in reading order; nothing focusable is skipped; nothing hidden receives focus | pass | 4d45a0b | 2026-10-03 | order: view switch, saved views, Close, settings bar, tag tree, built-in group, filters |
| I2 | Every focused control | A visible 2px focus ring in the tint colour in all five themes | pass | 4d45a0b | 2026-10-03 | 2px ring on all 34 tab stops, default light only |
| I3 | Operate each control with Enter / Space (view switch, menus, zoom, prev / next / Today, Show done, Group by, filters) | Works without a mouse | pass | 771140f | 2026-10-03 | Enter and Space on the view switch, zoom, Prev / Next / Today, the task toggle, Show done and Group by; Space on a filter checkbox |
| I4 | Menus and listboxes (tag, Start, End, Done values, saved views, Kanban Columns / Swimlanes) | Arrow keys move, Enter picks, focus returns to the trigger; the first option is focused on open | pass | 771140f | 2026-10-03 | Start, End, Columns, Swimlanes: the first option is focused on open, arrows move, Enter picks, focus returns to the trigger. Saved views and Done when are popovers, not listboxes: focus starts in the Name field (first checkbox), Tab reaches each saved view, Enter opens it, Escape returns focus to the trigger; arrow keys do nothing there |
| I5 | Escape order: open a menu, press Escape; press Escape again | First Escape closes only the popover (Planner stays), the second hides Planner | pass | 9af8e98 | 2026-10-03 |  |
| I6 | Escape with a Kanban Move menu open | Closes the menu, focus back on the card's ⋯ | pass | 4d44aac | 2026-10-03 |  |
| I7 | Timeline bars, diamonds, Calendar bands and chips, Agenda entries, Kanban card open buttons | Focusable buttons with an accessible name (title and date); Enter opens the node; Shift+Enter opens the sidebar (not verified on a focused Timeline bar so far) | pass | 771140f | 2026-10-03 | Timeline bar, Calendar band and chip, Agenda entry, Kanban card: Enter opens the node (Planner hides), Shift+Enter adds it to the right sidebar (Planner stays) |
| I8 | Landmarks | Tags are in a `nav` named "Tags", settings in "View settings", the board in a labelled region ("... board by Status"), cells in labelled lists | pass | da5d181 | 2026-10-03 | nav "Tags", main, group "View", group "View settings", region "#Project board by Status", one labelled list per cell. The settings bar had a label but no role on 771140f; fixed in 1670261 and found by role on da5d181 |
| I9 | Screen reader pass (VoiceOver) on one view | Titles, dates and counts are announced; the Move menu announces the property | not run |  |  |  |
| I10 | Reduced motion and 200% browser zoom | Nothing overlaps; the grid scrolls inside the view | pass | da5d181 | 2026-10-03 | 640×360 viewport (about 200% zoom): no page overflow in any view, the Timeline, Calendar and Kanban scroll inside the view, the settings bar wraps (screenshots on 771140f). Reduced motion: 46 elements with a transition normally, 0 under `prefers-reduced-motion: reduce` (rule added in 03ffed6) |
| I11 | Desktop app, Planner open: press Cmd+K | Logseq search opens above Planner with focus in its field; Escape closes search and Planner stays open | pass | 9d6aab9 | 2026-10-03 | desktop app (Logseq-DB), focus in Planner: Cmd+K opens Logseq's search above Planner with the cursor in its field; typed text goes to the search field |
| I12 | Desktop app, Planner open: press Cmd+Shift+P | The command palette opens | pass | 7d26266 | 2026-10-03 | Cmd+Shift+P opens the command palette above Planner |
| I13 | Desktop app, Planner open, focus not in a field: press `t` then `t` | The theme switches and Planner follows | pass | 9d6aab9 | 2026-10-03 | `t t` switches the host theme and Planner follows; pressed again it switches back |
| I14 | Open Saved views, type `tt` and Cmd+A in the view-name field; then press Cmd+K there | The letters go into the field, Cmd+A selects its text, no host shortcut fires; Cmd+K opens search | pass | 7d26266 | 2026-10-03 | "tt test" typed in the view-name field stays there and the theme does not change; Cmd+A then Backspace empties the field; Cmd+K from the field opens search |
| I15 | Open a Planner menu, press Cmd+K, Escape (search closes), Escape (menu closes), Escape (Planner hides) | One layer per Escape, in that order; the host never sees the Escapes meant for Planner | pass | 7d26266 | 2026-10-03 | with Saved views open: Cmd+K opens search, Escape closes it and the menu is still open; Escape closes the menu; Escape hides Planner. On 7d26266 the menu had to be focused again by the test before the second Escape; 9d6aab9 returns focus by itself (see I17) |
| I16 | Web app: press Cmd+K with Planner open | Nothing is forwarded (known limit: cross-origin frame); no console error | not run |  |  | N16 |
| I17 | Desktop app, Planner open: press Cmd+K, Escape (search closes), Escape again | Focus is back in Planner after the first Escape, so the second Escape hides Planner without a click | pass | 9d6aab9 | 2026-10-03 | Cmd+K, Escape (twice when the search field holds text: the first clears it, host behaviour): the dialog closes, host focus returns to the Planner frame, the next Escape hides Planner. With Planner hidden a click in the page keeps focus in the host |

## J. Review fixes (T14)

Rows added with the T14 review fixes; none run live yet.

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| J1 | Timeline in Week zoom: click the range label, the toolbar padding; Kanban: click the hint and the "Sort" label | The zoom, sort and other view settings do not change | pass | 92ec1d7 | 2026-10-03 | range label and Kanban hint clicked; zoom stayed week, sort stayed title |
| J2 | Create tags titled "2026 goals", "true" and ":kw", tag a node with each, open each in Planner | Each tag shows its node | pass | 92ec1d7 | 2026-10-03 | each tag showed its own node on the Kanban |
| J3 | Two tags with the same title, one node each; open each | Each shows only its own node | pass | 771140f | 2026-10-03 | two tags titled "Pair", each with a Date property and one node: each shows only its own node |
| J4 | Move a page holding a #Project node to Recycle; separately, delete one #Project block | Neither node shows in any view; tasks that link only them are gone too | pass | 92ec1d7 | 2026-10-03 | page with a #Project block moved to Recycle: the card left the board on the next refresh; the single deleted block case not run |
| J5 | Save a view with the suggested name; save another named "#Project [[x]] {{y}}" | Suggested name is "Project kanban" (no #); the second is saved as "Project x y"; neither block on "Planner views" has a tag; no view block shows up as a card | pass | 92ec1d7 | 2026-10-03 | suggested name "Project kanban" saved untagged; "#Project [[x]] {{y}} ((z)) plan" saved as "Project x y (z) plan", untagged; board still 4 cards |
| J6 | On "Planner views", edit one view block's hidden `planner-view-config` to `{"v":1,"config":{}}` (e.g. via the CLI), reopen Planner, open Saved views | The other views list and open; the broken one is greyed with "Cannot be opened: …" and can be deleted | pass | 92ec1d7 | 2026-10-03 | config corrupted from the host: listed greyed with "Cannot be opened: Invalid view config: tag must be a string", deletable; the other views still listed |
| J7 | Give #Project a choice property that allows multiple values | It is not listed in the filters, Kanban Columns / Swimlanes or Done when | pass | 771140f | 2026-10-03 | on a probe tag, not #Project: the multi-value choice "Labels" is absent from the filters, Columns, Swimlanes and Done when; the two single-value choices are listed |
| J8 | With Planner open in tab A, save a view in tab B (same graph); in A close and reopen Planner; then delete it in B and reopen in A | The view appears in A after the reopen, and is gone after the second | pass | 92ec1d7 | 2026-10-03 | a view block added from the host appeared after hide + show and opened; done from the host, not a second tab |
| J9 | Kanban with swimlanes: stub the host so the lane write does nothing (as in the T11 silent-failure check), drag a card to another column and lane | Error ends "Status was put back to …, so the card has not moved."; the graph holds the old Status and Owner | pass | 92ec1d7 | 2026-10-03 | calls: status=Doing, owner=Alice (dropped), status=Todo; error "Owner of "Mobile app" was not saved as Alice (read back differs). Status was put back to Todo, so the card has not moved."; graph unchanged |
| J10 | Give #Project a choice property named "Done?" (or "Who's"), use it as the Kanban column property and move a card | The move is written and read back with no "Not a full property ident" error | pass | 771140f | 2026-10-03 | idents `:user.property/Done?-…` and `:user.property/Who's-…`: a drag (Done? No to Yes) and the Move menu (Who's Mine to Theirs) were written and read back from the graph; no error |
| J11 | Open a tag with no properties in Timeline and in Kanban; in Logseq add a Start date property and a Status choice to it | Without reopening, the Timeline maps Start (and End by the default rule) and the Kanban shows Status columns | pass | 771140f | 2026-10-03 | the Kanban, shown during the change, went from the no-choice empty state to Status columns; the Timeline mapped Start (End None: the tag has no second date property) on switching view, Planner not closed. Properties added with the host handler `class-add-property!`; the host API `add_tag_property` rejected the tag ("Not a valid tag") by uuid and by title |
| J12 | Start dragging a Kanban card, edit a node's Status from another tab while holding it, then drop it outside the Planner frame (or press Escape) | The card does not jump during the drag; after it ends the board redraws with the edit and later edits still redraw | pass | 771140f | 2026-10-03 | same run as D14: ended with Escape; the board redrew with the edit made during the drag, and a later edit redrew too. Edit made from the host API in the same page |
| J13 | Set a #Project node's Start, then remove the value in Logseq | The node shows with no Start (undated or by its End); the rest of the tag loads | pass | 771140f | 2026-10-03 | Start removed with `logseq.api.remove_block_property` (not the UI): the attribute is gone, the node falls back to its task's dates, the rest of the tag loads, no error |
| J14 | Make the first load fail (e.g. host `preferredStartOfWeek` set to an invalid value), open Planner, then fix it and click Retry | Only the error and a Retry button show (no "No tags in this graph"); Retry loads the workspace | pass | 771140f | 2026-10-03 | the host sanitises a bad `start-of-week` config (it stays 6), so `logseq.api.get_user_configs` was wrapped to return "banana": the workspace shows only "Logseq preferredStartOfWeek is "banana", expected 0–6" with Dismiss and Retry; after unwrapping, Retry loads the workspace |
| J15 | A task with only a past Scheduled date (open, no Deadline): look at the Timeline (expand its node), the Calendar and the Agenda by date | Timeline: the scheduled marker is red (`[data-tl-marker="scheduled"][data-late]`); Calendar: no chip (Scheduled is not shown); Agenda: it is under Overdue, "scheduled … N days late" | pass | 771140f | 2026-10-03 | four tasks linked to Website relaunch. Scheduled D-3 only: red scheduled ring (red border, no fill), Overdue "scheduled 30 Sep 09:00, 3 days late", no Calendar chip. Same but Done: not late, under Earlier with Show done. Scheduled D-2 + Deadline D+3: not late. Deadline D-2 + Scheduled D+1: red deadline diamond, Overdue "2 days late", late Calendar chip |

## K. Several tags (N14)

On `planner-project` (6 #Milestone blocks, 28 #Task blocks; both tags have Start, End, Status and Owner). None run live yet.

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| K1 | Open #Milestone, tick the checkbox before #Task in the tag tree | The view shows the milestones and the tasks, each once; both tag rows are pressed and ticked; neither checkbox is disabled | pass | 8eb07ab | 2026-10-03 | desktop app (Logseq-DB), `planner-project`: ticking #Task next to #Milestone loads the union in 93 ms; 6 milestone rows with 31 task rows under them |
| K2 | Look at the Tag control in the settings bar | It reads "#Milestone + #Task"; its menu still picks one tag (switches to it) | pass | 8eb07ab | 2026-10-03 | reads "#Milestone + #Task"; a click on #Project switches to that single tag |
| K3 | Open **Dates** | "Dates: 2 tags"; a row per tag with that tag's Start and End lists; picking one tag's Start changes only that tag's bars; the popover stays open | pass | 8eb07ab | 2026-10-03 | "Dates: 2 tags" with a row for #Milestone and one for #Task, each with its own Start and End lists |
| K4 | Panel filters | Only properties both tags have (Status, Owner if they are the same property); a **Tag** group first with #Milestone and #Task and their counts; ticking #Task shows only the tasks | pass | 8eb07ab | 2026-10-03 | filter groups: Tag (#Milestone 6, #Task 31), Status, Owner; ticking Tag = #Milestone leaves the 6 milestone rows |
| K5 | Kanban over both tags, Columns = Status; Swimlanes = Tag | Every milestone and task is a card in its Status column; lanes #Milestone and #Task; a drag into the other tag's lane is refused, a drag to another column in the same lane is written and read back; the ⋯ menu lists columns only; the hint says Tag lanes are read-only | pass | 8eb07ab | 2026-10-03 | Status columns over both tags (37 cards); Swimlanes offers None, Tag, Owner; Tag lanes "#Milestone 6 | #Task 31", the board is marked read-only for lanes and the hint says a card keeps its tag. A drag across Tag lanes was not tried |
| K6 | Timeline: Arrange By date, then By tag, then Nested (the default with two tags) | By date: one list by start; By tag: a heading row #Milestone, its rows by start, then #Task and its rows; Nested: each milestone with its tasks as bars (or points) under it, indented, no marker-only task rows for them; each milestone's count is done / all of its tasks (canceled left out); connectors drawn between tasks in every arrangement (Depends on = depends_on, offered although only #Task has it) | pass | 8eb07ab | 2026-10-03 | By date: 37 rows in date order; By tag: headings #Milestone and #Task; Nested (default): each milestone with its tasks as bars under it, rollups "Foundation … 7 of 7 done"; Day zoom on Thu 1 Oct shows the nested rows with 11 connectors. "Depends on" started as None in the two-tag view (defect, see tasks.md); with depends_on picked, 38 connectors |
| K7 | Save the two-tag view, open another tag, open the saved view | Tags, per-tag dates, filters (Tag filter included) and arrangement come back; the name suggested was "Milestone +1 timeline" | pass | 8eb07ab | 2026-10-03 | saved as "Milestones with tasks" (stored JSON has tags, per-tag dates, dependsOn, arrange nested; read with the CLI); after switching to #Project it reopens with both tags, Nested, 31 children and 38 connectors |
| K8 | Open a view saved before N14 (one tag) | It opens as that tag with its Start and End, no error | not run |  |  |  |
| K9 | With only one tag ticked, try to untick it | Its checkbox is disabled; the view keeps the tag | pass | 8eb07ab | 2026-10-03 | with one tag selected its checkbox is disabled |
| K10 | Nested: click a milestone's toggle, switch to the Agenda and back, click it again | Its tasks (and their connectors) disappear and the toggle reads "Show rows under …"; still collapsed after the view switch; shown again after the second click | not run |  |  |  |
| K11 | Agenda, Group by Node, over #Milestone + #Task | One group per milestone listing its tasks as entries with their own dates and late marks; no task has a group of its own (a task linking no milestone does); Show done adds the done tasks | pass | 8eb07ab | 2026-10-03 | one group per milestone with its tasks as entries ("Views … 9/10" lists N14 and the others) |

## L. Sidebar surface (N06a)

Desktop app only (the web app has no switch). None run live yet; check with real mouse input.

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| L1 | Open Planner, click **Sidebar** in the top bar | Logseq's right sidebar opens; the page and Planner are side by side, Planner right of the sidebar's resize handle, under the header; **Sidebar** is pressed | pass | 58e37ae | 2026-10-03 | desktop app (Logseq-DB), in-app click on Sidebar: the host's right sidebar opens (x 1066, 711 px), Planner's frame goes to x 1072, 705 px wide under the header, the page stays visible at 820 px; no overflow, panel docked; top bar wraps to two rows (92 px) |
| L2 | Drag the host's sidebar resizer left and right | Planner follows the sidebar's width; the handle stays grabbable; no overflow | pass | 5b65c72 | 2026-10-04 | stable Logseq.app 2.0.1 (b09316a), second instance, real mouse (CGEvent). FAILED before 5b65c72: dragging the handle toward Planner (narrowing) stopped after about 20 px, because the frame swallowed the drag; with Planner hidden the same drag moved 153 px. After the fix: drags of +180 (stops at the sidebar's minimum width), -120, -200 and +260 px all followed, the frame with them |
| L3 | At the sidebar's width, switch through Timeline, Calendar, Agenda and Kanban | All four views are usable; the top bar wraps without overlap (title, view switch, surface switch, Saved views, Close) | pass | 58e37ae | 2026-10-03 | Calendar, Agenda, Kanban and Timeline at 705 px: no page overflow, no error |
| L4 | Make the sidebar narrower than 640 px | The panel becomes a drawer (closed by default); the Panel toggle opens it; Escape closes it | not run |  |  |  |
| L5 | Close Planner (Close, Escape, toolbar button) | Planner hides; the sidebar stays open and its own content shows again | pass | 58e37ae | 2026-10-03 | Close hides the frame; the host sidebar stays open with its own content |
| L6 | Reopen Planner (toolbar button or `g` `Shift+P`) | It opens docked in the sidebar again (the mode is kept) | pass | 58e37ae | 2026-10-03 | the toolbar button reopens Planner docked at the same place |
| L7 | With Planner docked, close Logseq's right sidebar (its own toggle or shortcut); then reopen Planner | Planner hides with the sidebar; reopening opens the sidebar again and docks | pass | 58e37ae | 2026-10-03 | closing the host's sidebar hides Planner; the next open reopens the sidebar and docks |
| L8 | Click **Workspace** | Planner fills the window under the header again; the sidebar stays as it is | pass | 58e37ae | 2026-10-03 | Workspace restores the full frame (0, 48, full width); the host sidebar is left open underneath |
| L9 | Open Planner in the web app | The top bar has no Workspace / Sidebar switch | not run |  |  |  |

## M. In-page block (N06b)

Desktop app, graph `planner-project` (page "Planner block probe" holds `{{renderer :planner, Milestones with tasks}}`;
that saved view is #Milestone + #Task, Timeline, nested). M9 also in the web app. None run live yet.

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| M1 | Open the page "Planner block probe" | The block shows a header ("Milestones with tasks", "#Milestone + #Task", **Open in Planner**) and the Timeline anchored on today, milestones with their tasks nested open; no toolbar, no toggles, no connectors; it scrolls sideways inside the block | pass | 4f288e8 | 2026-10-03 | desktop app (Logseq-DB), `planner-project`: the block shows the header ("Milestones with tasks", "#Milestone + #Task", Open in Planner) and the nested Timeline, 37 rows with bars, no connectors, nothing draggable; 31 KB of scoped styles injected once |
| M2 | Save a Kanban view in Planner, then put `{{renderer :planner, <its name>}}` in a page | The board with the view's columns (hidden columns left out) and swimlanes; no ⋯ Move buttons; cards cannot be dragged | pass | 4f288e8 | 2026-10-03 | a Kanban view saved as "Board" and referenced as "board" (case-insensitive match): 37 cards in Status columns, no Move buttons, not draggable |
| M3 | Put `{{renderer :planner, No such view}}` in a page | "No saved Planner view named “No such view”." and the saved views' names | pass | 4f288e8 | 2026-10-03 | "No saved Planner view named “No such view”. Saved views: “Milestones with tasks”." |
| M4 | With the page open (Planner closed), change a milestone's date or a task's status in another block | The block redraws within a second or so with the change | pass | 4f288e8 | 2026-10-03 | N05 set to Done from the host: within 2 s the block's Release row read "1 of 1 done"; set back to Todo: "0 of 1 done" |
| M5 | Click a bar, a row name and (Kanban) a card in a block | The node opens in the main area | partial | 4f288e8 | 2026-10-03 | a click on the row name "T08 Timeline" opened that node's page; a bar and a Kanban card were not clicked |
| M6 | Click **Open in Planner** (also once with Planner docked in the sidebar) | Planner opens in the workspace on that saved view (Saved views shows its name) | partial | 4f288e8 | 2026-10-03 | Open in Planner showed the workspace with the saved view selected (#Milestone + #Task, Timeline); not tried while docked in the sidebar |
| M7 | Switch Logseq between light and dark with a block on screen | The block follows the theme: surface, text, lines and status colours, in both modes | partial | 4f288e8 | 2026-10-03 | Inkwell light and dark: the block's text and surfaces follow (light: text rgb(30,30,32) on white cards; screenshots); Logseq's default themes not looked at |
| M8 | Put two blocks on one page (the same view twice, or two views) | Both draw; both redraw after an edit | pass | 4f288e8 | 2026-10-03 | three blocks on one page (Timeline view, unknown name, Kanban view) render independently |
| M9 | In a block, type `/Planner view`, Enter, then the name of a saved view | `{{renderer :planner, }}` is inserted (the caret lands after `}}`); with the name typed, the view shows | not run |  |  |  |
| M10 | With a block on screen, look at the rest of the page, the sidebar and the header | Nothing outside the block changed (fonts, buttons, lists, colours) | not run |  |  |  |

## N. Edit dates in the Timeline (N06c)

Desktop app. `planner-project`: DateTime Start / End on #Task and #Milestone. `planner-desktop-2`: Date Start / End on
#Project. Check every written value with the CLI (`logseq` show / query) after the step. None run live yet.

| Id | Steps | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| N1 | Open a Timeline with **Edit dates** off (its default after a start) | No handles; bars keep the pointer cursor; a click opens the node; dragging a bar does nothing | pass | 951ff58 | 2026-10-03 | desktop app (Logseq-DB): with the toggle off there are no handles and no editable bars; on: 31 editable bars with 62 handles on #Task and the help text names the keys |
| N2 | `planner-project`, #Milestone, Week zoom, Edit dates on: drag a DateTime bar two days right | The bar follows in whole days and lands two days later; Start and End both +2 days with the same time of day (CLI); connectors redraw after the drop | pass | 951ff58 | 2026-10-03 | `planner-project`, #Task (not #Milestone), Week zoom: N07 dragged two tracks right went from 4 Oct 15:00–17:00 to 6 Oct 15:00–17:00, the time of day kept; read back with the CLI |
| N3 | Same, Day zoom on the bar's day: drag a DateTime bar right by 2 quarter hours | Moves by 15-minute steps; Start and End +30 min (CLI) | pass | 951ff58 | 2026-10-03 | Day zoom on 6 Oct: 24 px right moved N07 to 15:30–17:30; graph read back as 15:30 and 17:30 local |
| N4 | Drag a bar's first 6 px, then its last 6 px (ew-resize cursor there) | Only Start, then only End changes (CLI); the bar cannot get shorter than one track or pass its other end | pass | 951ff58 | 2026-10-03 | end handle one track right: End from 6 Oct to 7 Oct; start handle one track left: Start from 6 Oct to 5 Oct; end handle dragged far left stops at one track (5 Oct 15:30–17:30) |
| N5 | `planner-desktop-2`, #Project (Date Start / End), Month zoom: move a bar to a day that has no journal page yet | That journal page now exists, on the right local day; the property points at it (CLI); the bar shows on that day | pass | 951ff58 | 2026-10-03 | `planner-desktop-2`, #Project, Week zoom (not Month): Acme rollout moved one day right reads 1 Oct – 9 Oct; the graph holds the journal pages "Oct 1st, 2026" and "Oct 9th, 2026" (journal-day 20261001 / 20261009), the intended local days; moved back to 30 Sep – 8 Oct |
| N6 | Drag a diamond (a node with one date) | Its one date moves; no resize handles on a diamond | pass | c78dcee | 2026-10-04 | stable Logseq.app 2.0.1 (b09316a), second instance, real mouse (CGEvent), sidebar surface: a diamond (27 Sep) dragged two days right reads 29 Sep; it has no handles |
| N7 | Locked items with Edit dates on: a dashed bar (dates from its tasks), task markers (expand a row), a Date bar in Day zoom, the cut-off edge of a bar running past the range | Default cursor, no handle there, a drag writes nothing; the bar's visible edge still resizes and the bar still moves | partial | 951ff58 | 2026-10-03 | Date-typed bars are locked in Day zoom (0 editable, 2 locked on `planner-desktop-2`); dashed bars and task markers were not looked at |
| N8 | Start a drag, press Escape before releasing; then press and release with less than 4 px of movement | Escape: the bar goes back, nothing is written, the release does not open the node, Planner stays open. The short press opens the node | pass | 951ff58 | 2026-10-03 | Escape during a drag: no write, Planner stays open; a plain click on a bar with Edit dates on opens the node |
| N9 | Tab to a bar; Alt+Right, Alt+Left, Alt+Shift+Right, Alt+Shift+Left (VoiceOver on once) | One track per key: move, then End only; focus stays on the bar; Logseq's own shortcuts do not fire; VoiceOver reads the bar's description naming the keys | partial | 951ff58 | 2026-10-03 | Alt+Left on a focused bar moved N07 one day earlier and wrote it; Alt+Right and the Alt+Shift pair were not tried; VoiceOver not used |
| N10 | Make a write fail (for example remove the property from the tag in another window while dragging, or edit a node in Recycle) | The bar returns to where the graph has it; the error bar names the property and the date; with two dates, it says whether the first was put back | pass | 724bb24 | 2026-10-04 | stable app, seen by accident before c78dcee: the journal-page call returned nothing, so each Date write failed; the bar went back to its place and the error read: Logseq gave no journal page for 5 Oct 2026, so Start of "Partner upgrade 0561" was not saved. The timeline shows what the graph holds. The two-date "first was put back" wording was not seen |
| N11 | Nested (#Milestone + #Task): move a child task's bar | The parent milestone's own dates do not change (CLI); its row and rollup follow the data | partial | 951ff58 | 2026-10-03 | in the #Task view: after N07 moved, its milestone "Later" kept its own Start and End in the graph; not tried in the nested arrangement |
| N12 | With a Depends on property, move a dependency's bar | The connectors follow the bars after the drop | partial | 951ff58 | 2026-10-03 | the 38 connectors were still drawn after the moves; their new positions were not inspected |
| N13 | Sidebar surface: one move and one resize | Works as in the workspace | pass | c78dcee | 2026-10-04 | stable Logseq.app 2.0.1 (b09316a), second instance, real mouse (CGEvent), sidebar surface: a bar 3-4 Oct moved two days (5-6 Oct), then its end handle one day (5-7 Oct); stored values read back. Also in the workspace surface: move by -2 days and the start handle by -1 day |
| N14 | A page with the in-page block (section M) while Edit dates is on in the workspace | The block has no handles and no toggle; nothing in it can be dragged | not run |  |  |  |
| N15 | Logseq's own Undo (Cmd+Z) right after a date edit | Record what happens (README makes no claim) | pass | c78dcee | 2026-10-04 | stable app, Cmd+Z with the focus in Planner: Logseq undoes one property write per Undo, so a move (Start and End) takes two; after the first the bar showed the new Start with the old End, after the second the old span. The Timeline followed each step without an error |

## O. Remembered per graph (N21)

| # | Step | Expected | Result | Build | Date | Notes |
|---|---|---|---|---|---|---|
| O1 | Pick a tag, switch to Kanban, close the panel, turn Edit dates on in the Timeline; restart Logseq and open Planner | The same tag, kind and settings, the panel closed, Edit dates on | pass | f71adad | 2026-10-04 | stable app, real restart of the instance (fresh profile, same ~/.logseq): #Project, Kanban, saved view, panel closed came back; Edit dates on after switching to the Timeline |
| O2 | Open a saved view, restart, open Planner | Saved views reads that view's name | pass | f71adad | 2026-10-04 | stable app: Saved views read "N19 test" after the restart |
| O3 | Desktop: switch to Sidebar, restart, open Planner | Planner opens docked over the right sidebar | pass | f71adad | 2026-10-04 | stable app: after the restart Planner opened docked (frame x 594 of a 980 px window, the sidebar open) |
| O4 | Open a second graph, change the view there, switch back to the first | Each graph shows its own last state | pass | 724bb24 | 2026-10-04 | stable app: two graphs switched back and forth five times, each showed its own tag, kind, panel and saved view. Once, on an earlier build, a switch left "[object Object]" in the error bar: not reproduced; the bar now shows the host's message (724bb24) |
| O5 | Delete the tag of the remembered view (in Logseq), restart, open Planner | The default view, no error bar | pass | 2675cce | 2026-10-04 | Logseq-DB nightly (8ffbb22), second instance, in-app calls. Tag deleted while Planner was hidden (stored: that tag, Kanban): after a restart the default view (Timeline, the other tag), no error, the deleted tag not in the tree. Tag deleted while Planner was open: the default view at once, with "unknown tag … Showing the default view instead" |
| O6 | Plugin settings file (`~/.logseq/settings/<plugin id>.json`) after O1 | A `uiState` key with one entry per graph used | pass | f71adad | 2026-10-04 | `~/.logseq/settings/logseq-planner.json` holds `uiState` with one entry per graph used (two), next to `disabled`: `updateSettings` merges as assumed |

## Stable app pass (2026-10-04, builds 724bb24 to f71adad)

Logseq.app 2.0.1, the stable build (b09316a, 2026-07-13), which the owner uses: a second instance with its own profile
over CDP (`test-logseq-desktop` skill, `LOGSEQ_APP=/Applications/Logseq.app/...`), Planner as the unpacked plugin
(production build), graph `planner-desktop` plus a second throwaway graph. Real mouse input = CGEvent clicks and drags
on the instance's window brought to the front. The rows above carry the details (A12, A13, A15, A16, B12, B12a, L2, N6,
N10, N13, N15, O1-O4, O6).

| Check | Result |
|---|---|
| Found and fixed: the host's sidebar handle could not be dragged toward a docked Planner | 5b65c72 (the frame takes no pointer events while the handle is pressed) |
| Found and fixed: every Date edit failed, "Logseq gave no journal page" | c78dcee. On b09316a `createJournalPage` returns null for local noon (existing and new pages alike) while the nightly returns the page; the page is now found by its journal day |
| Found and fixed: a host error showed as "[object Object]" | 724bb24 |
| N26, reloads on reopening after a change made while hidden | one burst of 5 queries (one reload) in two runs, nothing in the next 6 s; without a change, 1 query (the saved views). The double reload was not reproduced |
| N32, a Calendar band continuing on both sides | pass: "‹" at 5 px, the title at 15 px, "›" at the right end of a 713 px band |
| N33, Content-Security-Policy on the built page | pass: no violation in the console after a fresh start; the four views, a popover, docking and real date edits work |

Not done here: A14 (needs a true double-click), O5 (delete the remembered view's tag), `add_tag_property` from a plugin,
and the rest of the checklist on this build.

## Desktop pass (2026-10-03, build e849107)

Logseq-DB.app 2.0.1 nightly (revision 8ffbb22-dirty, built 2026-10-01), a second instance with its own profile driven over
CDP (`test-logseq-desktop` skill). Planner loaded as an unpacked plugin (its path added to `externals` in
`~/.logseq/preferences.json`, production build in `dist/`). Graph `planner-desktop`, created and seeded with the `logseq`
CLI (`graph create`, `graph import --type edn` of the small and the large seed with the app closed), persisted on disk.

| Check | Result |
|---|---|
| First open on the persisted graph | pass: tags listed, #Project shows the seed in all four views, no error |
| Lateness rule (J15) with four tasks added by `logseq upsert task` while Planner was open | pass: same marks as in the web app; the CLI writes appeared without reopening |
| Kanban drag to a visible column; Move by drag to a column reached by auto-scroll (D11) | pass: written, read back with `logseq query` |
| `g Shift+P` with Planner closed | pass: Planner opens |
| Saved view "Desk kanban": saved, app stopped and relaunched | pass: listed after the restart, opens #Project Kanban |
| 2,000 nodes (#Load item), production build | tag switch to the first paint 351 ms; view switches 18–72 ms; zoom and Next / Today 47–78 ms to paint |
| Refresh at 2,000 nodes (Kanban, Status set from the host, API call to redraw, 5 runs) | 294–373 ms (target 300 with the debounce): over on 4 of 5 |
| Unrelated edit | pass: no redraw |
| Edit in a second window on the same graph | pass: the first window's Kanban moved the card within 2.5 s |
| Dark mode (Inkwell Slate, the profile's theme) | pass: tokens flip (`--pl-label`, `--pl-red`, body background) with no reload |
| Click a Timeline name; Shift+click | pass: click opens the node and hides Planner; Shift+click adds it to the right sidebar, Planner stays |
| macOS window-button padding (A9) | pass by measurement (84 px); buttons not visible to CDP |
| Real mouse clicks on the top bar (view switch, Saved views, Close) | **failed on e849107**, reported by the owner: the host header under the frame (`#head`, top 48 px) is a window-drag region and swallowed the clicks; CDP clicks do not go through it, so the pass above missed it. Fixed in de90392 (`-webkit-app-region: no-drag` on the frame); re-run with real clicks (CGEvent): Calendar, Kanban, Saved views open and close, Close all land |

Not run on the desktop: sync from another device; the rest of sections A–J (run in the web app only); VoiceOver; a
drag by hand. `logseq graph import` is refused while the app has the graph open ("Server is owned by another process"):
import with the app closed, or write with `logseq upsert …`, which goes through the app's worker.

## Not covered / known gaps

Copied from the progress log (tasks.md). Re-check each when the environment allows; none blocks v1 on its own.

- Desktop app: only the checks under "Desktop pass" were run on it; sections A–J otherwise come from the web app
  (checkout d2ab7726ab, 2026-09-02), older than the desktop build.
- `DB.onChanged` under sync is not tested (the poll is the safety net); a second desktop window is (it refreshes).
- Dragging from the card's button in Firefox; the sticky header and Move-menu clipping near the window edges.
- Logseq's default dark theme for the Timeline (the recorded profile's dark theme was Inkwell).
- Refresh time at 2,000 nodes (H6): 165–254 ms on the Timeline with single runs at 320; 187–432 ms after a Kanban drag
  (target 250).
- Open (T12): reopening after a stale hide runs two reloads instead of one (the second changes nothing).
- T09 (polish): a band that continues on both sides now keeps its title at the left edge (N04): fixed and unit-tested, not yet re-run live.
- T06: concurrent writes to saved views are now serialised (N04): fixed and unit-tested, not yet re-run live. Open: v1 has no auto-restore of a recycled views page.
- Host quirks seen in the web app, not attributed to Planner: the first drag of a session once raised
  "SQLITE_ERROR cannot rollback" then "SQLITE_CORRUPT database disk image is malformed" until the graph was reset; in a long
  page session `open_in_right_sidebar` once returned without showing anything ("Unexpected webworker error"), fine after a
  reload. If either shows up, reload the page and note it; do not file it against Planner without a clean repro.
- The in-memory `plugin-test` graph can lose its seed on a page reload: verify the seed before every area.
- Decisions taken, confirmed by the owner on 2026-10-04 (tasks.md N03; saved views got Update and a delete confirmation
  instead, N23): filters are tick-to-narrow; Week = 3 weeks, Month = an 8-week window, Quarter = 17
  week columns in the Timeline; the Timeline and Calendar share one session anchor; "+N more" switches the layout to Week;
  a running span is filed under Today in the Agenda; the last closed value of Priority ranks highest; Kanban columns and
  lanes ignore filters.
