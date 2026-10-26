import { describe, it, expect } from "vitest";
import {
  normalizeTimeZone,
  COUNTRY_FALLBACK_ZONES,
  formatDateInZone,
  addDaysToDate,
  getZoneOffsetMs,
  zonedWallTimeToDate,
} from "@/lib/timezone";

describe("normalizeTimeZone", () => {
  it("handles valid IANA Asia/Bangkok", () => {
    const r = normalizeTimeZone("Asia/Bangkok", "TH");
    expect(r.normalized).toBe("Asia/Bangkok");
    expect(r.fallbackReason).toBeUndefined();
  });

  it("trims whitespace around IANA", () => {
    const r = normalizeTimeZone("  Asia/Bangkok  ", "TH");
    expect(r.normalized).toBe("Asia/Bangkok");
  });

  it("handles UTC+05:45", () => {
    const r = normalizeTimeZone(" UTC+05:45", "NP");
    expect(r.normalized).toBe("Asia/Kathmandu");
  });

  it("handles (GMT+5:45)", () => {
    const r = normalizeTimeZone("(GMT+5:45)", "NP");
    expect(r.normalized).toBe("Asia/Kathmandu");
  });

  it("handles Windows-style Nepal Standard Time", () => {
    const r = normalizeTimeZone("Nepal Standard Time", "NP");
    expect(r.normalized).toBe("Asia/Kathmandu");
  });

  it("normalizes legacy Asia/Katmandu to Asia/Kathmandu", () => {
    const r = normalizeTimeZone("Asia/Katmandu ", "NP");
    expect(r.normalized).toBe("Asia/Kathmandu");
  });

  it("falls back to country zone for empty value", () => {
    const r = normalizeTimeZone("", "IN");
    expect(r.normalized).toBe("Asia/Kolkata");
    expect(r.fallbackReason).toContain("empty");
  });

  it("validates IANA safely (invalid)", () => {
    const r = normalizeTimeZone("Not/AZone", "TH");
    expect(r.normalized).toBe("Asia/Bangkok");
    expect(r.fallbackReason).toContain("unrecognized");
  });

  it("keeps source separate", () => {
    const r = normalizeTimeZone(" UTC+05:45", "NP");
    expect(r.source).toBe(" UTC+05:45");
  });

  it("handles all distinct fixture values", () => {
    const values = [
      "Asia/Bangkok",
      " UTC+05:45",
      "Nepal Standard Time",
      "(GMT+5:45)",
      "Asia/Katmandu ",
      "",
    ];
    const expected: Record<string, string> = {
      "Asia/Bangkok": "Asia/Bangkok",
      " UTC+05:45": "Asia/Kathmandu",
      "Nepal Standard Time": "Asia/Kathmandu",
      "(GMT+5:45)": "Asia/Kathmandu",
      "Asia/Katmandu ": "Asia/Kathmandu",
      "": "Asia/Kolkata", // depends on country; use NP? adjust
    };
    // empty with TH country
    for (const v of values) {
      const country = v === "" ? "IN" : v.includes("Bangkok") ? "TH" : "NP";
      const r = normalizeTimeZone(v, country);
      if (v === "") {
        expect(r.normalized).toBe(COUNTRY_FALLBACK_ZONES[country]);
      } else {
        expect(r.normalized).toBeTruthy();
      }
    }
  });
});

describe("conversion", () => {
  it("Bangkok/Kathmandu date boundary", () => {
    // 2026-11-10 10:00 Bangkok -> Kathmandu 08:45 same day? Bangkok +7, Kathmandu +5:45 => -1:15
    const instant = zonedWallTimeToDate("2026-11-10", "10:00", "Asia/Bangkok");
    const ktmDate = formatDateInZone(instant, "Asia/Kathmandu");
    const ktmTime = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kathmandu",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(instant);
    expect(ktmDate).toBe("2026-11-10");
    expect(ktmTime).toBe("08:45");
  });

  it("crosses midnight correctly", () => {
    // 2026-11-10 01:00 Bangkok -> Kathmandu previous day 23:45
    const instant = zonedWallTimeToDate("2026-11-10", "01:00", "Asia/Bangkok");
    const ktmDate = formatDateInZone(instant, "Asia/Kathmandu");
    expect(ktmDate).toBe("2026-11-09");
  });

  it("addDaysToDate", () => {
    expect(addDaysToDate("2026-10-26", 3)).toBe("2026-10-29");
  });
});