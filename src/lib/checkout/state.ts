import type { CheckoutState, GroupCheckoutAttempt } from "@/types/cart";

// Allowed transitions
const TRANSITIONS: Record<CheckoutState, CheckoutState[]> = {
  ready: ["submitting", "blocked"],
  blocked: ["ready"],
  submitting: ["paid", "pending", "failed", "needs_attention"],
  pending: ["paid", "failed", "needs_attention"],
  paid: [],
  failed: ["submitting"],
  needs_attention: ["pending", "paid", "failed", "submitting"],
};

export function canTransition(from: CheckoutState, to: CheckoutState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionAttempt(
  attempt: GroupCheckoutAttempt,
  to: CheckoutState,
  patch?: Partial<GroupCheckoutAttempt>
): GroupCheckoutAttempt {
  if (!canTransition(attempt.state, to)) {
    // allow same-state no-op
    if (attempt.state === to) return { ...attempt, ...patch };
    throw new Error(`Invalid transition ${attempt.state} -> ${to}`);
  }
  return { ...attempt, state: to, ...patch };
}

export function markPaid(attempt: GroupCheckoutAttempt, orderId: string): GroupCheckoutAttempt {
  return transitionAttempt(attempt, "paid", { orderId, status: "paid" });
}

export function markFailed(attempt: GroupCheckoutAttempt, error: string, orderId?: string): GroupCheckoutAttempt {
  return transitionAttempt(attempt, "failed", { error, orderId, status: "failed" });
}

export function markPending(attempt: GroupCheckoutAttempt, orderId?: string): GroupCheckoutAttempt {
  return transitionAttempt(attempt, "pending", { orderId, status: "pending" });
}

export function isTerminal(state: CheckoutState): boolean {
  return state === "paid" || state === "failed";
}

export function reconcileStatus(state: CheckoutState, status: "pending" | "paid" | "failed"): CheckoutState {
  if (status === "paid") return "paid";
  if (status === "failed") return "failed";
  return "pending";
}