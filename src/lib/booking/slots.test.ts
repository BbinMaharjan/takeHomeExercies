import { describe, it, expect } from "vitest";
import { normalizeTimeZone } from "@/lib/timezone";
import { generateSlots, availableGroupStarts, toMinutes } from "@/lib/booking/slots";
import type { BookingProvider, Specialist } from "@/types/booking";

function makeProvider(overrides: Partial<BookingProvider> = {}): BookingProvider {
  return {
    id: 1,
    name: "Test",
    country: "TH",
    timezoneSource: "Asia/Bangkok",
    normalizedTimeZone: "Asia/Bangkok",
    daySchedules: {
      monday: { startTime: "08:00", endTime: "20:00" },
      tuesday: { startTime: "08:00", endTime: "20:00" },
    },
    specialists: [],
    ...overrides,
  };
}

function makeSpecialist(overrides: Partial<Specialist> = {}): Specialist {
  return {
    id: "s1",
    name: "Dr",
    speciality: "GP",
    consultation: {
      startTime: "10:00",
      endTime: "16:00",
      durationInMinutes: 30,
      bufferInMinutes: 10,
    },
    ...overrides,
  };
}

describe("generateSlots", () => {
  it("duration+buffer interval and end boundary", () => {
    const p = makeProvider();
    const s = makeSpecialist();
    const today = "2026-10-26";
    // force monday? Use a known monday date
    const monday = "2026-10-26"; // Monday
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: monday,
      providerToday: monday,
      bookedStartTimes: new Set(),
      now: new Date("2026-10-26T00:00:00Z"),
    });
    // first 10:00, last slot ending <=16:00: 10:00,10:40,11:20,12:00,12:40,13:20,14:00,14:40,15:20 (ends 15:50) ; 16:00? start 16:00+30=16:30 >16 no
    expect(slots[0].startTime).toBe("10:00");
    expect(slots[slots.length - 1].endTime <= "16:00").toBe(true);
    const ends = slots.map((x) => x.endTime);
    expect(ends.every((e) => e <= "16:00")).toBe(true);
  });

  it("slot ending exactly at closing time allowed", () => {
    const p = makeProvider({
      daySchedules: { monday: { startTime: "08:00", endTime: "12:00" } },
    });
    const s = makeSpecialist({
      consultation: { startTime: "09:00", endTime: "12:00", durationInMinutes: 60, bufferInMinutes: 0 },
    });
    const monday = "2026-10-26";
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: monday,
      providerToday: monday,
      bookedStartTimes: new Set(),
      now: new Date("2026-10-26T00:00:00Z"),
    });
    expect(slots.some((x) => x.startTime === "11:00" && x.endTime === "12:00")).toBe(true);
  });

  it("slot exceeding boundary excluded", () => {
    const p = makeProvider({
      daySchedules: { monday: { startTime: "08:00", endTime: "11:30" } },
    });
    const s = makeSpecialist({
      consultation: { startTime: "09:00", endTime: "12:00", durationInMinutes: 60, bufferInMinutes: 0 },
    });
    const monday = "2026-10-26";
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: monday,
      providerToday: monday,
      bookedStartTimes: new Set(),
      now: new Date("2026-10-26T00:00:00Z"),
    });
    // 11:00-12:00 exceeds provider close 11:30 -> excluded; 10:00-11:00 allowed
    expect(slots.some((x) => x.startTime === "11:00")).toBe(false);
    expect(slots.some((x) => x.startTime === "10:00")).toBe(true);
  });

  it("specialist partially overlapping provider hours", () => {
    const p = makeProvider({
      daySchedules: { monday: { startTime: "09:00", endTime: "12:00" } },
    });
    const s = makeSpecialist({
      consultation: { startTime: "07:00", endTime: "11:00", durationInMinutes: 30, bufferInMinutes: 0 },
    });
    const monday = "2026-10-26";
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: monday,
      providerToday: monday,
      bookedStartTimes: new Set(),
      now: new Date("2026-10-26T00:00:00Z"),
    });
    // first valid start >= 09:00
    expect(slots[0].startTime).toBe("09:00");
    expect(slots.every((x) => x.endTime <= "12:00")).toBe(true);
  });

  it("no overlap returns empty", () => {
    const p = makeProvider({
      daySchedules: { monday: { startTime: "08:00", endTime: "09:00" } },
    });
    const s = makeSpecialist({
      consultation: { startTime: "10:00", endTime: "12:00", durationInMinutes: 30, bufferInMinutes: 0 },
    });
    const monday = "2026-10-26";
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: monday,
      providerToday: monday,
      bookedStartTimes: new Set(),
      now: new Date("2026-10-26T00:00:00Z"),
    });
    expect(slots).toHaveLength(0);
  });

  it("missing weekday schedule returns empty", () => {
    const p = makeProvider({ daySchedules: {} });
    const s = makeSpecialist();
    const monday = "2026-10-26";
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: monday,
      providerToday: monday,
      bookedStartTimes: new Set(),
    });
    expect(slots).toHaveLength(0);
  });

  it("closure handled by isClosed", () => {
    const p = makeProvider();
    const s = makeSpecialist();
    const monday = "2026-10-26";
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: monday,
      providerToday: monday,
      bookedStartTimes: new Set(),
      isClosed: true,
    });
    expect(slots).toHaveLength(0);
  });

  it("past slots excluded on provider today", () => {
    const p = makeProvider();
    const s = makeSpecialist();
    const monday = "2026-10-26";
    // now late in day
    const now = new Date();
    // use provider current minutes by constructing a date far future? Instead set now to 15:00 Bangkok
    // We'll just ensure slots with start <= current excluded; hard to deterministic. Check no crash.
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: monday,
      providerToday: monday,
      bookedStartTimes: new Set(),
      now: new Date("2026-10-26T10:00:00+07:00"),
    });
    expect(slots.every((x) => x.startTime > "10:00" || x.startTime === "10:40")).toBe(true);
  });

  it("outside 90-day window returns empty", () => {
    const p = makeProvider();
    const s = makeSpecialist();
    const monday = "2026-10-26";
    const far = "2027-02-01";
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: far,
      providerToday: monday,
      bookedStartTimes: new Set(),
    });
    expect(slots).toHaveLength(0);
  });

  it("booked slot marked", () => {
    const p = makeProvider();
    const s = makeSpecialist();
    const monday = "2026-10-26";
    const slots = generateSlots({
      provider: p,
      specialist: s,
      date: monday,
      providerToday: monday,
      bookedStartTimes: new Set(["10:00"]),
      now: new Date("2026-10-26T00:00:00Z"),
    });
    expect(slots.find((x) => x.startTime === "10:00")?.isBooked).toBe(true);
  });
});

