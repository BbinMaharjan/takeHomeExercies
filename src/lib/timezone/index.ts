/**
 * Time-zone normalization for MedEx providers.
 *
 * Provider schedules are wall-clock times in the provider's zone. The source
 * `timezone` field is free text and may be IANA, UTC offset, Windows-style, or
 * empty/invalid. This module never falls back to the browser's local zone.
 */

import type { TimezoneNormalizationResult } from "@/types/booking";

export const COUNTRY_FALLBACK_ZONES: Record<string, string> = {
  TH: "Asia/Bangkok",
  NP: "Asia/Kathmandu",
  IN: "Asia/Kolkata",
};

export const WINDOWS_TIMEZONE_MAP: Record<string, string> = {
  "Nepal Standard Time": "Asia/Kathmandu",
  "India Standard Time": "Asia/Kolkata",
  "SE Asia Standard Time": "Asia/Bangkok",
};

/**
 * Common UTC offsets mapped to a concrete IANA zone. Used when an offset can be
 * interpreted but no Etc/GMT zone exists for the minute precision.
 */
export const UTC_OFFSET_TO_ZONE: Record<string, string> = {
  "+00:00": "UTC",
  "+05:30": "Asia/Kolkata",
  "+05:45": "Asia/Kathmandu",
  "+07:00": "Asia/Bangkok",
};

export function validateIanaTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface ParsedOffset {
  sign: "+" | "-";
  hours: number;
  minutes: number;
}

function parseUtcOffset(input: string): ParsedOffset | null {
  const s = input.replace(/[()]/g, "").trim();
  const m = s.match(/^(?:(?:UTC|GMT)\s*)?([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i);
  if (!m) return null;
  // Require that either a UTC/GMT keyword or a leading sign with two-digit-ish hour is present.
  // The regex already requires a sign.
  const hours = Number(m[2]);
  const minutes = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hours) || hours > 14) return null;
  if (!Number.isFinite(minutes) || minutes > 59) return null;
  return { sign: m[1] as "+" | "-", hours, minutes };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fallback(countryCode: string, source: string, reason: string): TimezoneNormalizationResult {
  const zone = COUNTRY_FALLBACK_ZONES[countryCode] ?? "UTC";
  return { normalized: zone, source, fallbackReason: `${reason} -> ${zone}` };
}

export function normalizeTimeZone(
  source: string,
  countryCode: string,
): TimezoneNormalizationResult {
  const original = source;
  const trimmed = source.trim();

  if (!trimmed) {
    return fallback(countryCode, original, "empty value");
  }

  if (WINDOWS_TIMEZONE_MAP[trimmed]) {
    return { normalized: WINDOWS_TIMEZONE_MAP[trimmed], source: original };
  }

  const offset = parseUtcOffset(trimmed);
  if (offset) {
    const key = `${offset.sign}${pad2(offset.hours)}:${pad2(offset.minutes)}`;
    if (UTC_OFFSET_TO_ZONE[key]) {
      return { normalized: UTC_OFFSET_TO_ZONE[key], source: original };
    }
    return fallback(countryCode, original, `unmapped UTC offset ${key}`);
  }

  // Legacy/alias handling
  let candidate = trimmed;
  if (candidate === "Asia/Katmandu") {
    candidate = "Asia/Kathmandu";
  }

  if (validateIanaTimeZone(candidate)) {
    return { normalized: candidate, source: original };
  }

  if (validateIanaTimeZone(trimmed)) {
    return { normalized: trimmed, source: original };
  }

  return fallback(countryCode, original, "unrecognized value");
}

export function formatDateInZone(date: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

export function formatTimeInZone(date: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  let h = parts.find((p) => p.type === "hour")!.value;
  const m = parts.find((p) => p.type === "minute")!.value;
  if (h === "24") h = "00";
  return `${h}:${m}`;
}

export function getProviderToday(zone: string, now: Date = new Date()): string {
  return formatDateInZone(now, zone);
}

export function getCurrentMinutesInZone(zone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  let h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  if (h === 24) h = 0;
  return h * 60 + m;
}

export function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function weekdayFromDateStr(dateStr: string): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();
}

/**
 * Format a provider-local date+time (wall clock) into a full Date instant using the
 * provider zone, so it can be converted to another zone. Uses Intl to find offset.
 */
export function zonedWallTimeToDate(dateStr: string, timeStr: string, zone: string): Date {
  // Build an ISO string and adjust using the zone offset at that instant.
  // Approach: start with UTC interpretation, then correct by the difference between
  // the zone's offset and UTC.
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  // Initial guess: treat wall time as UTC
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  // Compute offset of zone at guess
  const offsetMs = getZoneOffsetMs(zone, guess);
  // wall = utc + offset  => utc = wall - offset
  return new Date(guess.getTime() - offsetMs);
}

export function getZoneOffsetMs(zone: string, date: Date): number {
  // Returns milliseconds to add to UTC to get zone wall time.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const mo = Number(parts.find((p) => p.type === "month")!.value);
  const da = Number(parts.find((p) => p.type === "day")!.value);
  let h = Number(parts.find((p) => p.type === "hour")!.value);
  const mi = Number(parts.find((p) => p.type === "minute")!.value);
  const se = Number(parts.find((p) => p.type === "second")!.value);
  if (h === 24) h = 0;
  const asUtc = Date.UTC(y, mo - 1, da, h, mi, se);
  return asUtc - date.getTime();
}

export function formatDateTimeInZone(date: Date, zone: string): { date: string; time: string } {
  return { date: formatDateInZone(date, zone), time: formatTimeInZone(date, zone) };
}