// Domain types for Task 2: multi-provider cart and split checkout.

export type Currency = "THB" | "NPR" | "INR" | string;

export interface WellnessPricingOption {
  id: string;
  durationInMinutes: number;
  amount_after_service_charge: number;
}

export interface Product {
  id: string;
  title: string;
  type: string;
  currency: Currency;
  providerId: number | string | null;
  providerName: string;
  price: number | null;
  priceUnknown?: boolean;
  wellnessPricing?: WellnessPricingOption[];
  status?: boolean;
}

export interface CartLine {
  id: string;
  productId: string;
  quantity: number;
  wellnessPricingId?: string | null;
  product: Product | null | undefined;
  // derived at runtime
  unavailable?: boolean;
}

export interface CartGroup {
  type: string;
  itemCount: number; // sum of quantities
  unpricedItems: number;
  subtotals: Record<string, number>; // currency -> amount
  items: CartLine[];
}

export interface Cart {
  groups: CartGroup[];
  totalItems: number; // sum of quantities across groups
}

export interface GuestCartItem {
  productId: string;
  quantity: number;
  wellnessPricingId?: string;
}

// merge
export type MergeChangeType = "added" | "combined" | "skipped" | "updated_option";

export interface MergeChange {
  type: MergeChangeType;
  productId: string;
  title?: string;
  quantityBefore?: number;
  quantityAfter?: number;
  reason?: string;
  wellnessPricingId?: string | null;
}

export interface MergeResult {
  cart: Cart;
  changes: MergeChange[];
}

// checkout
export type PaymentMethod = "card" | "pay_at_clinic";
export type OrderStatus = "pending" | "paid" | "failed";

export interface CheckoutItem {
  lineId: string;
  productId: string;
  quantity: number;
  wellnessPricingId?: string | null;
  unitPrice: number | null;
  currency: Currency;
}

export interface CheckoutRequest {
  groupType: string;
  items: CheckoutItem[];
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
}

export interface CheckoutResult {
  orderId: string;
  status: OrderStatus;
}

export type CheckoutState =
  | "ready"
  | "blocked"
  | "submitting"
  | "pending"
  | "paid"
  | "failed"
  | "needs_attention";

export interface GroupCheckoutAttempt {
  groupType: string;
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
  items: CheckoutItem[];
  orderId?: string;
  status?: OrderStatus;
  state: CheckoutState;
  error?: string;
  attemptId: string; // logical attempt id
}

export interface PersistedCheckoutState {
  version: 1;
  attempts: GroupCheckoutAttempt[];
  createdAt: number;
}

// API errors
export class ApiError extends Error {
  status: number;
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}