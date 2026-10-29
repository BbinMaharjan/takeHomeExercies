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
  Divider,
  Radio,
} from "antd";
import dayjs from "dayjs";
import {
  CheckCircleOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  UserOutlined,
  EnvironmentOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
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
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone || CUSTOMER_ZONE_FALLBACK
    );
  } catch {
    return CUSTOMER_ZONE_FALLBACK;
  }
}

interface ProviderResponse {
  provider: BookingProvider;
  today: string;
  closures: Array<{
    providerId: number;
    dayOffset: number;
    reason: string;
    date: string;
  }>;
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

  useEffect(() => {
    if (mode === "reschedule" && existingQuery.data) {
      seedReschedule();
    }
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
        if (b.specialistId === specialistId && b.date === ds)
          bookedSet.add(b.startTime);
      }
      const gen = generateSlots({
        provider,
        specialist,
        date: ds,
        providerToday: today,
        bookedStartTimes: bookedSet,
      });
      const hasFree = gen.some((s: TimeSlot) => !s.isBooked);
      if (!hasFree) {
        map.set(
          ds,
          gen.length === 0 ? "No available times" : "No available times",
        );
      } else {
        map.set(ds, "");
      }
    }
    return map;
  }, [provider, specialistId, providerToday, closures, bookedSlots]);

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
        throw {
          status: res.status,
          message: data.message || data.error || "Booking failed",
        };
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
        queryClient.invalidateQueries({
          queryKey: ["slots", providerId, selectedDate, specialistId],
        });
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
        body: JSON.stringify({
          date: selectedDate,
          startTime: effectiveSelectedStart,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw {
          status: res.status,
          message: data.message || data.error || "Reschedule failed",
        };
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
        queryClient.invalidateQueries({
          queryKey: ["slots", providerId, selectedDate, specialistId],
        });
        setAlternatives([...availableStarts].slice(0, 5));
      } else {
        setConflictMessage(e?.message || "Reschedule failed.");
      }
    },
  });

  const clocks = useMemo(() => {
    if (!provider || !selectedDate || !effectiveSelectedStart) return null;
    const instant = zonedWallTimeToDate(
      selectedDate,
      effectiveSelectedStart,
      provider.normalizedTimeZone,
    );
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
    const instant = zonedWallTimeToDate(
      b.date,
      b.startTime,
      provider.normalizedTimeZone,
    );
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
    const groups: Record<string, TimeSlot[]> = {
      Morning: [],
      Afternoon: [],
      Evening: [],
    };
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
      <div
        style={{
          padding: "40px 16px",
          maxWidth: 700,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <Card
          style={{
            borderRadius: 16,
            padding: "24px 16px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "#f6ffed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
              border: "1px solid #b7eb8f",
            }}
          >
            <CheckCircleOutlined style={{ fontSize: 40, color: "#52c41a" }} />
          </div>
          <Title level={3} style={{ marginBottom: 8 }}>
            {mode === "reschedule"
              ? "Rescheduled successfully"
              : "Booking confirmed"}
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 24 }}>
            Booking Reference ID:{" "}
            <strong style={{ color: "#262626" }}>{successBookingId}</strong>
          </Paragraph>
          <Button
            type="primary"
            size="large"
            style={{
              paddingInline: 32,
              borderRadius: 8,
              height: 44,
              width: "100%",
              maxWidth: 280,
            }}
            onClick={() => {
              setSuccessBookingId(null);
              setConflictMessage(null);
              setAlternatives([]);
              if (mode === "book") {
                setSelectedStart("");
              }
            }}
          >
            {mode === "reschedule" ? "Done" : "Book another appointment"}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 16px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <Title
            level={2}
            style={{ margin: 0, fontSize: "clamp(22px, 4vw, 30px)" }}
          >
            Appointment Booking
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Provider-local times shown alongside your local time (
            <EnvironmentOutlined style={{ marginInline: 4 }} />
            {customerZone}).
          </Text>
        </div>

        <Radio.Group
          value={mode}
          onChange={(e) => {
            const val = e.target.value;
            setMode(val);
            setSuccessBookingId(null);
            if (val === "reschedule") seedReschedule();
          }}
          optionType="button"
          buttonStyle="solid"
          size="large"
          style={{ width: "100%", display: "flex" }}
        >
          <Radio.Button value="book" style={{ flex: 1, textAlign: "center" }}>
            New Booking
          </Radio.Button>
          <Radio.Button
            value="reschedule"
            style={{ flex: 1, textAlign: "center" }}
          >
            Reschedule
          </Radio.Button>
        </Radio.Group>
      </div>

      <Divider style={{ margin: "12px 0 20px" }} />

      {mode === "reschedule" && existingQuery.isLoading && (
        <Skeleton active paragraph={{ rows: 2 }} />
      )}
      {mode === "reschedule" && existingQuery.isError && (
        <Alert
          type="error"
          message="Failed to load existing booking"
          showIcon
          style={{ marginBottom: 24, borderRadius: 8 }}
        />
      )}

      {mode === "reschedule" && existingQuery.data && (
        <Card
          title={
            <Space>
              <ClockCircleOutlined /> Current Appointment details
            </Space>
          }
          style={{
            marginBottom: 24,
            borderRadius: 12,
            border: "1px solid #d9d9d9",
            background: "#fafafa",
          }}
        >
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text>
              Reference ID: <strong>{existingQuery.data.bookingId}</strong> ·
              Date: <strong>{existingQuery.data.date}</strong> at{" "}
              <strong>{existingQuery.data.startTime}</strong> (
              {existingQuery.data.numberOfPeople}{" "}
              {existingQuery.data.numberOfPeople === 1 ? "person" : "people"})
            </Text>
            {existingClocks && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 16,
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid #f0f0f0",
                  }}
                >
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, display: "block" }}
                  >
                    HOSPITAL TIME
                  </Text>
                  <Text strong>
                    {existingClocks.provider.date} ·{" "}
                    {existingClocks.provider.time}
                  </Text>
                </div>
                <div
                  style={{
                    background: "#fff",
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid #f0f0f0",
                  }}
                >
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, display: "block" }}
                  >
                    YOUR LOCAL TIME
                  </Text>
                  <Text strong>
                    {existingClocks.customer.date} ·{" "}
                    {existingClocks.customer.time}
                  </Text>
                </div>
              </div>
            )}
          </Space>
        </Card>
      )}

      {/* Main Responsive Grid Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 20,
          marginBottom: 24,
        }}
      >
        {/* Selection Column */}
        <Card
          title={
            <Space>
              <UserOutlined /> Selection Parameters
            </Space>
          }
          style={{
            borderRadius: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            border: "1px solid #f0f0f0",
          }}
        >
          <Space direction="vertical" style={{ width: "100%" }} size={16}>
            <div>
              <Text strong style={{ display: "block", marginBottom: 6 }}>
                Provider
              </Text>
              {providersQuery.isLoading ? (
                <Skeleton.Input style={{ width: "100%" }} active />
              ) : (
                <Select
                  style={{ width: "100%" }}
                  size="large"
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
              <Text strong style={{ display: "block", marginBottom: 6 }}>
                Specialist
              </Text>
              <Select
                style={{ width: "100%" }}
                size="large"
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
              <Text strong style={{ display: "block", marginBottom: 6 }}>
                Number of People
              </Text>
              <Select
                style={{ width: "100%" }}
                size="large"
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
              <div
                style={{
                  background: "#f5f5f5",
                  padding: 12,
                  borderRadius: 8,
                  marginTop: 8,
                }}
              >
                <Text
                  type="secondary"
                  style={{ fontSize: 12, display: "block" }}
                >
                  TIME ZONE INFO
                </Text>
                <Text style={{ fontSize: 13 }}>
                  {provider.normalizedTimeZone}
                </Text>
                {provider.timeZoneFallbackReason && (
                  <Text
                    type="warning"
                    style={{ fontSize: 12, display: "block", marginTop: 4 }}
                  >
                    Fallback: {provider.timeZoneFallbackReason}
                  </Text>
                )}
              </div>
            )}
          </Space>
        </Card>

        {/* Date Selection Calendar Column */}
        <Card
          title={
            <Space>
              <CalendarOutlined /> Select Date
            </Space>
          }
          style={{
            borderRadius: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            border: "1px solid #f0f0f0",
          }}
        >
          {!provider || !specialistId ? (
            <div style={{ padding: "48px 0", textAlign: "center" }}>
              <Text type="secondary">
                Please select a provider and specialist first to view available
                dates.
              </Text>
            </div>
          ) : providerQuery.isLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : (
            <div
              style={{
                width: "100%",
                maxWidth: 720,
                margin: "0 auto",
                overflowX: "auto",
              }}
            >
              <div
                style={{
                  border: "1px solid #f0f0f0",
                  borderRadius: 10,
                  padding: 4,
                  background: "#fff",
                }}
              >
                <Calendar
                  fullscreen={false}
                  value={
                    selectedDate ? dayjs(selectedDate) : dayjs(providerToday)
                  }
                  validRange={[
                    dayjs(providerToday),
                    dayjs(providerToday).add(89, "day"),
                  ]}
                  onSelect={(d) => {
                    const ds = d.format("YYYY-MM-DD");
                    const reason = availableDateMap.get(ds);

                    if (reason === "") {
                      setSelectedDate(ds);
                      setSelectedStart("");
                      setConflictMessage(null);
                      setAlternatives([]);
                    }
                  }}
                  disabledDate={(current) => {
                    const ds = current.format("YYYY-MM-DD");
                    const reason = availableDateMap.get(ds);

                    return (
                      current.isBefore(dayjs(providerToday), "day") ||
                      reason !== ""
                    );
                  }}
                  cellRender={(current, info) => {
                    if (info.type !== "date") return info.originNode;

                    const ds = current.format("YYYY-MM-DD");
                    const reason = availableDateMap.get(ds);
                    const isPast = current.isBefore(
                      dayjs(providerToday),
                      "day",
                    );
                    const isAvailable = !isPast && reason === "";

                    const unavailableReason = isPast
                      ? "Past date"
                      : reason === undefined
                        ? "Availability not loaded"
                        : reason || "Available";

                    return (
                      <div
                        title={unavailableReason}
                        aria-label={`${ds}: ${unavailableReason}`}
                        style={{
                          textAlign: "center",
                          opacity: isAvailable ? 1 : 0.4,
                        }}
                      >
                        <div>{current.date()}</div>
                        <div
                          style={{
                            marginTop: 2,
                            display: "flex",
                            height: 8,
                            justifyContent: "center",
                          }}
                        >
                          {isAvailable ? (
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: "#52c41a",
                              }}
                            />
                          ) : (
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: "#ff4d4f",
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }}
                />
              </div>
              {availableDateMap.size > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    color: "#8c8c8c",
                    textAlign: "center",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "#52c41a",
                      marginRight: 6,
                    }}
                  ></span>
                  Green dot indicates available date. Hover disabled dates for
                  details.
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {selectedDate && (
        <Card
          title={
            <Space>
              <ClockCircleOutlined /> Available Times for {selectedDate}
            </Space>
          }
          style={{
            marginBottom: 24,
            borderRadius: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            border: "1px solid #f0f0f0",
          }}
        >
          {slotsQuery.isLoading ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                gap: 12,
              }}
            >
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton.Button
                  key={i}
                  active
                  style={{ width: "100%", height: 40 }}
                />
              ))}
            </div>
          ) : slotsQuery.isError ? (
            <Alert
              type="error"
              message="Failed to load slots"
              description={slotsQuery.error?.message}
              action={
                <Button size="small" onClick={() => slotsQuery.refetch()}>
                  Retry
                </Button>
              }
              showIcon
            />
          ) : slots.length === 0 ? (
            <Text type="secondary">
              {slotsQuery.data?.reason || "No available times on this date."}
            </Text>
          ) : (
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
              {Object.entries(slotPeriods).map(([period, periodSlots]) => {
                if (periodSlots.length === 0) return null;
                return (
                  <div key={period}>
                    <Text
                      strong
                      style={{
                        display: "block",
                        marginBottom: 10,
                        fontSize: 15,
                        color: "#595959",
                      }}
                    >
                      {period}
                    </Text>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(110px, 1fr))",
                        gap: 10,
                      }}
                    >
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
                            style={{
                              height: 44,
                              borderRadius: 8,
                              fontWeight: selected ? 600 : 400,
                              borderColor: selected ? undefined : "#d9d9d9",
                              width: "100%",
                            }}
                          >
                            <span>{s.startTime}</span>
                            {s.isBooked && (
                              <Tag
                                color="default"
                                style={{
                                  marginLeft: 4,
                                  fontSize: 9,
                                  padding: "0 2px",
                                }}
                              >
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
        <Card
          title={
            <Space>
              <CheckCircleOutlined style={{ color: "#52c41a" }} /> Review
              Selected Times
            </Space>
          }
          style={{
            marginBottom: 24,
            borderRadius: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            border: "1px solid #f0f0f0",
            background: "#fcfcfc",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            <div
              style={{
                background: "#fff",
                padding: 16,
                borderRadius: 8,
                border: "1px solid #f0f0f0",
              }}
            >
              <Text
                type="secondary"
                style={{ fontSize: 12, display: "block", marginBottom: 4 }}
              >
                HOSPITAL TIME ({provider?.normalizedTimeZone})
              </Text>
              <Text strong style={{ fontSize: 15 }}>
                {clocks.provider.date} · {clocks.provider.time}
              </Text>
            </div>
            <div
              style={{
                background: "#fff",
                padding: 16,
                borderRadius: 8,
                border: "1px solid #f0f0f0",
              }}
            >
              <Text
                type="secondary"
                style={{ fontSize: 12, display: "block", marginBottom: 4 }}
              >
                YOUR LOCAL TIME ({customerZone})
              </Text>
              <Text strong style={{ fontSize: 15 }}>
                {clocks.customer.date} · {clocks.customer.time}
              </Text>
            </div>
          </div>
        </Card>
      )}

      {conflictMessage && (
        <Alert
          type="warning"
          message="Booking Conflict"
          description={
            <div>
              <p>{conflictMessage}</p>
              {alternatives.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Text strong>Alternative available start times:</Text>
                  <Space wrap style={{ marginTop: 6 }}>
                    {alternatives.map((alt) => (
                      <Button
                        key={alt}
                        size="small"
                        onClick={() => setSelectedStart(alt)}
                      >
                        {alt}
                      </Button>
                    ))}
                  </Space>
                </div>
              )}
            </div>
          }
          showIcon
          style={{ marginBottom: 24, borderRadius: 8 }}
        />
      )}

      {/* Action Confirmation Button */}
      <div style={{ textAlign: "right" }}>
        <Button
          type="primary"
          size="large"
          disabled={!canConfirm}
          loading={createMutation.isPending || rescheduleMutation.isPending}
          onClick={() => {
            if (mode === "book") {
              createMutation.mutate();
            } else {
              rescheduleMutation.mutate();
            }
          }}
          style={{
            height: 48,
            paddingInline: 32,
            borderRadius: 8,
            fontWeight: 600,
            width: "100%",
            maxWidth: 320,
          }}
        >
          {mode === "reschedule" ? "Confirm Reschedule" : "Confirm Booking"}{" "}
          <ArrowRightOutlined />
        </Button>
      </div>
    </div>
  );
}
