import type { GroupCheckoutAttempt, CheckoutResult, CheckoutState } from "@/types/cart";
import { transitionAttempt } from "./state";

export type CheckoutApi = (req: {
  groupType: string;
  items: GroupCheckoutAttempt["items"];
  paymentMethod: GroupCheckoutAttempt["paymentMethod"];
  idempotencyKey: string;
}) => Promise<CheckoutResult>;

export type StatusApi = (orderId: string) => Promise<{ status: "pending" | "paid" | "failed" }>;

export interface RunProgress {
  (attempts: GroupCheckoutAttempt[]): void;
}

export function makeAttempt(params: {
  groupType: string;
  paymentMethod: GroupCheckoutAttempt["paymentMethod"];
  items: GroupCheckoutAttempt["items"];
  attemptId?: string;
  idempotencyKey?: string;
}): GroupCheckoutAttempt {
  const attemptId = params.attemptId ?? `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const idempotencyKey = params.idempotencyKey ?? `idem-${params.groupType}-${attemptId}`;
  return {
    groupType: params.groupType,
    paymentMethod: params.paymentMethod,
    items: params.items,
    state: "ready",
    attemptId,
    idempotencyKey,
  };
}

export async function executeGroupCheckout(
  attempt: GroupCheckoutAttempt,
  api: CheckoutApi,
  statusApi?: StatusApi
): Promise<GroupCheckoutAttempt> {
  let cur: GroupCheckoutAttempt = { ...attempt };
  // blocked groups should not be submitted
  if (cur.state === "blocked") return cur;
  try {
    cur = transitionAttempt(cur, "submitting");
  } catch {
    // if already submitting/other, force submitting
    cur = { ...cur, state: "submitting" };
  }
  try {
    const res = await api({
      groupType: cur.groupType,
      items: cur.items,
      paymentMethod: cur.paymentMethod,
      idempotencyKey: cur.idempotencyKey,
    });
    const orderId = res.orderId;
    const status = res.status;
    if (status === "paid") {
      cur = transitionAttempt(cur, "paid", { orderId, status });
    } else if (status === "pending") {
      // reconcile if possible
      let finalStatus: "pending" | "paid" | "failed" = status;
      if (statusApi && orderId) {
        try {
          const s = await statusApi(orderId);
          finalStatus = s.status;
        } catch {
          // keep pending
        }
      }
      if (finalStatus === "paid") cur = transitionAttempt(cur, "paid", { orderId, status: finalStatus });
      else if (finalStatus === "failed") cur = transitionAttempt(cur, "failed", { orderId, status: finalStatus, error: "Order failed" });
      else cur = transitionAttempt(cur, "pending", { orderId, status: finalStatus });
    } else if (status === "failed") {
      cur = transitionAttempt(cur, "failed", { orderId, status, error: "Payment failed" });
    } else {
      cur = transitionAttempt(cur, "needs_attention", { orderId, status, error: "Unknown status" });
    }
    return cur;
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    const status = e?.status;
    if (status === 402) {
      cur = safeTransition(cur, "failed", { error: e?.message || "Payment declined" });
    } else if (status === 409) {
      cur = safeTransition(cur, "needs_attention", { error: e?.message || "Conflict / idempotency mismatch" });
    } else if (status === 500 || status === undefined) {
      // uncertain outcome: needs_attention, keep key for retry
      cur = safeTransition(cur, "needs_attention", { error: e?.message || "Server error; outcome uncertain" });
      // attempt reconciliation if we had an orderId? none yet
    } else {
      cur = safeTransition(cur, "failed", { error: e?.message || "Checkout failed" });
    }
    return cur;
  }
}

function safeTransition(attempt: GroupCheckoutAttempt, to: CheckoutState, patch?: Partial<GroupCheckoutAttempt>): GroupCheckoutAttempt {
  try {
    return transitionAttempt(attempt, to, patch);
  } catch {
    return { ...attempt, state: to, ...patch };
  }
}

export async function runAllGroups(
  attempts: GroupCheckoutAttempt[],
  api: CheckoutApi,
  statusApi: StatusApi | undefined,
  onProgress?: RunProgress
): Promise<GroupCheckoutAttempt[]> {
  const results: GroupCheckoutAttempt[] = [];
  for (const a of attempts) {
    // skip already paid/blocked
    if (a.state === "paid") {
      results.push(a);
      onProgress?.([...results, ...attempts.slice(results.length)]);
      continue;
    }
    if (a.state === "blocked") {
      results.push(a);
      onProgress?.([...results, ...attempts.slice(results.length)]);
      continue;
    }
    const updated = await executeGroupCheckout(a, api, statusApi);
    results.push(updated);
    onProgress?.([...results, ...attempts.slice(results.length)]);
  }
  return results;
}