import { describe, expect, it } from "vitest";
import { journalDayToIso, localDateTime, systemZone } from "./normalize";

describe("journalDayToIso", () => {
  it("formats a journal-day number", () => {
    expect(journalDayToIso(20261023)).toBe("2026-10-23");
    expect(journalDayToIso(20260105)).toBe("2026-01-05");
  });
});

describe("localDateTime", () => {
  it("applies the zone offset in minutes east of UTC", () => {
    const ms = Date.UTC(2026, 9, 5, 4, 45);
    expect(localDateTime(ms, () => -300)).toEqual({ day: "2026-10-04", time: "23:45" });
    expect(localDateTime(ms, () => 0)).toEqual({ day: "2026-10-05", time: "04:45" });
    expect(localDateTime(ms, () => 60)).toEqual({ day: "2026-10-05", time: "05:45" });
  });

  it("asks the zone for the offset at that instant (DST)", () => {
    const seen: number[] = [];
    localDateTime(1234567890000, (m) => (seen.push(m), 0));
    expect(seen).toEqual([1234567890000]);
  });

  it("systemZone matches Date#getTimezoneOffset with the sign flipped", () => {
    const ms = Date.UTC(2026, 6, 1);
    expect(systemZone(ms)).toBe(-new Date(ms).getTimezoneOffset());
  });
});
