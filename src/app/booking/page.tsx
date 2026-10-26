"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Calendar,
  Card,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { CheckCircleOutlined } from "@ant-design/icons";
import { useMemo, useState, useEffect } from "react";
import type { BookingProvider, TimeSlot } from "@/types/booking";
import {
  addDaysToDate,
  formatDateInZone,
  formatTimeInZone,
  zonedWallTimeToDate,
} from "@/lib/timezone";
import { availableGroupStarts, generateSlots } from "@/lib/booking/slots";

const { Title, Text, Paragraph } = Typography;

const CUSTOMER_ZONE_FALLBACK = "UTC";
function getCustomerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || CUSTOMER_ZONE_FALLBACK;
  } catch {
    return CUSTOMER_ZONE_FALLBACK;
  }
}

interface ProviderResponse {
  provider: BookingProvider;
  today: string;
  closures: Array<{ providerId: number; dayOffset: number; reason: string; date: string }>;
  bookedSlots: Array<{
    providerId: number;
    specialistId: string;
    dayOffset: number;
    startTime: string;
    date: string;
  }>;
}

interface SlotsResponse {
  slots: TimeSlot[];
  date: string;
  closed?: boolean;
  reason?: string | null;
}

interface BookingResult {
  bookingId: string;
}

export default function BookingPage() {
  const queryClient = useQueryClient();
  const customerZone = useMemo(() => getCustomerZone(), []);

  const [mode, setMode] = useState<"book" | "reschedule">("book");
  const [providerId, setProviderId] = useState<number | null>(null);
  const [specialistId, setSpecialistId] = useState<string>("");
  const [people, setPeople] = useState<number>(1);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedStart, setSelectedStart] = useState<string>("");
  const [successBookingId, setSuccessBookingId] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<string[]>([]);

  // existing booking for reschedule
  const existingQuery = useQuery({
    queryKey: ["existing-booking"],
    queryFn: async () => {
      const res = await fetch("/api/bookings/existing");
      if (!res.ok) throw new Error("Failed to load existing booking");
      const data = await res.json();
      return data.booking as {
        bookingId: string;
        providerId: number;
        specialistId: string;
        date: string;
        startTime: string;
        numberOfPeople: number;
      };
    },
    enabled: mode === "reschedule",
  });

  function seedReschedule() {
    if (existingQuery.data) {
      setProviderId(existingQuery.data.providerId);
      setSpecialistId(existingQuery.data.specialistId);
      setSelectedDate(existingQuery.data.date);
      setPeople(existingQuery.data.numberOfPeople);
      setSelectedStart(existingQuery.data.startTime);
      setSuccessBookingId(null);
      setConflictMessage(null);
      setAlternatives([]);
    }
  }

  // Seed selections once existing booking data arrives in reschedule mode.
  useEffect(() => {
    if (mode === "reschedule" && existingQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      seedReschedule();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existingQuery.data]);

  const providersQuery = useQuery({
    queryKey: ["booking-providers"],
    queryFn: async () => {
      const res = await fetch("/api/booking/providers");
      if (!res.ok) throw new Error("Failed to load providers");
      const data = await res.json();
      return data.providers as BookingProvider[];
    },
  });

  const providerQuery = useQuery<ProviderResponse>({
    queryKey: ["booking-provider", providerId],
    queryFn: async () => {
      const res = await fetch(`/api/providers/${providerId}`);
      if (!res.ok) throw new Error("Failed to load provider");
      return (await res.json()) as ProviderResponse;
    },
    enabled: providerId != null,
  });

  const provider = providerQuery.data?.provider ?? null;
  const providerToday = providerQuery.data?.today ?? "";
  const closures = providerQuery.data?.closures ?? [];
  const bookedSlots = providerQuery.data?.bookedSlots ?? [];

  const slotsQuery = useQuery<SlotsResponse>({
    queryKey: ["slots", providerId, selectedDate, specialistId],
    queryFn: async () => {
      const res = await fetch(
        `/api/providers/${providerId}/slots?date=${selectedDate}&specialistId=${specialistId}`,
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || d.error || "Failed to load slots");
      }
      return (await res.json()) as SlotsResponse;
    },
    enabled: providerId != null && !!selectedDate && !!specialistId,
  });

  const slots = slotsQuery.data?.slots ?? [];

  const availableStarts = useMemo(
    () => availableGroupStarts(slots, people),
    [slots, people],
  );

  const effectiveSelectedStart = availableStarts.has(selectedStart)
    ? selectedStart
    : "";

  // available dates map
  const availableDateMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!provider || !specialistId) return map;
    const specialist = provider.specialists.find((s) => s.id === specialistId);
    if (!specialist) return map;
    const today = providerToday;
    for (let i = 0; i < 90; i++) {
      const ds = addDaysToDate(today, i);
      const closure = closures.find((c) => c.date === ds);
      if (closure) {
        map.set(ds, closure.reason || "Closed");
        continue;
      }
      const wd = new Date(ds + "T00:00:00Z")
        .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
        .toLowerCase();
      if (!provider.daySchedules[wd]) {
        map.set(ds, "Closed on this day");
        continue;
      }
      const bookedSet = new Set<string>();
      for (const b of bookedSlots) {
        if (b.specialistId === specialistId && b.date === ds) bookedSet.add(b.startTime);
      }
      // generate slots client-side
      const gen = generateSlots({
        provider,
        specialist,
        date: ds,
        providerToday: today,
        bookedStartTimes: bookedSet,
      });
      const hasFree = gen.some((s: TimeSlot) => !s.isBooked);
      if (!hasFree) {
        map.set(ds, gen.length === 0 ? "No available times" : "No available times");
      } else {
        map.set(ds, "");
      }
    }
    return map;
  }, [provider, specialistId, providerToday, closures, bookedSlots]);

  // mutation create
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          specialistId,
          date: selectedDate,
          startTime: effectiveSelectedStart,
          numberOfPeople: people,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw { status: res.status, message: data.message || data.error || "Booking failed" };
      }
      return data as BookingResult;
    },
    onSuccess: (data) => {
      setSuccessBookingId(data.bookingId);
      setConflictMessage(null);
      setAlternatives([]);
      queryClient.invalidateQueries({ queryKey: ["slots"] });
    },
    onError: (err: unknown) => {
      const e = err as { status?: number; message?: string } | null;
      if (e?.status === 409) {
        setConflictMessage(e.message || "Selected slot was just taken.");
        queryClient.invalidateQueries({ queryKey: ["slots", providerId, selectedDate, specialistId] });
        setAlternatives([...availableStarts].slice(0, 5));
      } else {
        setConflictMessage(e?.message || "Booking failed.");
      }
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!existingQuery.data) throw new Error("No existing booking");
      const res = await fetch(`/api/bookings/${existingQuery.data.bookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate, startTime: effectiveSelectedStart }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw { status: res.status, message: data.message || data.error || "Reschedule failed" };
      }
      return data;
    },
    onSuccess: () => {
      setSuccessBookingId(existingQuery.data?.bookingId ?? null);
      setConflictMessage(null);
      setAlternatives([]);
      queryClient.invalidateQueries({ queryKey: ["slots"] });
      queryClient.invalidateQueries({ queryKey: ["existing-booking"] });
    },
    onError: (err: unknown) => {
      const e = err as { status?: number; message?: string } | null;
      if (e?.status === 409) {
        setConflictMessage(e.message || "Replacement slot was just taken.");
        queryClient.invalidateQueries({ queryKey: ["slots", providerId, selectedDate, specialistId] });
        setAlternatives([...availableStarts].slice(0, 5));
      } else {
        setConflictMessage(e?.message || "Reschedule failed.");
      }
    },
  });

  // two-clock for selected slot
  const clocks = useMemo(() => {
    if (!provider || !selectedDate || !effectiveSelectedStart) return null;
    const instant = zonedWallTimeToDate(selectedDate, effectiveSelectedStart, provider.normalizedTimeZone);
    return {
      provider: {
        date: formatDateInZone(instant, provider.normalizedTimeZone),
        time: formatTimeInZone(instant, provider.normalizedTimeZone),
      },
      customer: {
        date: formatDateInZone(instant, customerZone),
        time: formatTimeInZone(instant, customerZone),
      },
    };
  }, [provider, selectedDate, effectiveSelectedStart, customerZone]);

  const existingClocks = useMemo(() => {
    if (!provider || !existingQuery.data) return null;
    const b = existingQuery.data;
    const instant = zonedWallTimeToDate(b.date, b.startTime, provider.normalizedTimeZone);
    return {
      provider: {
        date: formatDateInZone(instant, provider.normalizedTimeZone),
        time: formatTimeInZone(instant, provider.normalizedTimeZone),
      },
      customer: {
        date: formatDateInZone(instant, customerZone),
        time: formatTimeInZone(instant, customerZone),
      },
    };
  }, [provider, existingQuery.data, customerZone]);

  const slotPeriods = useMemo(() => {
    const groups: Record<string, TimeSlot[]> = { Morning: [], Afternoon: [], Evening: [] };
    for (const s of slots) {
      const h = Number(s.startTime.slice(0, 2));
      const key = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
      groups[key].push(s);
    }
    return groups;
  }, [slots]);

  const canConfirm =
    providerId != null &&
    !!specialistId &&
    !!selectedDate &&
    !!effectiveSelectedStart &&
    availableStarts.has(effectiveSelectedStart) &&
    !createMutation.isPending &&
    !rescheduleMutation.isPending &&
    !successBookingId;

  if (successBookingId) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto">
          <Card className="text-center">
            <CheckCircleOutlined style={{ fontSize: 48, color: "#16a34a" }} />
            <Title level={3} className="mt-4">
              {mode === "reschedule" ? "Rescheduled successfully" : "Booking confirmed"}
            </Title>
            <Text type="secondary">
              Booking ID: <strong>{successBookingId}</strong>
            </Text>
            <div className="mt-6">
              <Button
                type="primary"
                onClick={() => {
                  setSuccessBookingId(null);
                  setConflictMessage(null);
                  setAlternatives([]);
                  if (mode === "book") {
                    setSelectedStart("");
                  }
                }}
              >
                {mode === "reschedule" ? "Done" : "Book another"}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <header>
          <Title level={2} style={{ margin: 0 }}>
            Appointment Booking
          </Title>
          <Text type="secondary">
            Provider-local times shown alongside your local time ({customerZone}).
          </Text>
        </header>

        <Card>
          <Space wrap>
            <Button
              type={mode === "book" ? "primary" : "default"}
              onClick={() => {
                setMode("book");
                setSuccessBookingId(null);
              }}
            >
              New booking
            </Button>
            <Button
              type={mode === "reschedule" ? "primary" : "default"}
              onClick={() => {
                setMode("reschedule");
                seedReschedule();
              }}
            >
              Reschedule existing
            </Button>
          </Space>
        </Card>

        {mode === "reschedule" && existingQuery.isLoading && <Skeleton active />}
        {mode === "reschedule" && existingQuery.isError && (
          <Alert type="error" title="Failed to load existing booking" showIcon />
        )}

        {mode === "reschedule" && existingQuery.data && (
          <Card title="Current appointment" size="small">
            <Text>
              {existingQuery.data.bookingId} — {existingQuery.data.date}{" "}
              {existingQuery.data.startTime} ({existingQuery.data.numberOfPeople}{" "}
              {existingQuery.data.numberOfPeople === 1 ? "person" : "people"})
            </Text>
            {existingClocks && (
              <div className="mt-2 text-sm">
                <div>
                  <strong>Hospital time:</strong> {existingClocks.provider.date}{" "}
                  {existingClocks.provider.time}
                </div>
                <div>
                  <strong>Your time:</strong> {existingClocks.customer.date}{" "}
                  {existingClocks.customer.time}
                </div>
              </div>
            )}
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1" title="Selection">
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <div>
                <Text strong>Provider</Text>
                {providersQuery.isLoading ? (
                  <Skeleton.Input style={{ width: "100%" }} active />
                ) : (
                  <Select
                    style={{ width: "100%" }}
                    placeholder="Select provider"
                    value={providerId ?? undefined}
                    onChange={(v) => {
                      setProviderId(v);
                      setSpecialistId("");
                      setSelectedDate("");
                      setSelectedStart("");
                      setConflictMessage(null);
                      setAlternatives([]);
                    }}
                    options={(providersQuery.data ?? []).map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                  />
                )}
              </div>

              <div>
                <Text strong>Specialist</Text>
                <Select
                  style={{ width: "100%" }}
                  placeholder="Select specialist"
                  value={specialistId || undefined}
                  onChange={(v) => {
                    setSpecialistId(v);
                    setSelectedDate("");
                    setSelectedStart("");
                    setConflictMessage(null);
                    setAlternatives([]);
                  }}
                  disabled={!provider}
                  options={(provider?.specialists ?? []).map((s) => ({
                    value: s.id,
                    label: `${s.name} — ${s.speciality}`,
                  }))}
                />
              </div>

              <div>
                <Text strong>Number of people</Text>
                <Select
                  style={{ width: "100%" }}
                  value={people}
                  onChange={(v) => {
                    setPeople(v);
                    setSelectedStart("");
                  }}
                  options={[1, 2, 3, 4].map((n) => ({
                    value: n,
                    label: `${n} ${n === 1 ? "person" : "people"}`,
                  }))}
                />
              </div>

              {provider && (
                <div className="text-xs text-gray-500">
                  Time zone: {provider.normalizedTimeZone}
                  {provider.timeZoneFallbackReason && (
                    <div className="text-amber-600">
                      Fallback: {provider.timeZoneFallbackReason}
                    </div>
                  )}
                </div>
              )}
            </Space>
          </Card>

          <Card className="lg:col-span-2" title="Date">
            {!provider || !specialistId ? (
              <Text type="secondary">Select a provider and specialist first.</Text>
            ) : providerQuery.isLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : (
              <Calendar
                value={selectedDate ? dayjs(selectedDate) : dayjs(providerToday)}
                onSelect={(d) => {
                  const ds = d.format("YYYY-MM-DD");
                  if (availableDateMap.get(ds) === "") {
                    setSelectedDate(ds);
                    setSelectedStart("");
                    setConflictMessage(null);
                    setAlternatives([]);
                  }
                }}
                disabledDate={(current) => {
                  const ds = current.format("YYYY-MM-DD");
                  const reason = availableDateMap.get(ds);
                  return reason !== "";
                }}
                cellRender={(current, info) => {
                  if (info.type !== "date") return info.originNode;
                  const ds = current.format("YYYY-MM-DD");
                  const reason = availableDateMap.get(ds);
                  const avail = reason === "";
                  return (
                    <div
                      title={reason || "Available"}
                      className={`text-center ${avail ? "" : "opacity-40"}`}
                    >
                      <div>{current.date()}</div>
                      {avail && (
                        <div className="mx-auto mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                    </div>
                  );
                }}
              />
            )}
            {availableDateMap.size > 0 && (
              <div className="mt-2 text-xs text-gray-500">
                Green dot = available date. Hover disabled dates for reason.
              </div>
            )}
          </Card>
        </div>

        {selectedDate && (
          <Card title={`Available times — ${selectedDate}`}>
            {slotsQuery.isLoading ? (
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton.Button key={i} active style={{ width: "100%" }} />
                ))}
              </div>
            ) : slotsQuery.isError ? (
              <Alert
                type="error"
                title="Failed to load slots"
                description={slotsQuery.error?.message}
                action={
                  <Button size="small" onClick={() => slotsQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : slots.length === 0 ? (
              <Text type="secondary">
                {slotsQuery.data?.reason || "No available times on this date."}
              </Text>
            ) : (
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                {Object.entries(slotPeriods).map(([period, periodSlots]) => {
                  if (periodSlots.length === 0) return null;
                  return (
                    <div key={period}>
                      <Text strong className="block mb-2">
                        {period}
                      </Text>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {periodSlots.map((s) => {
                          const selectable =
                            !s.isBooked && availableStarts.has(s.startTime);
                          const selected = effectiveSelectedStart === s.startTime;
                          return (
                            <Button
                              key={s.startTime}
                              disabled={!selectable}
                              type={selected ? "primary" : "default"}
                              onClick={() => setSelectedStart(s.startTime)}
                              aria-label={`${s.startTime} to ${s.endTime}${
                                s.isBooked ? " booked" : ""
                              }`}
                              title={s.isBooked ? "Booked" : ""}
                            >
                              {s.startTime}
                              {s.isBooked && (
                                <Tag color="default" className="ml-1">
                                  Booked
                                </Tag>
                              )}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </Space>
            )}
          </Card>
        )}

        {effectiveSelectedStart && clocks && (
          <Card title="Review times">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Text strong>Hospital time ({provider?.normalizedTimeZone})</Text>
                <div className="text-lg">
                  {clocks.provider.date} · {clocks.provider.time}
                </div>
              </div>
              <div>
                <Text strong>Your time ({customerZone})</Text>
                <div className="text-lg">
                  {clocks.customer.date} · {clocks.customer.time}
                </div>
              </div>
            </div>
            {clocks.provider.date !== clocks.customer.date && (
              <Alert
                type="info"
                className="mt-3"
                title="Date changes across time zones"
                description={`Provider date ${clocks.provider.date}, your date ${clocks.customer.date}.`}
                showIcon
              />
            )}
            <div className="mt-2 text-sm text-gray-600">
              Start of a sequence of {people} consecutive appointment
              {people > 1 ? "s" : ""}.
            </div>
          </Card>
        )}

        {conflictMessage && (
          <Alert
            type="warning"
            title={conflictMessage}
            description={
              alternatives.length > 0
                ? `Closest alternatives: ${alternatives.join(", ")}. Select one and confirm.`
                : "Refresh availability and choose another slot."
            }
            action={
              <Button
                size="small"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["slots", providerId, selectedDate, specialistId] });
                }}
              >
                Refresh
              </Button>
            }
            showIcon
          />
        )}

        <Card>
          <Space>
            <Button
              type="primary"
              size="large"
              disabled={!canConfirm}
              loading={createMutation.isPending || rescheduleMutation.isPending}
              onClick={() => {
                setConflictMessage(null);
                setAlternatives([]);
                if (mode === "reschedule") rescheduleMutation.mutate();
                else createMutation.mutate();
              }}
            >
              {mode === "reschedule" ? "Confirm reschedule" : "Confirm booking"}
            </Button>
            {createMutation.isError && !conflictMessage && (
              <Text type="danger">
                {(createMutation.error as { message?: string } | null)?.message}
              </Text>
            )}
          </Space>
        </Card>

        {mode === "reschedule" && selectedDate && selectedStart && clocks && existingClocks && (
          <Card title="Comparison" size="small">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Text strong>Current appointment</Text>
                <div className="text-sm">
                  Hospital: {existingClocks.provider.date} {existingClocks.provider.time}
                </div>
                <div className="text-sm">
                  You: {existingClocks.customer.date} {existingClocks.customer.time}
                </div>
              </div>
              <div>
                <Text strong>New appointment</Text>
                <div className="text-sm">
                  Hospital: {clocks.provider.date} {clocks.provider.time}
                </div>
                <div className="text-sm">
                  You: {clocks.customer.date} {clocks.customer.time}
                </div>
              </div>
            </div>
            <Paragraph className="mt-2 text-xs text-gray-500">
              Confirming changes the existing booking; it does not create a new booking.
            </Paragraph>
          </Card>
        )}
      </div>
    </div>
  );
}
