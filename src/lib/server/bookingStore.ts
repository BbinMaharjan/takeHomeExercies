import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  Booking,
  BookingProvider,
  Closure,
  Specialist,
  TimeSlot,
} from "@/types/booking";
import { normalizeTimeZone } from "@/lib/timezone";
import {
  addDaysToDate,
  getProviderToday,
} from "@/lib/timezone";
import { toMinutes as _toMinutes } from "@/lib/booking/slots";
import { generateSlots, availableGroupStarts } from "@/lib/booking/slots";

// Load fixture at module load (server only)
interface RawProvider {
  id: number;
  name: string;
  country: string;
  timezone: string;
  daySchedules: Record<string, { startTime: string; endTime: string }>;
  specialists: Array<{
    id: string;
    name: string;
    speciality: string;
    consultation: {
      startTime: string;
      endTime: string;
      durationInMinutes: number;
      bufferInMinutes: number;
    };
  }>;
}

interface RawFixture {
  providers: RawProvider[];
  closures: Array<{ providerId: number; dayOffset: number; reason: string }>;
  bookedSlots: Array<{
    providerId: number;
    specialistId: string;
    dayOffset: number;
    startTime: string;
  }>;
  existingBooking: {
    bookingId: string;
    providerId: number;
    specialistId: string;
    dayOffset: number;
    startTime: string;
    numberOfPeople: number;
  };
}

function loadFixture(): RawFixture {
  const p = path.join(process.cwd(), "src", "data", "task3-booking.json");
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as RawFixture;
}

const fixture = loadFixture();

function normalizeProvider(p: RawProvider): BookingProvider {
  const tz = normalizeTimeZone(p.timezone, p.country);
  return {
    id: p.id,
    name: p.name,
    country: p.country,
    timezoneSource: p.timezone,
    normalizedTimeZone: tz.normalized,
    timeZoneFallbackReason: tz.fallbackReason,
    daySchedules: p.daySchedules,
    specialists: p.specialists as Specialist[],
  };
}

const providers: BookingProvider[] = fixture.providers.map(normalizeProvider);
const providerMap = new Map(providers.map((p) => [p.id, p]));

// In-memory state
let bookings = new Map<string, Booking>();
const dynamicBookedSlots: Array<{
  providerId: number;
  specialistId: string;
  date: string;
  startTime: string;
}> = [];

function todayFor(provider: BookingProvider): string {
  return getProviderToday(provider.normalizedTimeZone);
}

function closureReasonFor(providerId: number, date: string): string | null {
  const provider = providerMap.get(providerId);
  if (!provider) return null;
  const today = todayFor(provider);
  for (const c of fixture.closures) {
    if (c.providerId !== providerId) continue;
    const cDate = addDaysToDate(today, c.dayOffset);
    if (cDate === date) return c.reason;
  }
  return null;
}

function isBookedSlot(
  providerId: number,
  specialistId: string,
  date: string,
  startTime: string,
): boolean {
  const provider = providerMap.get(providerId);
  if (!provider) return false;
  const today = todayFor(provider);
  for (const b of fixture.bookedSlots) {
    if (b.providerId !== providerId || b.specialistId !== specialistId) continue;
    const bDate = addDaysToDate(today, b.dayOffset);
    if (bDate === date && b.startTime === startTime) return true;
  }
  for (const b of dynamicBookedSlots) {
    if (
      b.providerId === providerId &&
      b.specialistId === specialistId &&
      b.date === date &&
      b.startTime === startTime
    ) {
      return true;
    }
  }
  return false;
}

function bookedStartTimesFor(
  providerId: number,
  specialistId: string,
  date: string,
): Set<string> {
  const set = new Set<string>();
  // fixture
  const provider = providerMap.get(providerId);
  if (provider) {
    const today = todayFor(provider);
    for (const b of fixture.bookedSlots) {
      if (b.providerId !== providerId || b.specialistId !== specialistId) continue;
      const bDate = addDaysToDate(today, b.dayOffset);
      if (bDate === date) set.add(b.startTime);
    }
  }
  for (const b of dynamicBookedSlots) {
    if (b.providerId === providerId && b.specialistId === specialistId && b.date === date) {
      set.add(b.startTime);
    }
  }
  return set;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomLatency() {
  return 150 + Math.floor(Math.random() * 51);
}

function shouldFail(req: Request): { fail: boolean; status?: number } {
  const url = new URL(req.url);
  if (url.searchParams.get("simulateFailure") === "true") {
    return { fail: true, status: 500 };
  }
  const failStatus = url.searchParams.get("failStatus");
  if (failStatus) {
    return { fail: true, status: Number(failStatus) };
  }
  return { fail: false };
}

function simulateConflict(req: Request): boolean {
  const url = new URL(req.url);
  return url.searchParams.get("simulateConflict") === "true";
}

function getLatency(req: Request): number {
  const url = new URL(req.url);
  const l = url.searchParams.get("latency");
  if (l) {
    const n = Number(l);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return randomLatency();
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message, message }, { status });
}

