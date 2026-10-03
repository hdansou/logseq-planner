import { describe, expect, it } from "vitest";
import {
  addDays, categoryOf, daysBetween, dueDate, formatDay, formatMonth, formatRange, isLate, startOfWeek, weekdayName, weekStartFromHost,
} from "./layout-common";
import type { LocalDate, PlannerTask } from "../types";

describe("calendar-day arithmetic", () => {
  it("adds days across month and year ends and leap days", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-13", "2026-10-23")).toBe(40);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("counts every day once across both DST transitions (US 2026: 8 Mar and 1 Nov)", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-01", "2026-03-15")).toBe(14);
    expect(daysBetween("2026-10-25", "2026-11-08")).toBe(14);
  });

  it("finds the start of the week for Sunday and Monday starts", () => {
    expect(startOfWeek("2026-10-03", 0)).toBe("2026-09-27"); // Sat → Sun before
    expect(startOfWeek("2026-10-03", 1)).toBe("2026-09-28"); // Sat → Mon before
    expect(startOfWeek("2026-09-27", 0)).toBe("2026-09-27");
    expect(startOfWeek("2026-09-27", 1)).toBe("2026-09-21"); // a Sunday belongs to the Monday before
  });
});

describe("formatting", () => {
  it("formats days, months and ranges like the Timeline", () => {
    expect(formatDay("2026-09-23")).toBe("23 Sep");
    expect(formatDay("2026-09-23", true)).toBe("23 Sep 2026");
    expect(formatMonth("2026-10-03")).toBe("October 2026");
    expect(formatRange("2026-09-27", "2026-10-03")).toBe("27 Sep – 3 Oct 2026");
    expect(formatRange("2026-12-27", "2027-01-02")).toBe("27 Dec 2026 – 2 Jan 2027");
    expect(weekdayName("2026-10-03")).toBe("Sat");
  });
});

describe("host week start (Logseq preferredStartOfWeek: 0–6 = Monday–Sunday)", () => {
  it("converts to the layouts' 0 = Sunday … 6 = Saturday", () => {
    expect(weekStartFromHost(6)).toBe(0); // Logseq's default: Sunday
    expect(weekStartFromHost(0)).toBe(1); // Monday
    expect(weekStartFromHost(5)).toBe(6); // Saturday
  });

  it("accepts a numeric string (the SDK types it as a string)", () => {
    expect(weekStartFromHost("0")).toBe(1);
    expect(weekStartFromHost("6")).toBe(0);
  });

  it("throws on anything else", () => {
    for (const bad of [undefined, null, 7, -1, 1.5, "", "x", "7", " ", {}, NaN]) {
      expect(() => weekStartFromHost(bad), String(bad)).toThrow(/preferredStartOfWeek/);
    }
  });
});

describe("category colour", () => {
  it("is 1–6 and stable per uuid", () => {
    const c = categoryOf("6a000000-0000-4000-8000-000000000001");
    expect(c).toBeGreaterThanOrEqual(1);
    expect(c).toBeLessThanOrEqual(6);
    expect(categoryOf("6a000000-0000-4000-8000-000000000001")).toBe(c);
  });
});

describe("due date and lateness", () => {
  const day = (s: string): LocalDate => ({ day: s, time: null });
  const task = (scheduled: string | null, deadline: string | null): PlannerTask => ({
    id: 1, uuid: "t1", title: "T", status: null, nodeIds: [1], scheduled: scheduled ? day(scheduled) : null, deadline: deadline ? day(deadline) : null,
  });

  it("the due date is the Deadline, else the Scheduled date, else none", () => {
    expect(dueDate(task("2026-10-01", "2026-10-05"))).toEqual(day("2026-10-05"));
    expect(dueDate(task("2026-10-01", null))).toEqual(day("2026-10-01"));
    expect(dueDate(task(null, "2026-10-05"))).toEqual(day("2026-10-05"));
    expect(dueDate(task(null, null))).toBeNull();
  });

  it("an open task is late when its due day is before today; today, later, done and undated are not", () => {
    expect(isLate(task(null, "2026-10-02"), false, "2026-10-03")).toBe(true);
    expect(isLate(task("2026-10-02", null), false, "2026-10-03")).toBe(true);
    expect(isLate(task(null, "2026-10-03"), false, "2026-10-03")).toBe(false);
    expect(isLate(task("2026-10-03", null), false, "2026-10-03")).toBe(false);
    expect(isLate(task("2026-10-02", null), true, "2026-10-03")).toBe(false);
    expect(isLate(task(null, null), false, "2026-10-03")).toBe(false);
  });

  it("with both dates the Deadline decides: a past Scheduled date before a future Deadline is not late, and the reverse is", () => {
    expect(isLate(task("2026-10-01", "2026-10-09"), false, "2026-10-03")).toBe(false);
    expect(isLate(task("2026-10-09", "2026-10-01"), false, "2026-10-03")).toBe(true);
  });
});
