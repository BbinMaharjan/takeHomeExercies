"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Radio, Space, Tag, Typography, message } from "antd";
import { normalizeCart, isGroupCheckoutEligible } from "@/lib/cart";
import type { CartGroup, GroupCheckoutAttempt, CheckoutState } from "@/types/cart";
import { ApiError } from "@/types/cart";
import { fetchCart, checkout, fetchOrder } from "@/lib/api/cart";
import {
  makeAttempt,
  executeGroupCheckout,
  runAllGroups,
} from "@/lib/checkout/orchestration";
import { readPersisted, persistAttempts, clearPersisted } from "@/lib/checkout/persistence";
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
  const [paymentMethods, setPaymentMethods] = useState<Record<string, "card" | "pay_at_clinic">>({});
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
          if (a.orderId && (a.state === "pending" || a.state === "needs_attention")) {
            try {
              const o = await fetchOrder(a.orderId);
              const newState: CheckoutState =
                o.status === "paid" ? "paid" : o.status === "failed" ? "failed" : "pending";
              return { ...a, status: o.status, state: newState };
            } catch {
              return a;
            }
          }
          return a;
        })
      );
      setAttempts(updated);
      persistAttempts(updated);
    })();
  }, []);

  const persist = (atts: GroupCheckoutAttempt[]) => {
    setAttempts(atts);
    persistAttempts(atts);
  };

  const handlePaymentChange = (groupType: string, value: "card" | "pay_at_clinic") => {
    setPaymentMethods((prev) => ({ ...prev, [groupType]: value }));
    setAttempts((prev) =>
      prev.map((a) =>
        a.groupType === groupType ? { ...a, paymentMethod: value } : a
      )
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
      const updated = await executeGroupCheckout(attempt, async (req) => {
        const res = await checkout({ ...req, items: req.items.map((it) => ({ ...it, unitPrice: null })) });
        return res;
      }, fetchOrder);
      const next = [...attempts];
      next[idx] = updated;
      persist(next);
      if (updated.state === "paid") message.success(`${groupType}: paid`);
      else if (updated.state === "failed") message.error(`${groupType}: failed`);
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "Checkout error");
    } finally {
      setRunning(false);
    }
  };

  const checkoutAll = async () => {
    setRunning(true);
    try {
      const eligible = attempts.filter((a) => a.state !== "paid" && a.state !== "blocked");
      const updatedAll = await runAllGroups(
        eligible,
        async (req) => checkout({ ...req, items: req.items.map((it) => ({ ...it, unitPrice: null })) }),
        fetchOrder,
        (progress) => {
          // merge progress back into full attempts list
          setAttempts((prev) => {
            const map = new Map(progress.map((p) => [p.groupType, p]));
            const next = prev.map((a) => map.get(a.groupType) ?? a);
            persistAttempts(next);
            return next;
          });
        }
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
      const failed = attempts.filter((a) => a.state === "failed" || a.state === "needs_attention");
      // reuse same idempotency keys (already on attempts)
      const updatedAll = await runAllGroups(
        failed.map((a) => ({ ...a, state: "ready" as const })),
        async (req) => checkout({ ...req, items: req.items.map((it) => ({ ...it, unitPrice: null })) }),
        fetchOrder,
        (progress) => {
          setAttempts((prev) => {
            const map = new Map(progress.map((p) => [p.groupType, p]));
            const next = prev.map((a) => map.get(a.groupType) ?? a);
            persistAttempts(next);
            return next;
          });
        }
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

  if (isLoading) return <div style={{ padding: 24 }}>Loading checkout...</div>;

  const c = cart ? normalizeCart(cart) : null;

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <Title level={2}>Checkout</Title>
      <Paragraph>Each group is checked out as a separate order. Groups may use different payment methods.</Paragraph>
      <Link href="/cart"><Button style={{ marginBottom: 12 }}>Back to cart</Button></Link>

      {attempts.map((a) => {
        const group = c?.groups.find((g) => g.type === a.groupType);
        return (
          <Card key={a.groupType} style={{ marginBottom: 16 }} title={`${a.groupType} group`}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <div>
                State: <Tag color={stateColor(a.state)}>{a.state}</Tag>
                {a.orderId && <Text> Order: {a.orderId}</Text>}
                {a.error && <div><Text type="danger">{a.error}</Text></div>}
              </div>
              {group && (
                <div>
                  {Object.entries(group.subtotals).map(([cur, amt]) => (
                    <Tag key={cur}>{cur} {amt.toFixed(2)}</Tag>
                  ))}
                </div>
              )}
              <Radio.Group
                value={paymentMethods[a.groupType] ?? a.paymentMethod}
                onChange={(e) => handlePaymentChange(a.groupType, e.target.value)}
                disabled={running || a.state === "paid"}
              >
                <Radio value="card">Card</Radio>
                <Radio value="pay_at_clinic">Pay at clinic</Radio>
              </Radio.Group>
              <Button
                type="primary"
                onClick={() => checkoutOne(a.groupType)}
                disabled={running || a.state === "blocked" || a.state === "paid" || a.state === "submitting"}
                loading={a.state === "submitting"}
              >
                Checkout this group
              </Button>
            </Space>
          </Card>
        );
      })}

      <Space style={{ marginTop: 12 }}>
        <Button type="primary" onClick={checkoutAll} disabled={running} loading={running}>
          Checkout all eligible groups
        </Button>
        <Button onClick={retryFailed} disabled={running}>
          Retry failed groups
        </Button>
        <Button onClick={() => { clearPersisted(); message.info("Cleared persisted attempts"); }}>
          Clear saved attempts
        </Button>
      </Space>
    </div>
  );
}

function stateColor(s: CheckoutState): string {
  switch (s) {
    case "paid":
      return "green";
    case "failed":
    case "needs_attention":
      return "red";
    case "pending":
      return "blue";
    case "submitting":
      return "orange";
    case "blocked":
      return "default";
    default:
      return "default";
  }
}

