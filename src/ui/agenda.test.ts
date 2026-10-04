// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTagInfos, type Dq } from "../core/schema";
import { createViewStore } from "../storage";
import type { TagInfo } from "../types";
import { createWorkspace, type Workspace } from "./workspace";
import { fakeStorage, fixtureDq, noWrites } from "./test-fakes";
import agendaCss from "./agenda.css?inline";

const TODAY = "2026-10-03";
const SITE = "6a000000-0000-4000-8000-000000000001";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const ACME = "6a000000-0000-4000-8000-000000000003";
const ARCHIVE = "6a000000-0000-4000-8000-000000000004";
const DRAFT = "6a000000-0000-4000-8000-000000000021";
const SHIP = "6a000000-0000-4000-8000-000000000022";
const WIREFRAMES = "6a000000-0000-4000-8000-000000000024";
const CONTRACT = "6a000000-0000-4000-8000-000000000025";
const KICKOFF = "6a000000-0000-4000-8000-000000000011";

let tags: TagInfo[];
let root: HTMLElement;
let ws: Workspace;
let openNode: ReturnType<typeof vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>>;
let store: ReturnType<typeof createViewStore>;
const tag = (title: string) => tags.find((x) => x.title === title)!;
const choice = (t: TagInfo, title: string) => t.choiceProps.find((p) => p.title === title)!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;

