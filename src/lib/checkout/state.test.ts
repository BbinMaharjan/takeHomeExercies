import { describe, it, expect } from "vitest";
import { canTransition, transitionAttempt, reconcileStatus } from "./state";

describe("checkout state machine", () => {
  it("allows ready -> submitting", () => {
    expect(canTransition("ready", "submitting")).toBe(true);
  });
  it("disallows paid -> submitting", () => {
    expect(canTransition("paid", "submitting")).toBe(false);
  });
  it("reconciles status", () => {
    expect(reconcileStatus("pending", "paid")).toBe("paid");
    expect(reconcileStatus("pending", "failed")).toBe("failed");
    expect(reconcileStatus("pending", "pending")).toBe("pending");
  });
  it("throws on invalid transition", () => {
    const attempt = {
      groupType: "g",
      idempotencyKey: "k",
      paymentMethod: "card" as const,
      items: [],
      state: "paid" as const,
      attemptId: "a",
    };
    expect(() => transitionAttempt(attempt, "submitting")).toThrow();
  });
});