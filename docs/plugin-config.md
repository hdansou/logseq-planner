# Plugin config convention

Where a Logseq DB plugin keeps its own data, and how to tell it from the user's. Written for Planner, meant to be reused by
the owner's other plugins. Status: a proposal (2026-10-11); Planner follows it for the UI state since N50 (hidden page "Plugin state: Planner"); the saved views are still blocks with a property on the visible "Planner views" page. What was tested is marked "tested"; the rest is source reading or inference.

## 1. Three places, by kind of data

| Kind | Where | Why |
|---|---|---|
| Per device (window size, dock width) | plugin settings (`~/.logseq/settings/<id>.json`, `logseq.settings`) | not synced, not part of the graph |
| Per graph, the plugin's own (UI state, caches) | hidden config page in the graph | syncs with the graph, stays out of the user's way |
| Per graph, the user's (saved views, user-editable defaults) | visible page, one block each | the user names, edits and links them |
| Secrets | plugin settings only, see section 6 | never in the graph |

## 2. Names

- **Plugin properties** are namespaced by the host as `plugin.property.<plugin id>/<key>`; the id differs between a dev
  install and a real one, so never query across plugins by that namespace.
- **Keys** are `<plugin>-<role>`, the same roles in every plugin:
  - `<plugin>-view-config` one saved view's config
  - `<plugin>-ui-state` machine state (open panel, last view)
  - `<plugin>-settings` defaults the user may edit
- **Pages**: `Plugin <role>: <Plugin name>`, one page per role (owner decision 2026-10-11): `Plugin views: Planner` (the user's saved
  views, visible), `Plugin settings: Planner` (editable defaults, visible), `Plugin state: Planner` (machine state, hidden). The shared prefix groups every plugin's pages together and is distinctive
  enough that a user page will not collide. No `/` namespaces (they create a visible parent page). The host's own `$$$` prefix
  hides a page by name, but it is the host's internal convention, not a documented plugin one: do not rely on it.

Renaming a page is `renamePage(uuid, newTitle)`: it takes the page uuid (a title fails with "Invalid page uuid"), keeps the blocks and
resolves true (tested 2026-10-11). Planner renamed "Planner views" to "Plugin views: Planner" that way, on first read.

## 3. Hiding the machine state (tested 2026-10-11, nightly d24abc9, throwaway graph)

- `upsertBlockProperty(pageUuid, ":logseq.property/hide?", true)` is accepted on a page and reads back `true`
  (the call returns null, so read it back with a query).
- The hidden page and its blocks are absent from All pages (UI and `get_all_pages`) and from the search dialog.
- A datascript query by title still finds them, so the plugin reads and writes them as before.
- Not tested: opening a hidden page by link, the stable app (b09316a).
- Hiding applies to the whole page: never put something the user must reach on the same page as the machine state.

## 4. The property type: text, not string (tested 2026-10-11)

- Create config properties as `{ type: "default", hide: true }`. `default` is the host's "text" type; its value is a block, so it
  can show as a code block, and a hidden one stays hidden. `string` is an internal type: a `string` property with `hide: true`
  still showed on the page. The schema key is `hide`; `hide?` is ignored.
- A property's type cannot change once it holds data ("can't be changed because it has existing data"): a wrong type costs a new
  key. Planner moved from `planner-view-config` (string) to `planner-view-json` (text), reading the old one as a fallback.
- `getBlockProperty` returns the string for a `string` property and an object (`value`, `title`, `id`) for a text one.
- A fenced string written to a text property renders as a highlighted code block and keeps its indentation; the stored text
  keeps the fences, so strip them when reading.

## 5. The value: JSON in an envelope

```json
{ "v": 1, "config": { } }
```

- `v` is the schema version; the payload under `config` is free-form and validated by the plugin on read.
- Reading is tolerant: keep unknown keys when writing back, so an older and a newer plugin version do not erase each other's fields.
- A value that does not parse is never overwritten: show an error and leave the block as it is.
- Write rarely (two devices on one graph overwrite each other, last writer wins) and only when the value changed.
- Config refers to tags and properties by ident, so it does not survive copying to another graph.

### As a code block (tested 2026-10-11)

For values the user may read or edit, a child code block is a better editor than a property string:

- Create it by writing the fence in the block content: `` ```json\n{…}\n``` ``. The block gets display-type `code` and
  language `json` (built-in `:logseq.property.node/display-type`, `:logseq.property.code/lang`) and renders in CodeMirror with highlighting.
- Setting the properties on a plain block does not work: `display-type` is rejected ("should be a Clojure keyword").
- The stored text has its title's leading indentation stripped (pretty-printing is lost; the JSON stays valid).
- The block's text is the JSON; read it with `JSON.parse`. Not tested: a hand edit and a read back.
- A code block's text is searchable. On a hidden page it is not, on a visible page it will show in search.

## 6. Secrets (an API token, for example for a local LM Studio server)

- Never in the graph: it syncs, can be published and is searchable.
- Keep it in the plugin's settings. They are saved in plaintext in `~/.logseq/settings/<id>.json`, per device, never synced.
- Tested/read from the SDK types: the settings schema has no password field (`inputAs` offers color, date, datetime-local, range,
  textarea only), so the token shows in the settings dialog. The host has keychain code, but plugins cannot use it.
- Rules for the plugin:
  - make the token optional (a local LM Studio server usually needs none);
  - read it at the moment of a request, never keep it in state that is saved or rendered;
  - never put it in a log line, an error message, an export, a saved view or a UI-state value;
  - say in the plugin's description that it is stored in plaintext on this device.

## 7. Open items

- Saved views stay hidden text properties (N51); child code blocks (section 5) are for visible, user-edited values such as `Plugin settings: <name>`.
- A shared helper package for the owner's plugins, so the names, the envelope and the tolerant read live in one place.