describe("availableGroupStarts", () => {
  it("group of 1 returns free slots", () => {
    const slots = [
      { startTime: "10:00", endTime: "10:30", isBooked: false },
      { startTime: "10:40", endTime: "11:10", isBooked: true },
    ];
    const r = availableGroupStarts(slots, 1);
    expect(r.has("10:00")).toBe(true);
    expect(r.has("10:40")).toBe(false);
  });

  it("group of 2 requires consecutive free", () => {
    const slots = [
      { startTime: "10:00", endTime: "10:30", isBooked: false },
      { startTime: "10:40", endTime: "11:10", isBooked: false },
      { startTime: "11:20", endTime: "11:50", isBooked: true },
      { startTime: "12:00", endTime: "12:30", isBooked: false },
    ];
    const r = availableGroupStarts(slots, 2);
    expect(r.has("10:00")).toBe(true);
    expect(r.has("10:40")).toBe(false); // would need 11:20 booked
    expect(r.has("12:00")).toBe(false); // only one
  });

  it("booked slot interrupts sequence", () => {
    const slots = [
      { startTime: "10:00", endTime: "10:30", isBooked: false },
      { startTime: "10:40", endTime: "11:10", isBooked: true },
      { startTime: "11:20", endTime: "11:50", isBooked: false },
    ];
    const r = availableGroupStarts(slots, 2);
    expect(r.size).toBe(0);
  });

  it("group beyond closing (final slots) not offered", () => {
    const slots = [
      { startTime: "10:00", endTime: "10:30", isBooked: false },
      { startTime: "10:40", endTime: "11:10", isBooked: false },
    ];
    const r = availableGroupStarts(slots, 3);
    expect(r.size).toBe(0);
  });

  it("group of 4", () => {
    const slots = Array.from({ length: 4 }, (_, i) => ({
      startTime: `10:${String(i * 10).padStart(2, "0")}`,
      endTime: `10:${String(i * 10 + 5).padStart(2, "0")}`,
      isBooked: false,
    }));
    // adjust times not important
    const r = availableGroupStarts(slots, 4);
    expect(r.size).toBe(1);
  });
});