// ---- Public store API ----

export function getProvider(id: number): BookingProvider | undefined {
  return providerMap.get(id);
}

export function getProviders(): BookingProvider[] {
  return providers;
}

export async function handleGetProvidersList(req: Request): Promise<Response> {
  await delay(getLatency(req));
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to load providers");
  return Response.json({ providers });
}

export function getProviderBundle(id: number) {
  const provider = providerMap.get(id);
  if (!provider) return null;
  const today = todayFor(provider);
  // closures with dates
  const closures = fixture.closures
    .filter((c) => c.providerId === id)
    .map((c) => ({ ...c, date: addDaysToDate(today, c.dayOffset) }));
  // booked slots with dates
  const bookedSlots = fixture.bookedSlots
    .filter((b) => b.providerId === id)
    .map((b) => ({ ...b, date: addDaysToDate(today, b.dayOffset) }));
  return { provider, today, closures, bookedSlots };
}

export function getClosureReason(providerId: number, date: string): string | null {
  return closureReasonFor(providerId, date);
}

export async function handleGetProvider(req: Request, id: number): Promise<Response> {
  await delay(getLatency(req));
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to load provider");

  const bundle = getProviderBundle(id);
  if (!bundle) return jsonError(404, "Provider not found");

  return Response.json({
    provider: bundle.provider,
    today: bundle.today,
    closures: bundle.closures,
    bookedSlots: bundle.bookedSlots,
  });
}

export async function handleGetSlots(
  req: Request,
  providerId: number,
  date: string,
  specialistId: string,
): Promise<Response> {
  await delay(getLatency(req));
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to load slots");

  const provider = providerMap.get(providerId);
  if (!provider) return jsonError(404, "Provider not found");
  const specialist = provider.specialists.find((s) => s.id === specialistId);
  if (!specialist) return jsonError(404, "Specialist not found");

  // validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonError(400, "Invalid date format; expected YYYY-MM-DD");
  }

  const today = todayFor(provider);
  if (date < today) return jsonError(400, "Date is in the past");
  if (date > addDaysToDate(today, 89)) return jsonError(400, "Date outside booking window");

  const closure = closureReasonFor(providerId, date);
  if (closure) {
    return Response.json({ slots: [], date, closed: true, reason: closure });
  }

  const weekdayName = new Date(date + "T00:00:00Z")
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    .toLowerCase();
  if (!provider.daySchedules[weekdayName]) {
    return Response.json({ slots: [], date, closed: true, reason: "Closed on this day" });
  }

  const booked = bookedStartTimesFor(providerId, specialistId, date);
  const slots = generateSlots({
    provider,
    specialist,
    date,
    providerToday: today,
    bookedStartTimes: booked,
    isClosed: false,
  });

  let reason: string | null = null;
  if (slots.length === 0) reason = "No available times";
  else if (slots.every((s) => s.isBooked)) reason = "No available times";

  return Response.json({ slots, date, closed: false, reason });
}

function validateGroupSize(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  if (n < 1 || n > 4) return null;
  return n;
}

function getBooking(id: string): Booking | undefined {
  return bookings.get(id);
}

export function getExistingBooking(): Booking | undefined {
  // seeded in init
  return bookings.get(fixture.existingBooking.bookingId);
}

export async function handleGetExistingBooking(req: Request): Promise<Response> {
  await delay(getLatency(req));
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to load booking");
  const booking = getExistingBooking();
  if (!booking) return jsonError(404, "No existing booking");
  return Response.json({ booking });
}

// Seed existing booking at module load
(function seed() {
  const provider = providerMap.get(fixture.existingBooking.providerId);
  if (!provider) return;
  const today = todayFor(provider);
  const date = addDaysToDate(today, fixture.existingBooking.dayOffset);
  const booking: Booking = {
    bookingId: fixture.existingBooking.bookingId,
    providerId: fixture.existingBooking.providerId,
    specialistId: fixture.existingBooking.specialistId,
    date,
    startTime: fixture.existingBooking.startTime,
    numberOfPeople: fixture.existingBooking.numberOfPeople,
  };
  bookings.set(booking.bookingId, booking);

  // mark its slots as booked (group size)
  const specialist = provider.specialists.find((s) => s.id === booking.specialistId);
  if (specialist) {
    const booked = bookedStartTimesFor(provider.id, specialist.id, date);
    const slots = generateSlots({
      provider,
      specialist,
      date,
      providerToday: today,
      bookedStartTimes: booked,
      isClosed: false,
    });
    const idx = slots.findIndex((s) => s.startTime === booking.startTime);
    if (idx >= 0) {
      for (let j = 0; j < booking.numberOfPeople; j++) {
        if (slots[idx + j]) {
          dynamicBookedSlots.push({
            providerId: provider.id,
            specialistId: specialist.id,
            date,
            startTime: slots[idx + j].startTime,
          });
        }
      }
    }
  }
})();

