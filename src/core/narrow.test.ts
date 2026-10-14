// N73: narrowing a view by Added (created within the last N days, or today) and Find (words in the title).
import { describe, expect, it } from "vitest";
import { isNarrowed, narrowItems, narrowMatch, parseAdded } from "./narrow";
import type { ViewItem } from "./layout-common";
import type { PlannerNode, PlannerTask } from "../types";

const TODAY = "2026-10-14";
const none = new Map<string, string>();

const node = (id: number, title: string, created?: string): PlannerNode =>
  ({ id, uuid: `n${id}`, title, tagIds: [], tag: ":user.class/Project", dates: {}, choices: {}, dependsOn: [], links: [], ...(created ? { created } : {}) });
const task = (id: number, title: string, created?: string): PlannerTask =>
  ({ id, uuid: `t${id}`, title, status: null, nodeIds: [], isNode: false, deadline: null, scheduled: null, ...(created ? { created } : {}) });
const item = (n: PlannerNode, tasks: PlannerTask[] = []): ViewItem =>
  ({ node: n, span: { kind: "undated", start: null, end: null }, tasks, progress: { done: 0, total: tasks.length } });

describe("narrowMatch", () => {
  it("is null when neither Added nor Find is on (a blank Find is off)", () => {
    expect(narrowMatch({}, TODAY, none)).toBeNull();
    expect(narrowMatch({ find: "   " }, TODAY, none)).toBeNull();
    expect(isNarrowed({})).toBe(false);
    expect(isNarrowed({ find: " " })).toBe(false);
    expect(isNarrowed({ added: 7 })).toBe(true);
    expect(isNarrowed({ find: "x" })).toBe(true);
  });

  it("Today: created today only", () => {
    const m = narrowMatch({ added: "today" }, TODAY, none)!;
    expect(m({ title: "a", created: "2026-10-14" })).toBe(true);
    expect(m({ title: "a", created: "2026-10-13" })).toBe(false);
  });

  it("Last 7 days: today and the six days before; something without a created day never matches", () => {
    const m = narrowMatch({ added: 7 }, TODAY, none)!;
    expect(m({ title: "a", created: "2026-10-08" })).toBe(true);
    expect(m({ title: "a", created: "2026-10-07" })).toBe(false);
    expect(m({ title: "a" })).toBe(false);
    expect(narrowMatch({ added: 1 }, TODAY, none)!({ title: "a", created: "2026-10-13" })).toBe(false);
  });

  it("Find: every word, in any order and any case, as a part of the title", () => {
    const m = narrowMatch({ find: "LAUNCH web" }, TODAY, none)!;
    expect(m({ title: "Website relaunch" })).toBe(true);
    expect(m({ title: "Website" })).toBe(false);
  });

  it("Find reads an inline ref as the title it shows", () => {
    const titles = new Map([["6a000000-0000-4000-8000-000000000001", "Website relaunch"]]);
    const m = narrowMatch({ find: "relaunch" }, TODAY, titles)!;
    expect(m({ title: "Draft brief [[6a000000-0000-4000-8000-000000000001]]" })).toBe(true);
    expect(m({ title: "Draft brief [[6a000000-0000-4000-8000-000000000009]]" })).toBe(false);
  });

  it("both on: both must match", () => {
    const m = narrowMatch({ added: "today", find: "pricing" }, TODAY, none)!;
    expect(m({ title: "Q4 pricing page", created: TODAY })).toBe(true);
    expect(m({ title: "Q4 pricing page", created: "2026-09-01" })).toBe(false);
    expect(m({ title: "Hiring", created: TODAY })).toBe(false);
  });
});

describe("narrowItems", () => {
  const m = narrowMatch({ added: 7 }, TODAY, none)!;
  const oldTask = task(10, "Old task", "2026-01-02");
  const newTask = task(11, "New task", "2026-10-13");

  it("a matching node keeps all its tasks; an old node with a new task keeps only that task; spans and progress stay", () => {
    const fresh = item(node(1, "New node", "2026-10-12"), [oldTask, newTask]);
    const old = item(node(2, "Old node", "2025-03-01"), [oldTask, newTask]);
    const stale = item(node(3, "Stale node", "2025-03-01"), [oldTask]);
    const out = narrowItems([fresh, old, stale], m);
    expect(out.map((i) => i.node.id)).toEqual([1, 2]);
    expect(out[0]).toBe(fresh);
    expect(out[1].tasks).toEqual([newTask]);
    expect(out[1].span).toBe(old.span);
    expect(out[1].progress).toBe(old.progress);
  });
});

describe("parseAdded", () => {
  it("Today, or a whole number of days from 1 to 365; anything else is off", () => {
    expect(parseAdded("today")).toBe("today");
    expect(parseAdded(7)).toBe(7);
    expect(parseAdded(365)).toBe(365);
    for (const bad of [0, 366, 2.5, -1, "7", "week", null, undefined]) expect(parseAdded(bad)).toBeUndefined();
  });
});
