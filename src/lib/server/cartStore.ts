import { readFileSync } from "node:fs";
import path from "node:path";
import type { Cart, CartLine, CartGroup, Product, CheckoutResult, OrderStatus } from "@/types/cart";
import { normalizeCart, removeLine, updateLineQuantity, updateLineWellnessOption } from "@/lib/cart";
import { mergeGuestCart } from "@/lib/cart/merge";

// Load fixture at module load (server only)
function loadFixture(): { catalog: Product[]; serverCart: Cart; guestCart: unknown } {
  const p = path.join(process.cwd(), "src", "data", "task2-cart.json");
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw);
}

const fixture = loadFixture();

let cartState: Cart = normalizeCart(fixture.serverCart as Cart);
const catalog: Product[] = fixture.catalog as Product[];
const guestCartRaw = fixture.guestCart;

// idempotency store: key -> { payloadHash, result }
interface IdempotencyEntry {
  payloadHash: string;
  result: CheckoutResult;
}
const idempotencyStore = new Map<string, IdempotencyEntry>();

// orders store
interface OrderRecord {
  orderId: string;
  status: OrderStatus;
  createdAt: number;
}
const orders = new Map<string, OrderRecord>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomLatency() {
  return 150 + Math.floor(Math.random() * 51);
}

function shouldFail(req: Request): { fail: boolean; status?: number } {
  const url = new URL(req.url);
  const sf = url.searchParams.get("simulateFailure");
  if (sf === "true") return { fail: true, status: 500 };
  const failStatus = url.searchParams.get("failStatus");
  if (failStatus) return { fail: true, status: Number(failStatus) };
  return { fail: false };
}

export function getCart(): Cart {
  return JSON.parse(JSON.stringify(cartState));
}

export function getCatalog(): Product[] {
  return JSON.parse(JSON.stringify(catalog));
}

export function getGuestCartRaw() {
  return guestCartRaw;
}

export async function handleGetCart(req: Request): Promise<Response> {
  await delay(randomLatency());
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to load cart");
  return Response.json({ cart: getCart() });
}

export async function handlePatchQuantity(req: Request, lineId: string, body: { quantity?: number }): Promise<Response> {
  await delay(randomLatency());
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to update quantity");

  const line = findLine(cartState, lineId);
  if (!line) return jsonError(404, "Line item not found");

  const q = body?.quantity;
  if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > 99) {
    return jsonError(409, "Invalid quantity");
  }
  // simulate conflict: quantity too high for some items
  if (q > 10) {
    return jsonError(409, "Quantity exceeds available stock");
  }

  cartState = updateLineQuantity(cartState, lineId, q);
  return Response.json({ cart: getCart() });
}

export async function handlePatchWellness(req: Request, lineId: string, body: { wellnessPricingId?: string }): Promise<Response> {
  await delay(randomLatency());
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to update wellness option");

  const line = findLine(cartState, lineId);
  if (!line) return jsonError(404, "Line item not found");

  const optionId = body?.wellnessPricingId ?? null;
  // validate option belongs to product
  const product = line.line.product;
  if (product?.wellnessPricing?.length) {
    if (optionId && !product.wellnessPricing.find((o) => o.id === optionId)) {
      return jsonError(409, "Invalid wellness pricing option");
    }
  }
  cartState = updateLineWellnessOption(cartState, lineId, optionId);
  return Response.json({ cart: getCart() });
}

export async function handleDeleteLine(req: Request, lineId: string): Promise<Response> {
  await delay(randomLatency());
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to remove item");
  cartState = removeLine(cartState, lineId);
  return new Response(null, { status: 204 });
}

export async function handleMerge(req: Request, body: { items?: unknown }): Promise<Response> {
  await delay(randomLatency());
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to merge cart");

  const items = Array.isArray(body?.items) ? (body.items as { productId: string; quantity: number; wellnessPricingId?: string }[]) : [];
  const result = mergeGuestCart({ serverCart: cartState, guestItems: items as never, catalog });
  cartState = result.cart;
  return Response.json({ cart: getCart(), changes: result.changes });
}

function hashPayload(obj: unknown): string {
  return JSON.stringify(obj);
}

export async function handleCheckout(req: Request, body: {
  groupType: string;
  items: unknown;
  paymentMethod: string;
  idempotencyKey: string;
}): Promise<Response> {
  await delay(randomLatency());
  const f = shouldFail(req);
  // allow simulateFailure via query to force 500
  if (f.fail) {
    // still honor idempotency? If fail before processing, no order created
    return jsonError(f.status ?? 500, "Checkout failed");
  }

  const { groupType, items, paymentMethod, idempotencyKey } = body ?? ({} as never);
  if (!groupType || !Array.isArray(items) || !idempotencyKey) {
    return jsonError(400, "Invalid checkout payload");
  }
  if (paymentMethod !== "card" && paymentMethod !== "pay_at_clinic") {
    return jsonError(400, "Invalid payment method");
  }

  const payloadHash = hashPayload({ groupType, items, paymentMethod });

  // idempotency check
  const existing = idempotencyStore.get(idempotencyKey);
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      return jsonError(409, "Idempotency key reused with conflicting payload");
    }
    // return same order
    const order = orders.get(existing.result.orderId);
    const status = order?.status ?? existing.result.status;
    return Response.json({ orderId: existing.result.orderId, status }, { status: 201 });
  }

  // Simulate payment outcomes based on query params or item content
  const url = new URL(req.url);
  const outcome = url.searchParams.get("checkoutOutcome"); // paid|failed|pending
  // determine status
  let status: OrderStatus = "paid";
  if (outcome === "failed") status = "failed";
  else if (outcome === "pending") status = "pending";
  else if (outcome === "payment_failed") status = "failed";

  // 402 simulation: if paymentMethod card and query paymentDecline=true
  if (url.searchParams.get("paymentDecline") === "true") {
    return jsonError(402, "Payment declined");
  }

  const orderId = `order-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  orders.set(orderId, { orderId, status, createdAt: Date.now() });

  const result: CheckoutResult = { orderId, status };
  idempotencyStore.set(idempotencyKey, { payloadHash, result });

  // if status failed, maybe return 402? Spec says 402 payment failure. We'll return 201 with failed status per "Do not treat 201 as paid unless status confirms". 
  // But also support 402 via paymentDecline above. For checkoutOutcome=failed, return 201 failed status.
  return Response.json({ orderId, status }, { status: 201 });
}

export async function handleGetOrder(req: Request, orderId: string): Promise<Response> {
  await delay(randomLatency());
  const f = shouldFail(req);
  if (f.fail) return jsonError(f.status ?? 500, "Failed to load order");
  const order = orders.get(orderId);
  if (!order) return jsonError(404, "Order not found");
  // randomly? no; status stable. But allow status progression? keep stable.
  return Response.json({ orderId: order.orderId, status: order.status });
}

function findLine(cart: Cart, lineId: string): { group: CartGroup; line: CartLine } | null {
  for (const g of cart.groups) {
    const line = g.items.find((i) => i.id === lineId);
    if (line) return { group: g, line };
  }
  return null;
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export function resetStore() {
  cartState = normalizeCart(fixture.serverCart as Cart);
  idempotencyStore.clear();
  orders.clear();
}

export function getIdempotencyStore() {
  return idempotencyStore;
}