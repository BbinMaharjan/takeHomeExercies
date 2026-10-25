import type { PersistedCheckoutState, GroupCheckoutAttempt } from "@/types/cart";

const KEY = "medex.checkout.attempts.v1";

export function readPersisted(): PersistedCheckoutState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.attempts)) return null;
    return parsed as PersistedCheckoutState;
  } catch {
    return null;
  }
}

export function writePersisted(state: PersistedCheckoutState): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function clearPersisted(): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function persistAttempts(attempts: GroupCheckoutAttempt[]): void {
  writePersisted({ version: 1, attempts, createdAt: Date.now() });
}