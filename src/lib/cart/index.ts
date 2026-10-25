import type { Cart, CartGroup, CartLine, Product } from "@/types/cart";

export function isEmptyProduct(p: Product | null | undefined): boolean {
  return !p || !p.id || !p.title;
}

export function isUnavailableLine(line: CartLine): boolean {
  return isEmptyProduct(line.product);
}

export function lineUnitPrice(line: CartLine): number | null {
  const p = line.product;
  if (isEmptyProduct(p)) return null;
  // wellness selected option
  if (p!.wellnessPricing && p!.wellnessPricing.length > 0) {
    const selected = line.wellnessPricingId
      ? p!.wellnessPricing.find((o) => o.id === line.wellnessPricingId)
      : undefined;
    if (!selected) return null; // unpriced
    return selected.amount_after_service_charge;
  }
  if (p!.price === null || p!.price === undefined || Number.isNaN(p!.price)) return null;
  if (p!.priceUnknown) return null;
  return p!.price;
}

export function isLinePriced(line: CartLine): boolean {
  return lineUnitPrice(line) !== null;
}

export function lineAmount(line: CartLine): number | null {
  const up = lineUnitPrice(line);
  if (up === null) return null;
  return up * (line.quantity || 0);
}

export function isLineCheckoutEligible(line: CartLine): boolean {
  if (isUnavailableLine(line)) return false;
  if (lineUnitPrice(line) === null) return false;
  if (!line.quantity || line.quantity <= 0) return false;
  return true;
}

export function isGroupCheckoutEligible(group: CartGroup): boolean {
  if (!group.items || group.items.length === 0) return false;
  return group.items.every(isLineCheckoutEligible);
}

export function normalizeLine(line: Partial<CartLine> & { id?: string; productId?: string }): CartLine {
  const qty = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 0;
  return {
    id: line.id ?? "",
    productId: line.productId ?? line.product?.id ?? "",
    quantity: qty > 0 ? Math.floor(qty) : 0,
    wellnessPricingId: line.wellnessPricingId ?? null,
    product: (line.product ?? null) as Product | null,
    unavailable: isEmptyProduct(line.product ?? null),
  };
}

export function normalizeGroup(g: Partial<CartGroup>): CartGroup {
  const items = (g.items ?? []).map((it) => normalizeLine(it as CartLine));
  // recompute itemCount as sum of quantities (per API semantics)
  const itemCount = items.reduce((s, it) => s + (it.quantity || 0), 0);
  const subtotals: Record<string, number> = {};
  let unpriced = 0;
  for (const it of items) {
    const p = it.product;
    if (isEmptyProduct(p)) {
      unpriced += 1;
      continue;
    }
    const up = lineUnitPrice(it);
    if (up === null) {
      unpriced += 1;
      continue;
    }
    const cur = p!.currency;
    subtotals[cur] = (subtotals[cur] ?? 0) + up * (it.quantity || 0);
  }
  return {
    type: g.type ?? "unknown",
    itemCount,
    unpricedItems: typeof g.unpricedItems === "number" ? g.unpricedItems : unpriced,
    // Prefer API-provided subtotals when present (they already account for selected wellness durations etc.)
    subtotals: g.subtotals && Object.keys(g.subtotals).length ? g.subtotals : subtotals,
    items,
  };
}

export function normalizeCart(c: Partial<Cart> | null | undefined): Cart {
  const groups = (c?.groups ?? []).map(normalizeGroup);
  const totalItems = groups.reduce((s, g) => s + (g.itemCount || 0), 0);
  return { groups, totalItems };
}

// Recompute derived fields after local mutation (keep subtotals fresh)
export function recomputeGroup(group: CartGroup): CartGroup {
  return normalizeGroup(group);
}

export function recomputeCart(cart: Cart): Cart {
  const groups = cart.groups.map(recomputeGroup);
  const totalItems = groups.reduce((s, g) => s + g.itemCount, 0);
  return { groups, totalItems };
}

export function findLine(cart: Cart, lineId: string): { group: CartGroup; line: CartLine } | null {
  for (const g of cart.groups) {
    const line = g.items.find((i) => i.id === lineId);
    if (line) return { group: g, line };
  }
  return null;
}

export function removeLine(cart: Cart, lineId: string): Cart {
  const groups = cart.groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.id !== lineId) }))
    .filter((g) => g.items.length > 0);
  return recomputeCart({ groups, totalItems: 0 });
}

export function updateLineQuantity(cart: Cart, lineId: string, quantity: number): Cart {
  const groups = cart.groups.map((g) => ({
    ...g,
    items: g.items.map((i) => (i.id === lineId ? { ...i, quantity } : i)),
  }));
  return recomputeCart({ groups, totalItems: 0 });
}

export function updateLineWellnessOption(cart: Cart, lineId: string, optionId: string | null): Cart {
  const groups = cart.groups.map((g) => ({
    ...g,
    items: g.items.map((i) => (i.id === lineId ? { ...i, wellnessPricingId: optionId } : i)),
  }));
  return recomputeCart({ groups, totalItems: 0 });
}

export function currenciesOfGroup(group: CartGroup): string[] {
  const set = new Set<string>();
  for (const it of group.items) {
    const p = it.product;
    if (!isEmptyProduct(p)) set.add(p!.currency);
  }
  return Array.from(set);
}

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}