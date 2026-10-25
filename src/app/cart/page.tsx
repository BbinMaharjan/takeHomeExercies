"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Modal, Skeleton, Typography, Tag, message, Select } from "antd";
import {
  DeleteOutlined,
  MinusOutlined,
  PlusOutlined,
  ShoppingCartOutlined,
} from "@ant-design/icons";
import { normalizeCart, findLine, updateLineQuantity, lineUnitPrice, isGroupCheckoutEligible, formatMoney } from "@/lib/cart";
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
  const { data: cart, isLoading, isError, error, refetch, isFetching } = useQuery({
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
      queryClient.setQueryData<Cart>(["cart"], updateLineQuantity(current, lineId, newQty));

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
              old ? updateLineQuantity(old, lineId, prevQty) : old
            );
          }
          const msg = e instanceof ApiError ? e.message : "Failed to update quantity";
          message.error(msg);
        }
      });
      queues.current.set(lineId, job);
    },
    [queryClient]
  );

  const handleWellnessChange = useCallback(
    async (lineId: string, value: string | null) => {
      try {
        const serverCart = await patchWellness(lineId, value);
        queryClient.setQueryData<Cart>(["cart"], normalizeCart(serverCart));
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Failed to update option";
        message.error(msg);
        await refetch();
      }
    },
    [queryClient, refetch]
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
    [refetch]
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
      <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }} role="alert">
        <Card>
          <Title level={4}>Could not load cart</Title>
          <Paragraph>{(error as Error)?.message}</Paragraph>
          <Button onClick={() => refetch()} loading={isFetching}>Retry</Button>
        </Card>
      </div>
    );
  }

  const c = cart ? normalizeCart(cart) : null;
  if (!c || c.groups.length === 0) {
    return (
      <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
        <Card style={{ textAlign: "center" }}>
          <ShoppingCartOutlined style={{ fontSize: 48, color: "#999" }} />
          <Title level={3}>Your cart is empty</Title>
          <Paragraph>Browse services to add items.</Paragraph>
          <Link href="/services"><Button type="primary">Browse services</Button></Link>
        </Card>
      </div>
    );
  }

  const totalItems = c.totalItems;

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }} aria-live="polite">
      <Title level={2}>Cart</Title>
      <Text type="secondary">Items: {totalItems} (sum of quantities)</Text>
      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <Button onClick={handleMerge} loading={merging} disabled={merging}>
          Merge guest cart
        </Button>
        <Link href="/checkout" style={{ marginLeft: 12 }}>
          <Button type="primary">Checkout</Button>
        </Link>
      </div>

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

      <MergeSummaryModal changes={mergeSummary} onClose={() => setMergeSummary(null)} />
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
    <Card style={{ marginBottom: 16 }} title={<span>{group.type} group</span>}>
      <div style={{ marginBottom: 8 }}>
        {eligible ? <Tag color="green">Ready to checkout</Tag> : <Tag color="orange">Blocked</Tag>}
        {!eligible && (
          <Text type="secondary" style={{ marginLeft: 8 }}>
            Resolve unavailable items or select wellness durations.
          </Text>
        )}
      </div>
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
      <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 8 }}>
        <Text strong>Subtotals (per currency): </Text>
        {Object.entries(group.subtotals).map(([cur, amt]) => (
          <Tag key={cur}>{formatMoney(amt, cur)}</Tag>
        ))}
        {Object.keys(group.subtotals).length === 0 && <Text type="secondary">No priced items</Text>}
        {group.unpricedItems > 0 && (
          <div><Text type="warning">{group.unpricedItems} unpriced item(s)</Text></div>
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
        gap: 12,
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid #f0f0f0",
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        {unavailable ? (
          <div>
            <Text strong type="danger">Unavailable item</Text>
            <div><Text type="secondary">This service was removed by the provider.</Text></div>
          </div>
        ) : (
          <div>
            <Text strong>{line.product!.title}</Text>
            <div><Text type="secondary">{line.product!.providerName} · {line.product!.currency}</Text></div>
          </div>
        )}
      </div>

      {wellnessOptions && wellnessOptions.length > 0 && !unavailable && (
        <Select
          placeholder="Select duration"
          value={line.wellnessPricingId ?? undefined}
          onChange={(v) => onWellnessChange(line.id, v ?? null)}
          style={{ width: 180 }}
          options={wellnessOptions.map((o) => ({
            value: o.id,
            label: `${o.durationInMinutes} min — ${formatMoney(o.amount_after_service_charge, line.product!.currency)}`,
          }))}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Button
          icon={<MinusOutlined />}
          size="small"
          onClick={() => onQuantityChange(line.id, -1)}
          disabled={removing || line.quantity <= 1}
          aria-label={`Decrease quantity for ${line.product?.title ?? "item"}`}
        />
        <span style={{ minWidth: 24, textAlign: "center" }} aria-live="polite">{line.quantity}</span>
        <Button
          icon={<PlusOutlined />}
          size="small"
          onClick={() => onQuantityChange(line.id, 1)}
          disabled={removing}
          aria-label={`Increase quantity for ${line.product?.title ?? "item"}`}
        />
      </div>

      <div style={{ minWidth: 120, textAlign: "right" }}>
        {amount !== null ? (
          <Text strong>{formatMoney(amount, line.product!.currency)}</Text>
        ) : (
          <Text type="secondary">Price unknown</Text>
        )}
      </div>

      <Button
        ref={focusRef}
        danger
        icon={<DeleteOutlined />}
        size="small"
        loading={removing}
        disabled={removing}
        onClick={() => onRemove(line.id)}
        aria-label={`Remove ${line.product?.title ?? "item"}`}
      >
        Remove
      </Button>
    </div>
  );
}

function MergeSummaryModal({ changes, onClose }: { changes: MergeChange[] | null; onClose: () => void }) {
  if (!changes) return null;
  return (
    <Modal open title="Guest cart merge summary" onCancel={onClose} onOk={onClose}>
      <ul>
        {changes.map((c, i) => (
          <li key={i}>
            <strong>{c.type}</strong> — {c.title ?? c.productId}
            {c.quantityBefore !== undefined && c.quantityAfter !== undefined && (
              <span> ({c.quantityBefore} → {c.quantityAfter})</span>
            )}
            {c.reason && <span> — {c.reason}</span>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}