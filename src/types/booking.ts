/** Domain types for MedEx Task 3 appointment booking. */

export interface DaySchedule {
  startTime: string;
  endTime: string;
}

export interface SpecialistConsultation {
  startTime: string;
  endTime: string;
  durationInMinutes: number;
  bufferInMinutes: number;
}

export interface Specialist {
  id: string;
  name: string;
  speciality: string;
  consultation: SpecialistConsultation;
}

export interface BookingProvider {
  id: number;
  name: string;
  country: string; // country code
  timezoneSource: string;
  normalizedTimeZone: string;
  timeZoneFallbackReason?: string;
  daySchedules: Record<string, DaySchedule>;
  specialists: Specialist[];
}

export interface Closure {
  providerId: number;
  dayOffset: number;
  reason: string;
}

export interface BookedSlot {
  providerId: number;
  specialistId: string;
  dayOffset: number;
  startTime: string;
}

export interface Booking {
  bookingId: string;
  providerId: number;
  specialistId: string;
  date: string; // YYYY-MM-DD provider local
  startTime: string; // HH:MM provider local
  numberOfPeople: number;
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
  isBooked: boolean;
}

export interface TimezoneNormalizationResult {
  normalized: string;
  source: string;
  fallbackReason?: string;
}