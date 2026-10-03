// Pure normalisation: raw query results → plain nodes and tasks. No DOM, no SDK.
import type { ClosedValue, DateProp, LocalDate, PlannerNode, PlannerTask, TagInfo } from "../types";

/** Minutes east of UTC at an instant (UTC-5 → -300). Injected so tests do not depend on process TZ. */
export type ZoneOffset = (epochMs: number) => number;

/** The machine's zone, DST-aware (`Date#getTimezoneOffset` has the opposite sign). */
export const systemZone: ZoneOffset = (epochMs) => -new Date(epochMs).getTimezoneOffset();

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `:block/journal-day` (20261023) → `2026-10-23`. */
export function journalDayToIso(journalDay: number): string {
  const s = pad(journalDay, 8);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Epoch ms → local day and `HH:MM` in the given zone. */
export function localDateTime(epochMs: number, zone: ZoneOffset): LocalDate {
  const d = new Date(epochMs + zone(epochMs) * 60_000);
  return {
    day: `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

// Raw shapes as observed (fixtures nodes.json, tasks.json, dates.json): `pull [*]` keys keep their
// namespace except :block/*; entity values are `{id}`, DateTime values are epoch ms numbers.
interface RawNode {
  id: number;
  uuid: string;
  title: string;
  tags?: { id: number }[];
  [propIdent: string]: unknown;
}
interface RawTask {
  id: number;
  uuid: string;
  title: string;
  ":logseq.property/status"?: { ident: string; title: string };
  refs?: { id: number }[];
}
/** One row of the journal-day query (`:keys raw journal-day`). */
interface RawJournalDay {
  raw: number;
  "journal-day": number;
}

const rawNodes = (raw: unknown[]) => (raw as [RawNode][]).map(([n]) => n);
const isRef = (v: unknown): v is { id: number } => typeof v === "object" && v !== null && typeof (v as { id?: unknown }).id === "number";

/** Raw nodes of `tag`; with child tags off, only nodes that carry `tag` itself. */
function selectNodes(raw: unknown[], tag: TagInfo, childTags: boolean): RawNode[] {
  const nodes = rawNodes(raw);
  return childTags ? nodes : nodes.filter((n) => (n.tags ?? []).some((t) => t.id === tag.id));
}

/** Date and choice props that apply to a node: those of every tag it carries, each ident once. */
function propsOf(node: RawNode, tagsById: Map<number, TagInfo>) {
  const dateProps = new Map<string, DateProp>();
  const choiceProps = new Map<string, TagInfo["choiceProps"][number]>();
  for (const ref of node.tags ?? []) {
    const t = tagsById.get(ref.id);
    for (const p of t?.dateProps ?? []) dateProps.set(p.ident, p);
    for (const p of t?.choiceProps ?? []) choiceProps.set(p.ident, p);
  }
  return { dateProps: [...dateProps.values()], choiceProps: [...choiceProps.values()] };
}

const tagMap = (tags: TagInfo[]) => new Map(tags.map((t) => [t.id, t]));

/** Journal page ids referenced by Date values of the selected nodes: input of the journal-day query. */
export function journalPageIds(raw: unknown[], tags: TagInfo[], tag: TagInfo, childTags: boolean): number[] {
  const tagsById = tagMap(tags);
  const ids = new Set<number>();
  for (const node of selectNodes(raw, tag, childTags)) {
    for (const p of propsOf(node, tagsById).dateProps) {
      const v = node[p.ident];
      if (p.type === "date" && isRef(v)) ids.add(v.id);
    }
  }
  return [...ids];
}

/** Raw `NODES_QUERY` rows + journal-day rows → nodes with mapped dates and choices. */
export function buildNodes(
  raw: unknown[],
  rawJournalDays: unknown[],
  tags: TagInfo[],
  tag: TagInfo,
  childTags: boolean,
  zone: ZoneOffset,
): PlannerNode[] {
  const tagsById = tagMap(tags);
  const journalDays = new Map((rawJournalDays as RawJournalDay[]).map((r) => [r.raw, r["journal-day"]]));
  return selectNodes(raw, tag, childTags).map((node) => {
    const { dateProps, choiceProps } = propsOf(node, tagsById);
    const dates: Record<string, LocalDate> = {};
    for (const p of dateProps) {
      const v = node[p.ident];
      if (p.type === "date" && isRef(v)) {
        const day = journalDays.get(v.id);
        if (day === undefined) throw new Error(`no journal day for page ${v.id} (${node.title}, ${p.title})`);
        dates[p.ident] = { day: journalDayToIso(day), time: null };
      } else if (p.type === "datetime" && typeof v === "number") {
        dates[p.ident] = localDateTime(v, zone);
      }
    }
    const choices: Record<string, ClosedValue> = {};
    for (const p of choiceProps) {
      const v = node[p.ident];
      const value = isRef(v) ? p.values.find((c) => c.id === v.id) : undefined;
      if (value) choices[p.ident] = value;
    }
    return {
      id: node.id,
      uuid: node.uuid,
      title: node.title,
      tagIds: (node.tags ?? []).map((t) => t.id),
      dates,
      choices,
    };
  });
}

/** Raw `TASKS_QUERY` rows → the tasks whose `:block/refs` hit one of `nodes`. */
export function buildTasks(raw: unknown[], nodes: PlannerNode[]): PlannerTask[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const tasks: PlannerTask[] = [];
  for (const [t] of raw as [RawTask][]) {
    const hits = (t.refs ?? []).map((r) => r.id).filter((id) => nodeIds.has(id));
    if (hits.length === 0) continue;
    const s = t[":logseq.property/status"];
    tasks.push({
      id: t.id,
      uuid: t.uuid,
      title: t.title,
      status: s ? { ident: s.ident, title: s.title } : null,
      nodeIds: hits,
    });
  }
  return tasks;
}
