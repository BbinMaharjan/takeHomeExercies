"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Modal,
  Skeleton,
  Typography,
  Tag,
  message,
  Select,
  Space,
  Divider,
} from "antd";
import {
  DeleteOutlined,
  MinusOutlined,
  PlusOutlined,
  ShoppingCartOutlined,
  ArrowRightOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import {
  normalizeCart,
  findLine,
  updateLineQuantity,
  lineUnitPrice,
  isGroupCheckoutEligible,
  formatMoney,
} from "@/lib/cart";
import type { Cart, CartGroup, CartLine, MergeChange } from "@/types/cart";
import { ApiError } from "@/types/cart";
import {
  fetchCart,
  patchQuantity,
  patchWellness,
  deleteLine,
  mergeCart,
} from "@/lib/api/cart";
import Link from "next/link";

const { Title, Text, Paragraph } = Typography;

export default function CartPage() {
  const queryClient = useQueryClient();
  const {
    data: cart,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["cart"],
    queryFn: fetchCart,
  });

  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [mergeSummary, setMergeSummary] = useState<MergeChange[] | null>(null);
  const [merging, setMerging] = useState(false);

  const queues = useRef(new Map<string, Promise<void>>());
  const latestSeq = useRef(new Map<string, number>());

  const changeQuantity = useCallback(
    (lineId: string, delta: number) => {
      const current = queryClient.getQueryData<Cart>(["cart"]);
      if (!current) return;
      const found = findLine(current, lineId);
      if (!found) return;
      const seq = (latestSeq.current.get(lineId) ?? 0) + 1;
      latestSeq.current.set(lineId, seq);
      const prevQty = found.line.quantity;
      const newQty = Math.max(1, Math.min(99, prevQty + delta));
      if (newQty === prevQty) return;
      queryClient.setQueryData<Cart>(
        ["cart"],
        updateLineQuantity(current, lineId, newQty),
      );

      const prevPromise = queues.current.get(lineId) ?? Promise.resolve();
      const job = prevPromise.then(async () => {
        try {
          const serverCart = await patchQuantity(lineId, newQty);
          if (latestSeq.current.get(lineId) === seq) {
            queryClient.setQueryData<Cart>(["cart"], normalizeCart(serverCart));
          }
        } catch (e) {
          if (latestSeq.current.get(lineId) === seq) {
            queryClient.setQueryData<Cart>(["cart"], (old: Cart | undefined) =>
              old ? updateLineQuantity(old, lineId, prevQty) : old,
            );
          }
          const msg =
            e instanceof ApiError ? e.message : "Failed to update quantity";
          message.error(msg);
        }
      });
      queues.current.set(lineId, job);
    },
    [queryClient],
  );

  const handleWellnessChange = useCallback(
    async (lineId: string, value: string | null) => {
      try {
        const serverCart = await patchWellness(lineId, value);
        queryClient.setQueryData<Cart>(["cart"], normalizeCart(serverCart));
      } catch (e) {
        const msg =
          e instanceof ApiError ? e.message : "Failed to update option";
        message.error(msg);
        await refetch();
      }
    },
    [queryClient, refetch],
  );

  const handleRemove = useCallback(
    async (lineId: string) => {
      setRemoving((s) => new Set(s).add(lineId));
      try {
        await deleteLine(lineId);
        await refetch();
        message.success("Item removed");
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Failed to remove item";
        message.error(msg);
      } finally {
        setRemoving((s) => {
          const n = new Set(s);
          n.delete(lineId);
          return n;
        });
      }
    },
    [refetch],
  );

  const handleMerge = useCallback(async () => {
    setMerging(true);
    try {
      const guestRes = await fetch("/api/cart/guest");
      const guestData = await guestRes.json();
      const result = await mergeCart(guestData.items);
      queryClient.setQueryData<Cart>(["cart"], normalizeCart(result.cart));
      setMergeSummary(result.changes);
      message.success("Guest cart merged");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Merge failed";
      message.error(msg);
    } finally {
      setMerging(false);
    }
  }, [queryClient]);

  if (isLoading) {
    return (
      <div style={{ padding: "48px 24px", maxWidth: 900, margin: "0 auto" }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        style={{ padding: "48px 24px", maxWidth: 900, margin: "0 auto" }}
        role="alert"
      >
        <Card style={{ borderRadius: 12, textAlign: "center", padding: 32 }}>
          <ExclamationCircleOutlined
            style={{ fontSize: 48, color: "#ff4d4f", marginBottom: 16 }}
          />
          <Title level={4}>Could not load cart</Title>
          <Paragraph type="secondary">{(error as Error)?.message}</Paragraph>
          <Button type="primary" onClick={() => refetch()} loading={isFetching}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  const c = cart ? normalizeCart(cart) : null;
  if (!c || c.groups.length === 0) {
    return (
      <div
        style={{
          padding: "80px 24px",
          maxWidth: 700,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <Card
          style={{
            borderRadius: 16,
            padding: "40px 24px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "#f5f5f5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
            }}
          >
            <ShoppingCartOutlined style={{ fontSize: 36, color: "#bfbfbf" }} />
          </div>
          <Title level={3} style={{ marginBottom: 8 }}>
            Your cart is empty
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 24 }}>
            Looks like you haven't added any services to your cart yet. Browse
            our services to get started.
          </Paragraph>
          <Link href="/services">
            <Button
              type="primary"
              size="large"
              style={{ paddingInline: 32, borderRadius: 8 }}
            >
              Browse services
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const totalItems = c.totalItems;

  return (
    <div
      style={{ padding: "32px 24px", maxWidth: 1000, margin: "0 auto" }}
      aria-live="polite"
    >
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
          <Title level={2} style={{ margin: 0 }}>
            Cart
          </Title>
          <Text type="secondary">
            {totalItems} {totalItems === 1 ? "item" : "items"} in total
          </Text>
        </div>

        <Space size="middle">
          <Button
            icon={<SyncOutlined />}
            onClick={handleMerge}
            loading={merging}
            disabled={merging}
            style={{ borderRadius: 8, height: 40 }}
          >
            Merge guest cart
          </Button>
          <Link href="/checkout">
            <Button
              type="primary"
              size="large"
              icon={<ArrowRightOutlined />}
              iconPosition="end"
              style={{ borderRadius: 8, height: 40, paddingInline: 24 }}
            >
              Checkout
            </Button>
          </Link>
        </Space>
      </div>

      <Divider style={{ margin: "12px 0 24px" }} />

      {/* Cart Groups */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {c.groups.map((group) => (
          <CartGroupCard
            key={group.type}
            group={group}
            removing={removing}
            onQuantityChange={changeQuantity}
            onWellnessChange={handleWellnessChange}
            onRemove={handleRemove}
          />
        ))}
      </div>

      <MergeSummaryModal
        changes={mergeSummary}
        onClose={() => setMergeSummary(null)}
      />
    </div>
  );
}

function CartGroupCard({
  group,
  removing,
  onQuantityChange,
  onWellnessChange,
  onRemove,
}: {
  group: CartGroup;
  removing: Set<string>;
  onQuantityChange: (lineId: string, delta: number) => void;
  onWellnessChange: (lineId: string, value: string | null) => void;
  onRemove: (lineId: string) => void;
}) {
  const eligible = isGroupCheckoutEligible(group);
  return (
    <Card
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
            {group.type} Group
          </span>
          {eligible ? (
            <Tag color="success" style={{ borderRadius: 12, paddingInline: 8 }}>
              Ready to checkout
            </Tag>
          ) : (
            <Tag color="warning" style={{ borderRadius: 12, paddingInline: 8 }}>
              Blocked
            </Tag>
          )}
        </Space>
      }
    >
      {!eligible && (
        <div
          style={{
            background: "#fffbe6",
            border: "1px solid #ffe58f",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <Text type="warning" style={{ fontSize: 13 }}>
            Resolve unavailable items or select wellness durations before
            checking out.
          </Text>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {group.items.map((line) => (
          <CartLineRow
            key={line.id}
            line={line}
            removing={removing.has(line.id)}
            onQuantityChange={onQuantityChange}
            onWellnessChange={onWellnessChange}
            onRemove={onRemove}
          />
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          borderTop: "1px solid #f0f0f0",
          paddingTop: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <Text type="secondary">Subtotal: </Text>
          {Object.entries(group.subtotals).map(([cur, amt]) => (
            <Tag
              key={cur}
              style={{ fontWeight: 600, fontSize: 14, padding: "2px 8px" }}
            >
              {formatMoney(amt, cur)}
            </Tag>
          ))}
          {Object.keys(group.subtotals).length === 0 && (
            <Text type="secondary">No priced items</Text>
          )}
        </div>

        {group.unpricedItems > 0 && (
          <Text type="danger" style={{ fontSize: 13 }}>
            {group.unpricedItems} unpriced item(s)
          </Text>
        )}
      </div>
    </Card>
  );
}

function CartLineRow({
  line,
  removing,
  onQuantityChange,
  onWellnessChange,
  onRemove,
}: {
  line: CartLine;
  removing: boolean;
  onQuantityChange: (lineId: string, delta: number) => void;
  onWellnessChange: (lineId: string, value: string | null) => void;
  onRemove: (lineId: string) => void;
}) {
  const unavailable = !line.product || !line.product.id;
  const unitPrice = lineUnitPrice(line);
  const amount = unitPrice !== null ? unitPrice * line.quantity : null;
  const wellnessOptions = line.product?.wellnessPricing;

  const focusRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
        padding: "16px 0",
        borderBottom: "1px solid #f5f5f5",
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        {unavailable ? (
          <div>
            <Text strong type="danger">
              Unavailable item
            </Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                This service was removed by the provider.
              </Text>
            </div>
          </div>
        ) : (
          <div>
            <Text
              strong
              style={{ fontSize: 15, display: "block", marginBottom: 2 }}
            >
              {line.product!.title}
            </Text>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {line.product!.providerName} ·{" "}
              <span style={{ textTransform: "uppercase" }}>
                {line.product!.currency}
              </span>
            </Text>
          </div>
        )}
      </div>

      {wellnessOptions && wellnessOptions.length > 0 && !unavailable && (
        <Select
          placeholder="Select duration"
          value={line.wellnessPricingId ?? undefined}
          onChange={(v) => onWellnessChange(line.id, v ?? null)}
          style={{ width: 190 }}
          options={wellnessOptions.map((o) => ({
            value: o.id,
            label: `${o.durationInMinutes} min — ${formatMoney(o.amount_after_service_charge, line.product!.currency)}`,
          }))}
        />
      )}

      {/* Quantity Stepper */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: "1px solid #d9d9d9",
          borderRadius: 6,
          background: "#fafafa",
          padding: 2,
        }}
      >
        <Button
          type="text"
          icon={<MinusOutlined style={{ fontSize: 11 }} />}
          size="small"
          onClick={() => onQuantityChange(line.id, -1)}
          disabled={removing || line.quantity <= 1}
          aria-label={`Decrease quantity for ${line.product?.title ?? "item"}`}
          style={{ width: 28, height: 28 }}
        />
        <span
          style={{
            minWidth: 32,
            textAlign: "center",
            fontWeight: 500,
            fontSize: 14,
          }}
          aria-live="polite"
        >
          {line.quantity}
        </span>
        <Button
          type="text"
          icon={<PlusOutlined style={{ fontSize: 11 }} />}
          size="small"
          onClick={() => onQuantityChange(line.id, 1)}
          disabled={removing}
          aria-label={`Increase quantity for ${line.product?.title ?? "item"}`}
          style={{ width: 28, height: 28 }}
        />
      </div>

      <div style={{ minWidth: 100, textAlign: "right" }}>
        {amount !== null ? (
          <Text strong style={{ fontSize: 15 }}>
            {formatMoney(amount, line.product!.currency)}
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 13 }}>
            Price unknown
          </Text>
        )}
      </div>

      <Button
        ref={focusRef}
        type="text"
        danger
        icon={<DeleteOutlined />}
        size="middle"
        loading={removing}
        disabled={removing}
        onClick={() => onRemove(line.id)}
        aria-label={`Remove ${line.product?.title ?? "item"}`}
        style={{ color: "#ff4d4f" }}
      />
    </div>
  );
}

function MergeSummaryModal({
  changes,
  onClose,
}: {
  changes: MergeChange[] | null;
  onClose: () => void;
}) {
  if (!changes) return null;
  return (
    <Modal
      open
      title="Guest Cart Merge Summary"
      onCancel={onClose}
      onOk={onClose}
      okText="Got it"
      centered
      style={{ borderRadius: 12 }}
    >
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Here is what happened when merging your guest cart:
      </Paragraph>
      <ul
        style={{
          paddingLeft: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {changes.map((c, i) => (
          <li key={i}>
            <Text strong>{c.type}</Text> — {c.title ?? c.productId}
            {c.quantityBefore !== undefined &&
              c.quantityAfter !== undefined && (
                <Text type="secondary">
                  {" "}
                  ({c.quantityBefore} → {c.quantityAfter})
                </Text>
              )}
            {c.reason && (
              <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                Reason: {c.reason}
              </Text>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
