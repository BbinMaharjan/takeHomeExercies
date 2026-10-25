import type { Cart, MergeChange, CheckoutRequest, CheckoutResult } from "@/types/cart";
import { ApiError } from "@/types/cart";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error || res.statusText, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function fetchCart(): Promise<Cart> {
  const data = await request<{ cart: Cart }>("/api/cart");
  return data.cart;
}

export async function patchQuantity(lineId: string, quantity: number): Promise<Cart> {
  const data = await request<{ cart: Cart }>(`/api/cart/items/${lineId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  });
  return data.cart;
}

export async function patchWellness(lineId: string, wellnessPricingId: string | null): Promise<Cart> {
  const data = await request<{ cart: Cart }>(`/api/cart/items/${lineId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wellnessPricingId }),
  });
  return data.cart;
}

export async function deleteLine(lineId: string): Promise<void> {
  await request<void>(`/api/cart/items/${lineId}`, { method: "DELETE" });
}

export async function mergeCart(items: { productId: string; quantity: number; wellnessPricingId?: string }[]): Promise<{ cart: Cart; changes: MergeChange[] }> {
  return request<{ cart: Cart; changes: MergeChange[] }>("/api/cart/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

export async function checkout(req: CheckoutRequest): Promise<CheckoutResult> {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error || res.statusText, body);
  }
  return res.json() as Promise<CheckoutResult>;
}

export async function fetchOrder(orderId: string): Promise<{ orderId: string; status: "pending" | "paid" | "failed" }> {
  return request<{ orderId: string; status: "pending" | "paid" | "failed" }>(`/api/orders/${orderId}`);
}