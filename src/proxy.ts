import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

// Security headers applied to every app-route response.
//
// Scope: only the routes matched by `config.matcher` below — that excludes
// /api, /preview, /p/, /admin/, _next, _vercel, and static files. Those
// surfaces either render LLM-generated HTML (which has its own stricter CSP
// in src/lib/security/htmlResponseHeaders.ts), are JSON APIs (headers like
// X-Frame-Options don't apply), or are operator-only (admin sets its own).
//
// Deliberately omitted: Content-Security-Policy. A wrong CSP on the app
// surface silently breaks pages (missed inline script, missed font origin)
// and is harder to recover from than discovering it's missing. The
// high-risk surface — LLM-generated HTML — already has a tight CSP. Adding
// CSP here is a separate, browser-tested change.
const SECURITY_HEADERS: Record<string, string> = {
  // HSTS: tell browsers to use HTTPS for this origin for the next year.
  // No `preload` directive — preload is hard to roll back and we want to
  // confirm prod cert + subdomain inventory before opting in.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  // Block any other site from iframing our app pages.
  "X-Frame-Options": "DENY",
  // Stop browsers from MIME-sniffing responses into something executable.
  "X-Content-Type-Options": "nosniff",
  // Don't leak full URLs (including query strings like ?token=) to other
  // origins via the Referer header.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Deny permissions the app doesn't use. Defence-in-depth in case an
  // injected script ever tries to call these APIs.
  "Permissions-Policy":
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()",
};

export function proxy(req: NextRequest) {
  const res = intlMiddleware(req);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(name, value);
  }
  return res;
}

export const config = {
  // Match all paths except: api, preview, p/ (public published sites),
  // admin/ (operator-only routes), _next, static files.
  //
  // Every entry except the plain `api` uses a trailing slash because a bare
  // letter in a negative lookahead matches the single character — a bare
  // `p` would silently exclude `/projects` and `/privacy`, and a bare
  // `admin` would exclude any path that happens to start with `admin`.
  matcher: ["/((?!api|preview|p/|admin/|_next|_vercel|.*\\..*).*)"],
};
