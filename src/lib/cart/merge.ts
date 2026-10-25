import type {
  Cart,
  CartLine,
  GuestCartItem,
  MergeChange,
  MergeResult,
  Product,
} from "@/types/cart";
import { normalizeCart, recomputeCart } from "./index";

export interface CatalogLookup {
  byId: Map<string, Product>;
}

export function buildCatalogLookup(catalog: Product[]): CatalogLookup {
  return { byId: new Map(catalog.map((p) => [p.id, p])) };
}

export interface MergeInput {
  serverCart: Cart;
  guestItems: GuestCartItem[];
  catalog: Product[];
}

export function mergeGuestCart(input: MergeInput): MergeResult {
  const { serverCart, guestItems, catalog } = input;
  const lookup = buildCatalogLookup(catalog);
  const cart: Cart = normalizeCart(JSON.parse(JSON.stringify(serverCart)));
  const changes: MergeChange[] = [];

  for (const g of guestItems) {
    // validate quantity
    if (!g || typeof g.productId !== "string" || !g.productId) {
      changes.push({ type: "skipped", productId: g?.productId ?? "", reason: "invalid product id" });
      continue;
    }
    if (typeof g.quantity !== "number" || !Number.isFinite(g.quantity) || g.quantity <= 0 || !Number.isInteger(g.quantity)) {
      changes.push({ type: "skipped", productId: g.productId, reason: "invalid quantity" });
      continue;
    }

    const product = lookup.byId.get(g.productId);
    if (!product) {
      changes.push({ type: "skipped", productId: g.productId, reason: "product no longer available" });
      continue;
    }

    // validate wellness option if provided
    let wellnessPricingId: string | null = g.wellnessPricingId ?? null;
    if (wellnessPricingId && product.wellnessPricing?.length) {
      const opt = product.wellnessPricing.find((o) => o.id === wellnessPricingId);
      if (!opt) {
        changes.push({ type: "skipped", productId: g.productId, reason: "invalid wellness pricing option" });
        continue;
      }
    }
    if (!wellnessPricingId && product.wellnessPricing?.length) {
      wellnessPricingId = null; // unpriced
    }

    // find matching server line: same productId and same wellnessPricingId
    const groupType = product.type;
    let group = cart.groups.find((gr) => gr.type === groupType);
    const existingLine = group?.items.find(
      (ln) => ln.productId === g.productId && (ln.wellnessPricingId ?? null) === wellnessPricingId
    );

    if (existingLine) {
      const before = existingLine.quantity;
      existingLine.quantity = before + g.quantity;
      changes.push({
        type: "combined",
        productId: g.productId,
        title: product.title,
        quantityBefore: before,
        quantityAfter: existingLine.quantity,
        wellnessPricingId,
      });
    } else {
      const newLine: CartLine = {
        id: `merged-${g.productId}-${wellnessPricingId ?? "base"}`,
        productId: g.productId,
        quantity: g.quantity,
        wellnessPricingId,
        product: JSON.parse(JSON.stringify(product)),
        unavailable: false,
      };
      if (!group) {
        group = { type: groupType, itemCount: 0, unpricedItems: 0, subtotals: {}, items: [] };
        cart.groups.push(group);
      }
      group.items.push(newLine);
      changes.push({
        type: "added",
        productId: g.productId,
        title: product.title,
        quantityAfter: g.quantity,
        wellnessPricingId,
      });
    }
  }

  const recomputed = recomputeCart(cart);
  return { cart: recomputed, changes };
}