async function click(sel: string, init: MouseEventInit = {}) {
  const el = $(sel);
  if (!el) throw new Error(`nothing matches ${sel}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
  await ws.idle();
}

/** Opens the Planner on #Project (or `tagTitle`) in the Agenda. */
async function setup(opts: { dq?: Dq; tagTitle?: string; today?: string } = {}) {
  tags = await loadTagInfos(fixtureDq());
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  openNode = vi.fn<(uuid: string, opts: { sidebar: boolean }) => void>();
  store = createViewStore(fakeStorage());
  ws = createWorkspace(root, {
    dq: opts.dq ?? fixtureDq(), views: store, onClose: vi.fn(), openNode, zone: () => -300, today: () => opts.today ?? TODAY, kanban: noWrites, weekStart: async () => 0,
  });
  await ws.open();
  await click(`[data-tag-id="${tag(opts.tagTitle ?? "Project").id}"]`);
  await click("[data-view-kind=agenda]");
}

const bucket = (key: string) => $(`[data-ag-bucket="${key}"]`);
const bucketKeys = () => $$("[data-ag-bucket]").map((b) => b.dataset.agBucket);
const entriesIn = (key: string) => [...bucket(key)!.querySelectorAll<HTMLElement>("[data-ag-entry]")].map((e) => e.querySelector(".pl-ag-title")!.textContent);
const entry = (uuid: string) => $(`[data-ag-entry][data-ag-open="${uuid}"]`)!;
const groups = () => $$("[data-ag-group]").map((g) => g.dataset.agGroup);
const groupTasks = (uuid: string) => [...$(`[data-ag-group="${uuid}"]`)!.querySelectorAll<HTMLElement>("[data-ag-entry=task] .pl-ag-title")].map((e) => e.textContent);

beforeEach(() => setup());

describe("toolbar", () => {
  it("has Group by Node / Date (Node by default) and a Show done toggle, off; no other view's controls", () => {
    expect($$("[data-region=view-toolbar] [data-ag-group-by]").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
      .toEqual([["Node", "true"], ["Date", "false"]]);
    expect($("[data-region=view-toolbar] [data-ag-group-by]")!.closest("[role=group]")!.getAttribute("aria-label")).toBe("Group by");
    const done = $("[data-region=view-toolbar] [data-ag-show-done]")!;
    expect(done.tagName).toBe("BUTTON");
    expect(done.getAttribute("aria-pressed")).toBe("false");
    expect(done.textContent).toBe("Show done");
    expect($("[data-cal-nav]")).toBeNull();
    expect($("[data-tl-zoom]")).toBeNull();
    expect($("[data-region=view-toolbar]")!.dataset.toolbarKind).toBe("agenda");
  });

  it("Group by is view config, saved with a view", async () => {
    await click("[data-ag-group-by=date]");
    expect(ws.config()).toMatchObject({ kind: "agenda", groupBy: "date", showDone: false });
    expect($("[data-ag-group-by=date]")!.getAttribute("aria-pressed")).toBe("true");
    expect($("[data-agenda]")!.dataset.group).toBe("date");
    const create = vi.spyOn(store, "create");
    await click("[data-control=saved-views]");
    await click("[data-action=save-view]");
    expect(create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "agenda", groupBy: "date" }));
  });

  it("Show done is view config, saved with a view; the focus stays on the toggle", async () => {
    $("[data-ag-show-done]")!.focus(); // a real click focuses the button
    await click("[data-ag-show-done]");
    expect(ws.config()).toMatchObject({ kind: "agenda", showDone: true });
    expect($("[data-ag-show-done]")!.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe($("[data-ag-show-done]"));
    const create = vi.spyOn(store, "create");
    await click("[data-control=saved-views]");
    await click("[data-action=save-view]");
    expect(create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: "agenda", showDone: true }));
    await click("[data-ag-show-done]");
    expect(ws.config()).toMatchObject({ showDone: false });
  });
});

describe("group by node (default)", () => {
  it("one section per node, overdue first, undated last; a heading per node", () => {
    expect($("[data-agenda]")!.dataset.group).toBe("node");
    expect(groups()).toEqual([ACME, SITE, MOBILE, ARCHIVE]);
    for (const g of $$("[data-ag-group]")) expect(g.tagName).toBe("SECTION");
    const heading = $(`[data-ag-group="${SITE}"] h2`)!;
    expect(heading.textContent).toContain("Website relaunch");
    expect($(`[data-ag-group="${SITE}"]`)!.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("each node line shows its dates, status and owner, progress; its tasks sit underneath as a list", () => {
    const line = entry(SITE);
    expect(line.tagName).toBe("BUTTON");
    expect(line.dataset.agEntry).toBe("node");
    expect(line.querySelector(".pl-ag-when")!.textContent).toBe("23 Sep – 23 Oct");
    expect(line.textContent).toContain("Doing · Alice");
    expect(line.textContent).toContain("1/2");
    expect($(`[data-ag-group="${SITE}"] ul`)).not.toBeNull();
    expect(groupTasks(SITE)).toEqual(["Draft brief Website relaunch"]);
    expect(groupTasks(ACME)).toEqual(["Acme contract"]);
    expect(groupTasks(MOBILE)).toEqual(["Wireframes"]);
    expect(groupTasks(ARCHIVE)).toEqual([]);
  });

  it("flags the late task, shows its date and how late", () => {
    const t = entry(CONTRACT);
    expect(t.hasAttribute("data-late")).toBe(true);
    expect(t.dataset.status).toBe("todo");
    expect(t.querySelector(".pl-ag-when")!.textContent).toBe("due 2 Oct 12:00, 1 day late");
    expect(entry(DRAFT).hasAttribute("data-late")).toBe(false);
    expect(entry(DRAFT).querySelector(".pl-ag-when")!.textContent).toBe("due 5 Oct 17:00");
  });

  it("Show done adds the done and canceled tasks, flagged done", async () => {
    expect($(`[data-ag-entry][data-ag-open="${SHIP}"]`)).toBeNull();
    await click("[data-ag-show-done]");
    expect(groupTasks(SITE)).toEqual(["Draft brief Website relaunch", "Ship homepage Website relaunch", "Survey users Website relaunch"]);
    expect(entry(SHIP).hasAttribute("data-done")).toBe(true);
    expect(entry(SHIP).dataset.status).toBe("done");
    expect(entry(DRAFT).hasAttribute("data-done")).toBe(false);
  });
});

describe("group by date", () => {
  beforeEach(async () => {
    await click("[data-ag-group-by=date]");
  });

  it("a section with a heading per non-empty bucket, in order; empty buckets are not rendered", () => {
    expect(bucketKeys()).toEqual(["overdue", "today", "2026-10-05", "2026-10-08", "2026-10-09", "none"]);
    for (const b of $$("section[data-ag-bucket]")) expect(b.querySelectorAll("[data-ag-entry]").length).toBeGreaterThan(0);
    expect(bucket("2026-10-04")).toBeNull();
    expect(bucket("later")).toBeNull();
    expect(bucket("earlier")).toBeNull();
    expect($("[data-ag-bucket=overdue] h2")!.textContent).toContain("Overdue");
    expect(text("[data-ag-bucket=today] h2")).toBe("Today · Sat 3 Oct 2");
    expect(text("[data-ag-bucket=overdue] [data-ag-count]")).toBe("1");
  });

  it("lists the entries of each bucket, tasks with their node", async () => {
    await click("[data-ag-bucket=none] > summary");
    expect(entriesIn("overdue")).toEqual(["Acme contract"]);
    expect(entriesIn("today")).toEqual(["Acme rollout", "Website relaunch"]);
    expect(entriesIn("2026-10-05")).toEqual(["Draft brief Website relaunch"]);
    expect(entriesIn("2026-10-08")).toEqual(["Mobile app"]);
    expect(entriesIn("2026-10-09")).toEqual(["Wireframes"]);
    expect(entriesIn("none")).toEqual(["Archive cleanup"]);
    expect(entry(CONTRACT).querySelector("[data-ag-node]")!.textContent).toBe("Acme rollout");
    expect(entry(ACME).querySelector("[data-ag-node]")).toBeNull();
    expect(entry(CONTRACT).hasAttribute("data-late")).toBe(true);
    expect(text("[data-ag-bucket=overdue]")).not.toContain("[[");
  });

  it("No date starts folded (a details element); Overdue and Today are open", () => {
    expect(bucket("none")!.tagName).toBe("DETAILS");
    expect(bucket("none")!.hasAttribute("open")).toBe(false);
    expect(bucket("none")!.querySelector("summary h2")).not.toBeNull();
    expect(bucket("overdue")!.tagName).toBe("SECTION");
    expect(bucket("today")!.tagName).toBe("SECTION");
  });

  it("Show done adds the done and canceled tasks to No date", async () => {
    await click("[data-ag-show-done]");
    await click("[data-ag-bucket=none] > summary");
    expect(entriesIn("none")).toEqual(["Archive cleanup", "Ship homepage Website relaunch", "Survey users Website relaunch"]);
    expect(entry(SHIP).hasAttribute("data-done")).toBe(true);
  });

  it("#Meeting: Today with its time, tomorrow, No date", async () => {
    await setup({ tagTitle: "Meeting" });
    await click("[data-ag-group-by=date]");
    expect(bucketKeys()).toEqual(["today", "2026-10-04", "none"]);
    expect(entry(KICKOFF).querySelector(".pl-ag-when")!.textContent).toBe("3 Oct 10:30");
    expect(text("[data-ag-bucket='2026-10-04'] h2")).toBe("Tomorrow · Sun 4 Oct 1");
  });
});

describe("rendering less at 2,000 nodes (T13a)", () => {
  it("a folded bucket renders its entries only once opened; its heading keeps the count", async () => {
    await click("[data-ag-group-by=date]");
    expect(bucket("none")!.querySelectorAll("[data-ag-entry]")).toHaveLength(0);
    expect(text("[data-ag-bucket=none] [data-ag-count]")).toBe("1");
    await click("[data-ag-bucket=none] > summary");
    expect(bucket("none")!.hasAttribute("open")).toBe(true);
    expect(entriesIn("none")).toEqual(["Archive cleanup"]);
    await click("[data-ag-bucket=none] > summary"); // folded again: entries dropped on the next render
    expect(bucket("none")!.hasAttribute("open")).toBe(false);
    await click("[data-ag-show-done]");
    expect(bucket("none")!.querySelectorAll("[data-ag-entry]")).toHaveLength(0);
    expect(text("[data-ag-bucket=none] [data-ag-count]")).toBe("3");
  });

  it("a bucket opened any other way (the open property) gets its entries too", async () => {
    await click("[data-ag-group-by=date]");
    (bucket("none") as HTMLDetailsElement).open = true;
    await ws.idle();
    expect(entriesIn("none")).toEqual(["Archive cleanup"]);
  });

  it("by node: the first 100 groups, then a Show more button that adds the next 100", async () => {
    await setup({ dq: fixtureDq({ projectCopies: 220 }) }); // 224 nodes
    expect(groups()).toHaveLength(100);
    expect(text("[data-ag-more]")).toBe("Show 100 more of 124");
    await click("[data-ag-more]");
    expect(groups()).toHaveLength(200);
    expect(text("[data-ag-more]")).toBe("Show 24 more");
    await click("[data-ag-more]");
    expect(groups()).toHaveLength(224);
    expect($("[data-ag-more]")).toBeNull();
  });

  it("by date: Overdue renders its first 100 entries, then Show more adds 100; the heading keeps the real total", async () => {
    await setup({ dq: fixtureDq({ projectCopies: 220 }), today: "2027-06-01" }); // long past every date: all open nodes are overdue
    await click("[data-ag-group-by=date]");
    const total = Number(text("[data-ag-bucket=overdue] [data-ag-count]"));
    expect(total).toBeGreaterThan(200);
    expect(entriesIn("overdue")).toHaveLength(100);
    expect(text("[data-ag-bucket=overdue] [data-ag-more]")).toBe(`Show 100 more of ${total - 100}`);
    await click("[data-ag-bucket=overdue] [data-ag-more]");
    expect(entriesIn("overdue")).toHaveLength(200);
    expect(text("[data-ag-bucket=overdue] [data-ag-count]")).toBe(String(total));
    await ws.refresh(); // a live refresh keeps the expanded count
    expect(entriesIn("overdue")).toHaveLength(200);
    await click("[data-ag-bucket=overdue] [data-ag-more]");
    expect(entriesIn("overdue")).toHaveLength(total);
    expect($("[data-ag-more]")).toBeNull();
  });

  it("by date: no Show more button when Overdue fits", async () => {
    await click("[data-ag-group-by=date]");
    expect($("[data-ag-more]")).toBeNull();
  });

  it("no Show more button when every group fits", () => {
    expect(groups()).toHaveLength(4);
    expect($("[data-ag-more]")).toBeNull();
  });
});

describe("open", () => {
  it("click on an entry opens the node or task and Shift+click opens it in the sidebar", async () => {
    await click(`[data-ag-entry][data-ag-open="${SITE}"]`);
    expect(openNode).toHaveBeenLastCalledWith(SITE, { sidebar: false });
    await click(`[data-ag-entry][data-ag-open="${DRAFT}"]`, { shiftKey: true });
    expect(openNode).toHaveBeenLastCalledWith(DRAFT, { sidebar: true });
    await click("[data-ag-group-by=date]");
    await click(`[data-ag-entry][data-ag-open="${WIREFRAMES}"]`);
    expect(openNode).toHaveBeenLastCalledWith(WIREFRAMES, { sidebar: false });
    await click(`[data-ag-entry][data-ag-open="${MOBILE}"]`, { shiftKey: true });
    expect(openNode).toHaveBeenLastCalledWith(MOBILE, { sidebar: true });
    expect(openNode).toHaveBeenCalledTimes(4);
  });

  it("every entry is a button with an accessible name", () => {
    for (const e of $$("[data-ag-entry]")) {
      expect(e.tagName).toBe("BUTTON");
      expect(e.getAttribute("aria-label")).toBeTruthy();
    }
    expect(entry(CONTRACT).getAttribute("aria-label")).toBe("Acme contract, Todo, due 2 Oct 12:00, 1 day late, Acme rollout");
  });
});

describe("empty agenda", () => {
  it("says nothing is listed, in both groupings, and offers Show done", async () => {
    // Filter to Backlog (Archive cleanup, no tasks) and count Backlog as done: nothing open remains.
    const status = choice(tag("Project"), "Status");
    const backlog = status.values.find((v) => v.title === "Backlog")!;
    await click(`input[data-filter-prop="${status.ident}"][data-filter-value="${backlog.uuid}"]`);
    await click("[data-control=done-values]");
    await click(`[data-popover=done] input[data-done-prop="${status.ident}"][data-done-value="${backlog.uuid}"]`);
    await click("[data-control=done-values]");
    expect($("[data-ag-empty]")).not.toBeNull();
    expect(text("[data-ag-empty]")).toContain("Show done");
    expect($("[data-ag-bucket]")).toBeNull();
    expect($("[data-ag-show-done]")).not.toBeNull();
    await click("[data-ag-group-by=date]");
    expect($("[data-ag-empty]")).not.toBeNull();
    await click("[data-ag-show-done]");
    expect($("[data-ag-empty]")).toBeNull();
    await click("[data-ag-bucket=none] > summary");
    expect(entriesIn("none")).toEqual(["Archive cleanup"]);
  });
});

describe("stylesheet (happy-dom does not apply CSS)", () => {
  it("uses tokens only: no colour literals", () => {
    expect(agendaCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const colours = [...agendaCss.matchAll(/(?:^|[;{\s])(?:color|background|border(?:-[a-z]+)?|box-shadow|outline):\s*([^;}]+)/g)].map((m) => m[1]);
    for (const c of colours) expect(c.replace(/var\([^)]*\)/g, "")).not.toMatch(/\b(?:red|green|blue|black|white|gray|grey)\b/);
  });

  it("keeps the fallback stack wherever a font-family is set", () => {
    for (const m of agendaCss.matchAll(/font-family:\s*([^;}]+)/g)) expect(m[1]).toMatch(/var\(--pl-font\)|sans-serif|monospace/);
  });

  it("does not override [hidden]; no component rule sets display on a possibly hidden element without the base rule winning", () => {
    expect(agendaCss).not.toMatch(/\[hidden\]/);
  });

  it("late entries in red, done ones struck through for canceled and greyed, today in the accent colour", () => {
    expect(agendaCss).toMatch(/\[data-late\][^{]*\{[^}]*var\(--pl-red-text\)/);
    expect(agendaCss).toMatch(/\[data-status="canceled"\][^{]*\{[^}]*line-through/);
    expect(agendaCss).toMatch(/\[data-done\][^{]*\{[^}]*var\(--pl-label-2\)/);
    expect(agendaCss).toMatch(/\[data-ag-bucket="today"\][^{]*\{[^}]*var\(--pl-today\)/);
  });

  it("panels on the fill, radius 12; titles truncate; the toggle's pressed state is tinted", () => {
    expect(agendaCss).toMatch(/\.pl-ag-bucket,[^{]*\{[^}]*background:\s*var\(--pl-fill\)[^}]*border-radius:\s*12px/);
    expect(agendaCss).toMatch(/\.pl-ag-entry \.pl-ag-title\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(agendaCss).toMatch(/\.pl-toggle\[aria-pressed="true"\]\s*\{[^}]*var\(--pl-tint-soft\)/);
  });
});
