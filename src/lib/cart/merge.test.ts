import { describe, it, expect } from "vitest";
import { mergeGuestCart } from "./merge";
import { lineUnitPrice } from "./index";
import type { Cart, Product } from "@/types/cart";

const catalog: Product[] = [
  { id: "p1", title: "Liver Profile", type: "lab_test", currency: "NPR", providerId: 1, providerName: "Lab", price: 4760 },
  { id: "p2", title: "New Service", type: "lab_test", currency: "THB", providerId: 2, providerName: "Clinic", price: 500 },
  { id: "w1", title: "Facial", type: "wellness", currency: "THB", providerId: 3, providerName: "Spa", price: null, priceUnknown: true, wellnessPricing: [{ id: "o60", durationInMinutes: 60, amount_after_service_charge: 1800 }] },
];

describe("mergeGuestCart", () => {
  it("combines overlapping items by productId", () => {
    const serverCart: Cart = {
      groups: [
        {
          type: "lab_test",
          itemCount: 2,
          unpricedItems: 0,
          subtotals: { NPR: 9520 },
          items: [{ id: "l1", productId: "p1", quantity: 2, product: catalog[0] }],
        },
      ],
      totalItems: 2,
    };
    const result = mergeGuestCart({ serverCart, guestItems: [{ productId: "p1", quantity: 3 }], catalog });
    expect(result.cart.groups[0].items[0].quantity).toBe(5);
    expect(result.changes[0].type).toBe("combined");
  });

  it("adds new item", () => {
    const serverCart: Cart = { groups: [], totalItems: 0 };
    const result = mergeGuestCart({ serverCart, guestItems: [{ productId: "p2", quantity: 1 }], catalog });
    expect(result.cart.groups[0].items[0].productId).toBe("p2");
    expect(result.changes[0].type).toBe("added");
  });

  it("skips unavailable product", () => {
    const serverCart: Cart = { groups: [], totalItems: 0 };
    const result = mergeGuestCart({ serverCart, guestItems: [{ productId: "missing", quantity: 1 }], catalog });
    expect(result.cart.groups.length).toBe(0);
    expect(result.changes[0].type).toBe("skipped");
    expect(result.changes[0].reason).toContain("no longer available");
  });

  it("skips invalid quantity", () => {
    const serverCart: Cart = { groups: [], totalItems: 0 };
    const result = mergeGuestCart({ serverCart, guestItems: [{ productId: "p2", quantity: 0 }], catalog });
    expect(result.changes[0].type).toBe("skipped");
    expect(result.changes[0].reason).toContain("invalid quantity");
  });

  it("wellness guest without option added unpriced", () => {
    const serverCart: Cart = { groups: [], totalItems: 0 };
    const result = mergeGuestCart({ serverCart, guestItems: [{ productId: "w1", quantity: 1 }], catalog });
    const line = result.cart.groups[0].items[0];
    expect(line.wellnessPricingId).toBeNull();
    expect(lineUnitPrice(line)).toBeNull();
  });
});