export async function handleCreateBooking(
  req: Request,
  body: {
    providerId?: unknown;
    specialistId?: unknown;
    date?: unknown;
    startTime?: unknown;
    numberOfPeople?: unknown;
  },
): Promise<Response> {
  await delay(getLatency(req));
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to create booking");

  if (simulateConflict(req)) {
    return jsonError(409, "Slot was just taken by another customer");
  }

  const providerId = Number(body?.providerId);
  const specialistId = String(body?.specialistId ?? "");
  const date = String(body?.date ?? "");
  const startTime = String(body?.startTime ?? "");
  const numberOfPeople = validateGroupSize(body?.numberOfPeople);

  const provider = providerMap.get(providerId);
  if (!provider) return jsonError(400, "Invalid provider");
  const specialist = provider.specialists.find((s) => s.id === specialistId);
  if (!specialist) return jsonError(400, "Invalid specialist");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonError(400, "Invalid date");
  if (!/^\d{2}:\d{2}$/.test(startTime)) return jsonError(400, "Invalid startTime");
  if (numberOfPeople == null) return jsonError(400, "Invalid numberOfPeople (1-4)");

  const today = todayFor(provider);
  if (date < today) return jsonError(400, "Date is in the past");
  if (date > addDaysToDate(today, 89)) return jsonError(400, "Date outside booking window");

  const closure = closureReasonFor(providerId, date);
  if (closure) return jsonError(400, "Provider closed on this date");

  const weekdayName = new Date(date + "T00:00:00Z")
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    .toLowerCase();
  if (!provider.daySchedules[weekdayName]) {
    return jsonError(400, "Provider closed on this weekday");
  }

  const booked = bookedStartTimesFor(providerId, specialistId, date);
  const slots = generateSlots({
    provider,
    specialist,
    date,
    providerToday: today,
    bookedStartTimes: booked,
    isClosed: false,
  });

  const starts = availableGroupStarts(slots, numberOfPeople);
  if (!starts.has(startTime)) {
    return jsonError(409, "Selected slot is no longer available");
  }

  // verify consecutive slots free (recheck)
  const idx = slots.findIndex((s) => s.startTime === startTime);
  for (let j = 0; j < numberOfPeople; j++) {
    if (!slots[idx + j] || slots[idx + j].isBooked) {
      return jsonError(409, "Selected slot is no longer available");
    }
  }

  const bookingId = `BK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const booking: Booking = {
    bookingId,
    providerId,
    specialistId,
    date,
    startTime,
    numberOfPeople,
  };
  bookings.set(bookingId, booking);

  // mark slots booked
  for (let j = 0; j < numberOfPeople; j++) {
    dynamicBookedSlots.push({
      providerId,
      specialistId,
      date,
      startTime: slots[idx + j].startTime,
    });
  }

  return Response.json({ bookingId }, { status: 201 });
}

export async function handleUpdateBooking(
  req: Request,
  bookingId: string,
  body: { date?: unknown; startTime?: unknown },
): Promise<Response> {
  await delay(getLatency(req));
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to update booking");

  if (simulateConflict(req)) {
    return jsonError(409, "Replacement slot was just taken by another customer");
  }

  const existing = bookings.get(bookingId);
  if (!existing) return jsonError(404, "Booking not found");

  const date = String(body?.date ?? "");
  const startTime = String(body?.startTime ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonError(400, "Invalid date");
  if (!/^\d{2}:\d{2}$/.test(startTime)) return jsonError(400, "Invalid startTime");

  const provider = providerMap.get(existing.providerId);
  if (!provider) return jsonError(400, "Invalid provider");
  const specialist = provider.specialists.find((s) => s.id === existing.specialistId);
  if (!specialist) return jsonError(400, "Invalid specialist");

  const today = todayFor(provider);
  if (date < today) return jsonError(400, "Date is in the past");
  if (date > addDaysToDate(today, 89)) return jsonError(400, "Date outside booking window");

  const closure = closureReasonFor(existing.providerId, date);
  if (closure) return jsonError(400, "Provider closed on this date");

  const weekdayName = new Date(date + "T00:00:00Z")
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    .toLowerCase();
  if (!provider.daySchedules[weekdayName]) {
    return jsonError(400, "Provider closed on this weekday");
  }

  // free old slots temporarily? We should consider old booking's slots as free for new selection.
  // Remove old dynamic booked slots for this booking to allow rebooking same slot? For reschedule to different slot, old slots freed after success.
  // For availability check, exclude this booking's own old slots from booked set.
  const booked = bookedStartTimesFor(existing.providerId, existing.specialistId, date);
  // If rescheduling to same date, the old slots might be in dynamicBooked; but bookedStartTimesFor includes them.
  // Remove old start sequence from booked set for this check.
  const oldSlotsSet = new Set<string>();
  // compute old sequence if same date
  if (existing.date === date) {
    // find slots
    const oldBooked = bookedStartTimesFor(existing.providerId, existing.specialistId, date);
    // We'll just remove existing.startTime and following N-1 by interval? Easier: mark old starts
    oldSlotsSet.add(existing.startTime);
  }

  const filteredBooked = new Set(booked);
  // Remove the old booking's occupied slots from filtered booked set (so they don't block)
  // We don't know exact sequence for different date; for same date remove N consecutive from existing.startTime
  if (existing.date === date) {
    // compute interval
    const interval = specialist.consultation.durationInMinutes + specialist.consultation.bufferInMinutes;
    let cur = _toMinutes(existing.startTime);
    for (let j = 0; j < existing.numberOfPeople; j++) {
      const s = `${String(Math.floor(cur / 60)).padStart(2, "0")}:${String(cur % 60).padStart(2, "0")}`;
      filteredBooked.delete(s);
      cur += interval;
    }
  }

  const slots = generateSlots({
    provider,
    specialist,
    date,
    providerToday: today,
    bookedStartTimes: filteredBooked,
    isClosed: false,
  });

  const starts = availableGroupStarts(slots, existing.numberOfPeople);
  if (!starts.has(startTime)) {
    return jsonError(409, "Replacement slot is no longer available");
  }

  const idx = slots.findIndex((s) => s.startTime === startTime);
  for (let j = 0; j < existing.numberOfPeople; j++) {
    if (!slots[idx + j] || slots[idx + j].isBooked) {
      // isBooked reflects filteredBooked? generateSlots uses filteredBooked for isBooked flag? 
      // generateSlots sets isBooked based on bookedStartTimes passed (filteredBooked). Good.
      return jsonError(409, "Replacement slot is no longer available");
    }
  }

  // Free old slots (remove from dynamicBookedSlots)
  dynamicBookedSlots.splice(0, dynamicBookedSlots.length, ...dynamicBookedSlots.filter((b) => {
    // remove entries that belong to this booking's old slots
    if (b.providerId !== existing.providerId || b.specialistId !== existing.specialistId || b.date !== existing.date) return true;
    // check if startTime in old sequence
    const interval = specialist.consultation.durationInMinutes + specialist.consultation.bufferInMinutes;
    let cur = _toMinutes(existing.startTime);
    const oldStarts = new Set<string>();
    for (let j = 0; j < existing.numberOfPeople; j++) {
      oldStarts.add(`${String(Math.floor(cur / 60)).padStart(2, "0")}:${String(cur % 60).padStart(2, "0")}`);
      cur += interval;
    }
    return !oldStarts.has(b.startTime);
  }));

  // Update booking
  existing.date = date;
  existing.startTime = startTime;
  bookings.set(bookingId, existing);

  // mark new slots booked
  for (let j = 0; j < existing.numberOfPeople; j++) {
    dynamicBookedSlots.push({
      providerId: existing.providerId,
      specialistId: existing.specialistId,
      date,
      startTime: slots[idx + j].startTime,
    });
  }

  return Response.json({ bookingId: existing.bookingId, booking: existing }, { status: 200 });
}

export async function handleGetBooking(req: Request, bookingId: string): Promise<Response> {
  await delay(getLatency(req));
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to load booking");

  const booking = bookings.get(bookingId);
  if (!booking) return jsonError(404, "Booking not found");
  return Response.json({ booking });
}

// reset for tests
export function resetBookingStore() {
  bookings = new Map();
  dynamicBookedSlots.length = 0;
  // reseed by re-running module? Simpler: reload not possible. Instead reseed existing booking manually.
  const provider = providerMap.get(fixture.existingBooking.providerId);
  if (provider) {
    const today = todayFor(provider);
    const date = addDaysToDate(today, fixture.existingBooking.dayOffset);
    const booking: Booking = {
      bookingId: fixture.existingBooking.bookingId,
      providerId: fixture.existingBooking.providerId,
      specialistId: fixture.existingBooking.specialistId,
      date,
      startTime: fixture.existingBooking.startTime,
      numberOfPeople: fixture.existingBooking.numberOfPeople,
    };
    bookings.set(booking.bookingId, booking);
  }
}

export function getAllBookings(): Booking[] {
  return [...bookings.values()];
}