// No SDK import: the `logseq` global comes from index.ts; importing the SDK here breaks unit tests (gotcha §11).
// Every SDK call and typing cast lives here. No casts are needed yet.
import type { AppDeps } from "./types";

/** The real SDK behind `registerApp`. */
export const appDeps = (): AppDeps => ({
  registerUIItem: (type, item) => logseq.App.registerUIItem(type, item),
  registerCommandPalette: (command, action) => logseq.App.registerCommandPalette(command, action),
  provideModel: (model) => logseq.provideModel(model),
  showMainUI: () => logseq.showMainUI(),
  hideMainUI: () => logseq.hideMainUI(),
  defer: (fn) => void setTimeout(fn, 0),
});
