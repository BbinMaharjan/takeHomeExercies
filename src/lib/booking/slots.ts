import type { BookingProvider, Specialist, TimeSlot } from "@/types/booking";
import {
  addDaysToDate,
  getCurrentMinutesInZone,
  zonedWallTimeToDate,
} from "@/lib/timezone";

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface GenerateSlotsInput {
  provider: BookingProvider;
  specialist: Specialist;
  date: string; // YYYY-MM-DD provider local
  providerToday: string;
  bookedStartTimes: Set<string>;
  isClosed?: boolean;
  now?: Date;
}

export function generateSlots(input: GenerateSlotsInput): TimeSlot[] {
  const {
    provider,
    specialist,
    date,
    providerToday,
    bookedStartTimes,
    isClosed = false,
    now = new Date(),
  } = input;

  if (isClosed) return [];
  if (date < providerToday) return [];
  if (date > addDaysToDate(providerToday, 89)) return [];

  const dt = new Date(date + "T00:00:00Z");
  const weekdayName = dt
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    .toLowerCase();

  const sched = provider.daySchedules[weekdayName];
  if (!sched) return [];

  const openMin = toMinutes(sched.startTime);
  const closeMin = toMinutes(sched.endTime);

  const specStart = toMinutes(specialist.consultation.startTime);
  const specEnd = toMinutes(specialist.consultation.endTime);
  const duration = specialist.consultation.durationInMinutes;
  const buffer = specialist.consultation.bufferInMinutes;
  const interval = duration + buffer;

  const slots: TimeSlot[] = [];
  let cursor = specStart;
  while (cursor + duration <= specEnd) {
    const end = cursor + duration;
    const withinProvider = cursor >= openMin && end <= closeMin;
    if (withinProvider) {
      // today past check
      let isPast = false;
      if (date === providerToday) {
        const nowMin = getCurrentMinutesInZone(provider.normalizedTimeZone, now);
        if (cursor <= nowMin) isPast = true;
      }
      if (!isPast) {
        const startStr = fromMinutes(cursor);
        const endStr = fromMinutes(end);
        slots.push({
          startTime: startStr,
          endTime: endStr,
          isBooked: bookedStartTimes.has(startStr),
        });
      }
    }
    cursor += interval;
  }

  return slots;
}

export function availableGroupStarts(slots: TimeSlot[], groupSize: number): Set<string> {
  const result = new Set<string>();
  if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 4) return result;
  if (groupSize === 1) {
    for (const s of slots) if (!s.isBooked) result.add(s.startTime);
    return result;
  }
  for (let i = 0; i <= slots.length - groupSize; i++) {
    let ok = true;
    for (let j = 0; j < groupSize; j++) {
      if (slots[i + j].isBooked) {
        ok = false;
        break;
      }
    }
    if (ok) result.add(slots[i].startTime);
  }
  return result;
}

export function slotIndex(slots: TimeSlot[], startTime: string): number {
  return slots.findIndex((s) => s.startTime === startTime);
}

// helper to convert provider wall time to instant for two-clock display (not strictly needed)
export { zonedWallTimeToDate };