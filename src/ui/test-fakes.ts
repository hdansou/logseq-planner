// Shared fakes for the workspace and view tests (not a test file: no suite of its own).
import tagsFixture from "../core/__fixtures__/tags.json";
import propsFixture from "../core/__fixtures__/class-properties.json";
import nodesFixture from "../core/__fixtures__/nodes.json";
import datesFixture from "../core/__fixtures__/dates.json";
import tasksFixture from "../core/__fixtures__/tasks.json";
import { TAG_PROPERTIES_QUERY, TAGS_QUERY, type Dq } from "../core/schema";
import { JOURNAL_DAYS_QUERY, NODES_QUERY, TASKS_QUERY } from "../core/queries";
import type { StorageDeps, ViewBlock } from "../types";

/**
 * Answers the real loaders' queries from the T01 fixtures; nodes exist for Project (+ Client project) and Meeting only.
 * `projectCopies` adds that many copies of Website relaunch ("Website relaunch 2", …; same dates, no tasks) to crowd a
 * calendar day.
 */
export const fixtureDq = (opts: { noTags?: boolean; projectCopies?: number } = {}): Dq => async (query, ...inputs) => {
  if (query === TAGS_QUERY) return opts.noTags ? [] : (tagsFixture.query.detail as unknown[]);
  if (query === TAG_PROPERTIES_QUERY) return opts.noTags ? [] : (propsFixture.query.detail as unknown[]);
  if (query === NODES_QUERY) {
    if (inputs[0] === "Project") {
      const rows = nodesFixture.projectWithExtends.detail as unknown as [Record<string, unknown>][];
      const site = rows.find(([n]) => n.title === "Website relaunch")![0];
      const copies = Array.from({ length: opts.projectCopies ?? 0 }, (_, i) => [{
        ...site, id: 9000 + i, uuid: `6a000000-0000-4000-8000-0000000090${String(i).padStart(2, "0")}`,
        title: `Website relaunch ${i + 2}`, content: `Website relaunch ${i + 2}`, "full-title": `Website relaunch ${i + 2}`,
      }]);
      return [...rows, ...copies];
    }
    if (inputs[0] === "Meeting") return nodesFixture.meeting.detail as unknown[];
    return [];
  }
  if (query === JOURNAL_DAYS_QUERY) return datesFixture.date.detail as unknown[];
  if (query === TASKS_QUERY) return tasksFixture.taskRefs.detail as unknown[];
  throw new Error(`unexpected query ${query}`);
};

/** In-memory saved-views graph; `silent` writes resolve without storing anything, like the real API on failure. */
export function fakeStorage(opts: { silent?: boolean; blocks?: ViewBlock[] } = {}): StorageDeps {
  let page: string | null = opts.blocks ? "page-1" : null;
  let blocks: ViewBlock[] = opts.blocks ?? [];
  let n = 0;
  return {
    findPage: async () => page,
    createPage: async () => void (page = "page-1"),
    ensureConfigProperty: async () => {},
    listBlocks: async () => blocks.map((b) => ({ ...b })),
    readBlock: async (u) => blocks.find((b) => b.uuid === u) ?? null,
    appendBlock: async (_p, name) => {
      if (opts.silent) return "ghost";
      const uuid = `b-${++n}`;
      blocks.push({ uuid, name, config: null });
      return uuid;
    },
    setConfig: async (u, text) => {
      const b = blocks.find((x) => x.uuid === u);
      if (b) b.config = text;
    },
    removeBlock: async (u) => void (blocks = blocks.filter((b) => b.uuid !== u)),
  };
}
