/**
 * Thin wrapper around the browser Notification API.
 *
 * SSR-safe: every function tolerates `window` / `Notification` being
 * undefined and returns sensible defaults. Call sites don't need their
 * own guards.
 */

export type NotificationPermissionState =
  | "default" // never asked
  | "granted"
  | "denied"
  | "unsupported"; // no Notification API in this browser

export function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getPermission(): NotificationPermissionState {
  if (!isSupported()) return "unsupported";
  // Notification.permission widens to string in some lib versions; trust it.
  return Notification.permission as NotificationPermissionState;
}

/**
 * Must be called from a user gesture (click). Safari in particular ignores
 * permission requests outside one.
 */
export async function requestPermission(): Promise<NotificationPermissionState> {
  if (!isSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    // Older browsers (Safari pre-16) used a callback signature; the
    // promise form rejects there. Treat as "denied" rather than crash.
    return "denied";
  }
}

export interface FireNotificationOptions {
  title: string;
  body?: string;
  /** Focus this URL when the user clicks the notification. Defaults to current page. */
  url?: string;
  /** Used to coalesce repeat notifications. */
  tag?: string;
  /** Icon URL. Defaults to the site favicon. */
  icon?: string;
}

/**
 * Fires a desktop notification. No-ops when:
 *   - Notification API isn't supported
 *   - permission isn't granted
 *   - the tab is currently focused (firing while the user is looking is rude)
 *
 * Returns true if the notification was actually shown.
 */
export function fire(opts: FireNotificationOptions): boolean {
  if (!isSupported() || Notification.permission !== "granted") return false;
  if (typeof document !== "undefined" && document.hasFocus()) return false;

  try {
    const notif = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: opts.icon ?? "/favicon.ico",
    });
    notif.onclick = () => {
      try {
        window.focus();
        if (opts.url) window.location.href = opts.url;
      } finally {
        notif.close();
      }
    };
    // Auto-dismiss after 10s — most OSes do this anyway, but be explicit.
    setTimeout(() => {
      try {
        notif.close();
      } catch {
        /* already gone */
      }
    }, 10_000);
    return true;
  } catch {
    return false;
  }
}
