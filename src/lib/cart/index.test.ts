import { describe, it, expect } from "vitest";
import { normalizeCart, lineUnitPrice, isGroupCheckoutEligible } from "./index";
import type { CartLine } from "@/types/cart";
import type { Cart } from "@/types/cart";

describe("cart normalization", () => {
  it("sums quantities for itemCount", () => {
    const cart: Cart = {
      groups: [
        {
          type: "lab_test",
          itemCount: 0,
          unpricedItems: 0,
          subtotals: {},
          items: [
            { id: "a", productId: "p1", quantity: 2, product: { id: "p1", title: "t", type: "lab_test", currency: "THB", providerId: 1, providerName: "P", price: 10 } },
            { id: "b", productId: "p2", quantity: 3, product: { id: "p2", title: "t2", type: "lab_test", currency: "THB", providerId: 2, providerName: "P2", price: 5 } },
          ],
        },
      ],
      totalItems: 0,
    };
    const n = normalizeCart(cart);
    expect(n.groups[0].itemCount).toBe(5);
    expect(n.totalItems).toBe(5);
  });

  it("computes per-currency subtotals separately", () => {
    const cart: Cart = {
      groups: [
        {
          type: "package",
          itemCount: 2,
          unpricedItems: 0,
          subtotals: {},
          items: [
            { id: "a", productId: "p1", quantity: 1, product: { id: "p1", title: "t", type: "package", currency: "THB", providerId: 1, providerName: "P", price: 100 } },
            { id: "b", productId: "p2", quantity: 1, product: { id: "p2", title: "t2", type: "package", currency: "INR", providerId: 2, providerName: "P2", price: 50 } },
          ],
        },
      ],
      totalItems: 2,
    };
    const n = normalizeCart(cart);
    expect(n.groups[0].subtotals).toEqual({ THB: 100, INR: 50 });
  });

  it("wellness unpriced when no option selected", () => {
    const line = {
      id: "w",
      productId: "w1",
      quantity: 1,
      product: {
        id: "w1",
        title: "Facial",
        type: "wellness",
        currency: "THB",
        providerId: 1,
        providerName: "Spa",
        price: null,
        priceUnknown: true,
        wellnessPricing: [{ id: "o1", durationInMinutes: 60, amount_after_service_charge: 1800 }],
      },
    } as CartLine;
    expect(lineUnitPrice(line)).toBeNull();
  });

  it("wellness uses selected option price", () => {
    const line = {
      id: "w",
      productId: "w1",
      quantity: 1,
      wellnessPricingId: "o1",
      product: {
        id: "w1",
        title: "Facial",
        type: "wellness",
        currency: "THB",
        providerId: 1,
        providerName: "Spa",
        price: null,
        priceUnknown: true,
        wellnessPricing: [{ id: "o1", durationInMinutes: 60, amount_after_service_charge: 1800 }],
      },
    } as CartLine;
    expect(lineUnitPrice(line)).toBe(1800);
  });

  it("unavailable line when empty product", () => {
    const cart: Cart = {
      groups: [
        {
          type: "unknown",
          itemCount: 1,
          unpricedItems: 1,
          subtotals: {},
          items: [{ id: "u", productId: "x", quantity: 1, product: null }],
        },
      ],
      totalItems: 1,
    };
    const n = normalizeCart(cart);
    expect(n.groups[0].items[0].unavailable).toBe(true);
    expect(isGroupCheckoutEligible(n.groups[0])).toBe(false);
  });
});