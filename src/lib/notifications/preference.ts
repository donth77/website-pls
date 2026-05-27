/**
 * Per-browser opt-in for completion notifications. Separate from the
 * Notification API permission — a user can have granted permission once
 * and then turned the in-app toggle off, in which case we have permission
 * but shouldn't fire.
 *
 * Both signals are checked at fire-time.
 */

const STORAGE_KEY = "websitepls:notify-on-complete";

export function loadOptIn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveOptIn(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* quota or unavailable — ignore */
  }
}
