"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Radio,
  Space,
  Tag,
  Typography,
  message,
  Skeleton,
  Divider,
} from "antd";
import {
  CreditCardOutlined,
  ShopOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { normalizeCart, isGroupCheckoutEligible } from "@/lib/cart";
import type {
  CartGroup,
  GroupCheckoutAttempt,
  CheckoutState,
} from "@/types/cart";
import { ApiError } from "@/types/cart";
import { fetchCart, checkout, fetchOrder } from "@/lib/api/cart";
import {
  makeAttempt,
  executeGroupCheckout,
  runAllGroups,
} from "@/lib/checkout/orchestration";
import {
  readPersisted,
  persistAttempts,
  clearPersisted,
} from "@/lib/checkout/persistence";
import Link from "next/link";

const { Title, Text, Paragraph } = Typography;

// helper to build checkout items from a group
function buildItems(group: CartGroup) {
  return group.items
    .filter((l) => l.id)
    .map((l) => ({
      lineId: l.id,
      productId: l.productId,
      quantity: l.quantity,
      wellnessPricingId: l.wellnessPricingId ?? null,
      unitPrice: null,
      currency: l.product?.currency ?? "",
    }));
}

export default function CheckoutPage() {
  const { data: cart, isLoading } = useQuery({
    queryKey: ["cart"],
    queryFn: fetchCart,
  });

  const [attempts, setAttempts] = useState<GroupCheckoutAttempt[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<
    Record<string, "card" | "pay_at_clinic">
  >({});
  const [running, setRunning] = useState(false);

  // initialize attempts from cart
  useEffect(() => {
    if (!cart) return;
    if (attempts.length > 0) return;
    const c = normalizeCart(cart);
    // restore persisted
    const persisted = readPersisted();
    if (persisted && persisted.attempts.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAttempts(persisted.attempts);
      const pm: Record<string, "card" | "pay_at_clinic"> = {};
      persisted.attempts.forEach((a) => (pm[a.groupType] = a.paymentMethod));
      setPaymentMethods((prev) => ({ ...pm, ...prev }));
      return;
    }
    const atts = c.groups.map((g) => {
      const pm = paymentMethods[g.type] ?? "card";
      return makeAttempt({
        groupType: g.type,
        paymentMethod: pm,
        items: buildItems(g).map((it) => ({ ...it, unitPrice: null })),
      });
    });
    // set blocked state for ineligible groups
    const withState = atts.map((a, idx) => {
      const g = c.groups[idx];
      if (!isGroupCheckoutEligible(g)) {
        return { ...a, state: "blocked" as const };
      }
      return a;
    });
    setAttempts(withState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  // reconcile persisted orders on mount
  useEffect(() => {
    const persisted = readPersisted();
    if (!persisted) return;
    (async () => {
      const updated = await Promise.all(
        persisted.attempts.map(async (a) => {
          if (
            a.orderId &&
            (a.state === "pending" || a.state === "needs_attention")
          ) {
            try {
              const o = await fetchOrder(a.orderId);
              const newState: CheckoutState =
                o.status === "paid"
                  ? "paid"
                  : o.status === "failed"
                    ? "failed"
                    : "pending";
              return { ...a, status: o.status, state: newState };
            } catch {
              return a;
            }
          }
          return a;
        }),
      );
      setAttempts(updated);
      persistAttempts(updated);
    })();
  }, []);

  const persist = (atts: GroupCheckoutAttempt[]) => {
    setAttempts(atts);
    persistAttempts(atts);
  };

  const handlePaymentChange = (
    groupType: string,
    value: "card" | "pay_at_clinic",
  ) => {
    setPaymentMethods((prev) => ({ ...prev, [groupType]: value }));
    setAttempts((prev) =>
      prev.map((a) =>
        a.groupType === groupType ? { ...a, paymentMethod: value } : a,
      ),
    );
  };

  const checkoutOne = async (groupType: string) => {
    const idx = attempts.findIndex((a) => a.groupType === groupType);
    if (idx < 0) return;
    const a = attempts[idx];
    if (a.state === "blocked" || a.state === "paid") return;
    // ensure payment method
    const pm = paymentMethods[groupType] ?? a.paymentMethod;
    const attempt = { ...a, paymentMethod: pm, state: "ready" as const };
    setRunning(true);
    try {
      const updated = await executeGroupCheckout(
        attempt,
        async (req) => {
          const res = await checkout({
            ...req,
            items: req.items.map((it) => ({ ...it, unitPrice: null })),
          });
          return res;
        },
        fetchOrder,
      );
      const next = [...attempts];
      next[idx] = updated;
      persist(next);
      if (updated.state === "paid")
        message.success(`${groupType}: paid successfully`);
      else if (updated.state === "failed")
        message.error(`${groupType}: checkout failed`);
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "Checkout error");
    } finally {
      setRunning(false);
    }
  };

  const checkoutAll = async () => {
    setRunning(true);
    try {
      const eligible = attempts.filter(
        (a) => a.state !== "paid" && a.state !== "blocked",
      );
      const updatedAll = await runAllGroups(
        eligible,
        async (req) =>
          checkout({
            ...req,
            items: req.items.map((it) => ({ ...it, unitPrice: null })),
          }),
        fetchOrder,
        (progress) => {
          // merge progress back into full attempts list
          setAttempts((prev) => {
            const map = new Map(progress.map((p) => [p.groupType, p]));
            const next = prev.map((a) => map.get(a.groupType) ?? a);
            persistAttempts(next);
            return next;
          });
        },
      );
      // persist final
      setAttempts((prev) => {
        const map = new Map(updatedAll.map((p) => [p.groupType, p]));
        const next = prev.map((a) => map.get(a.groupType) ?? a);
        persistAttempts(next);
        return next;
      });
    } finally {
      setRunning(false);
    }
  };

  const retryFailed = async () => {
    setRunning(true);
    try {
      const failed = attempts.filter(
        (a) => a.state === "failed" || a.state === "needs_attention",
      );
      // reuse same idempotency keys (already on attempts)
      const updatedAll = await runAllGroups(
        failed.map((a) => ({ ...a, state: "ready" as const })),
        async (req) =>
          checkout({
            ...req,
            items: req.items.map((it) => ({ ...it, unitPrice: null })),
          }),
        fetchOrder,
        (progress) => {
          setAttempts((prev) => {
            const map = new Map(progress.map((p) => [p.groupType, p]));
            const next = prev.map((a) => map.get(a.groupType) ?? a);
            persistAttempts(next);
            return next;
          });
        },
      );
      setAttempts((prev) => {
        const map = new Map(updatedAll.map((p) => [p.groupType, p]));
        const next = prev.map((a) => map.get(a.groupType) ?? a);
        persistAttempts(next);
        return next;
      });
    } finally {
      setRunning(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: "48px 24px", maxWidth: 900, margin: "0 auto" }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  const c = cart ? normalizeCart(cart) : null;

  return (
    <div style={{ padding: "32px 24px", maxWidth: 1000, margin: "0 auto" }}>
      {/* Header Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <Link href="/cart">
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              style={{ paddingLeft: 0, marginBottom: 8 }}
            >
              Back to cart
            </Button>
          </Link>
          <Title level={2} style={{ margin: 0 }}>
            Checkout Orders
          </Title>
          <Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            Each group is checked out as a separate order. You can select
            different payment methods per group.
          </Paragraph>
        </div>

        <Space size="middle" wrap>
          <Button
            type="primary"
            onClick={checkoutAll}
            disabled={running}
            loading={running}
            icon={<PlayCircleOutlined />}
            style={{ borderRadius: 8, height: 40 }}
          >
            Checkout all eligible groups
          </Button>
          <Button
            onClick={retryFailed}
            disabled={running}
            icon={<ReloadOutlined />}
            style={{ borderRadius: 8, height: 40 }}
          >
            Retry failed
          </Button>
        </Space>
      </div>

      <Divider style={{ margin: "12px 0 24px" }} />

      {/* Checkout Groups Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {attempts.map((a) => {
          const group = c?.groups.find((g) => g.type === a.groupType);
          return (
            <Card
              key={a.groupType}
              style={{
                borderRadius: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                border: "1px solid #f0f0f0",
              }}
              title={
                <Space>
                  <span
                    style={{
                      textTransform: "capitalize",
                      fontSize: 16,
                      fontWeight: 600,
                    }}
                  >
                    {a.groupType} Group
                  </span>
                  <Tag
                    color={stateColor(a.state)}
                    style={{
                      borderRadius: 12,
                      paddingInline: 8,
                      textTransform: "capitalize",
                    }}
                  >
                    {a.state.replace("_", " ")}
                  </Tag>
                </Space>
              }
              extra={
                group && (
                  <Space size={4}>
                    {Object.entries(group.subtotals).map(([cur, amt]) => (
                      <Tag
                        key={cur}
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          padding: "2px 8px",
                        }}
                      >
                        {cur} {amt.toFixed(2)}
                      </Tag>
                    ))}
                  </Space>
                )
              }
            >
              <Space
                direction="vertical"
                size="middle"
                style={{ width: "100%" }}
              >
                {a.orderId && (
                  <div
                    style={{
                      background: "#f6ffed",
                      border: "1px solid #b7eb8f",
                      padding: "8px 12px",
                      borderRadius: 6,
                    }}
                  >
                    <Text type="success" style={{ fontSize: 13 }}>
                      <CheckCircleOutlined style={{ marginRight: 6 }} /> Order
                      ID: <strong>{a.orderId}</strong>
                    </Text>
                  </div>
                )}

                {a.error && (
                  <div
                    style={{
                      background: "#fff2f0",
                      border: "1px solid #ffccc7",
                      padding: "8px 12px",
                      borderRadius: 6,
                    }}
                  >
                    <Text type="danger" style={{ fontSize: 13 }}>
                      <ExclamationCircleOutlined style={{ marginRight: 6 }} />{" "}
                      {a.error}
                    </Text>
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 16,
                  }}
                >
                  <div>
                    <Text
                      type="secondary"
                      style={{
                        display: "block",
                        marginBottom: 6,
                        fontSize: 12,
                      }}
                    >
                      SELECT PAYMENT METHOD
                    </Text>
                    <Radio.Group
                      value={paymentMethods[a.groupType] ?? a.paymentMethod}
                      onChange={(e) =>
                        handlePaymentChange(a.groupType, e.target.value)
                      }
                      disabled={running || a.state === "paid"}
                      optionType="button"
                      buttonStyle="solid"
                    >
                      <Radio.Button value="card">
                        <CreditCardOutlined style={{ marginRight: 4 }} /> Card
                      </Radio.Button>
                      <Radio.Button value="pay_at_clinic">
                        <ShopOutlined style={{ marginRight: 4 }} /> Pay at
                        clinic
                      </Radio.Button>
                    </Radio.Group>
                  </div>

                  <Button
                    type="primary"
                    onClick={() => checkoutOne(a.groupType)}
                    disabled={
                      running ||
                      a.state === "blocked" ||
                      a.state === "paid" ||
                      a.state === "submitting"
                    }
                    loading={a.state === "submitting"}
                    style={{ borderRadius: 8, height: 38, paddingInline: 20 }}
                  >
                    {a.state === "paid"
                      ? "Paid"
                      : `Checkout ${a.groupType} group`}
                  </Button>
                </div>
              </Space>
            </Card>
          );
        })}
      </div>

      <div style={{ marginTop: 24, textAlign: "right" }}>
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => {
            clearPersisted();
            message.info("Cleared persisted attempts");
          }}
          style={{ fontSize: 13 }}
        >
          Clear saved attempts history
        </Button>
      </div>
    </div>
  );
}

function stateColor(s: CheckoutState): string {
  switch (s) {
    case "paid":
      return "success";
    case "failed":
    case "needs_attention":
      return "error";
    case "pending":
      return "processing";
    case "submitting":
      return "warning";
    case "blocked":
      return "default";
    default:
      return "default";
  }
}
