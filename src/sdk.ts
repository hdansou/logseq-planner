// No SDK import: the `logseq` global comes from index.ts; importing the SDK here breaks unit tests (gotcha §11).
// Every SDK call and typing cast lives here. No casts are needed yet.
import type { Dq } from "./core/schema";
import type { AppDeps } from "./types";

/** The real SDK behind `registerApp`. */
export const appDeps = (): AppDeps => ({
  registerUIItem: (type, item) => logseq.App.registerUIItem(type, item),
  registerCommandPalette: (command, action) => logseq.App.registerCommandPalette(command, action),
  provideModel: (model) => logseq.provideModel(model),
  showMainUI: () => logseq.showMainUI(),
  hideMainUI: () => logseq.hideMainUI(),
  theme: {
    later: (fn, ms) => void setTimeout(fn, ms),
    getUserConfigs: () => logseq.App.getUserConfigs(),
    resolveThemeCssPropsVals: (names) => logseq.UI.resolveThemeCssPropsVals(names),
    onThemeModeChanged: (cb) => void logseq.App.onThemeModeChanged(cb),
    onThemeChanged: (cb) => void logseq.App.onThemeChanged(cb),
  },
  defer: (fn) => void setTimeout(fn, 0),
});

/** `logseq.DB.datascriptQuery` as the injectable `Dq` the core takes (string inputs are EDN-read; see CLAUDE.md). */
export const datascriptQuery: Dq = (query, ...inputs) => logseq.DB.datascriptQuery(query, ...inputs);
