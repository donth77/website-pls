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

// Content-Security-Policy for the app surface (not the LLM-generated HTML —
// that has its own stricter policy in src/lib/security/htmlResponseHeaders.ts).
//
// External dependencies the app actually loads:
//   - Cloudflare Turnstile widget: script + iframe + XHR to challenges.cloudflare.com
//   - Fonts: next/font/google SELF-HOSTS at build time → served from 'self',
//     so no fonts.googleapis.com / fonts.gstatic.com entry is needed.
//   - OAuth avatars + stock photos: loaded via next/image (served from 'self'
//     as /_next/image) or directly over https — covered by `img-src https:`.
//
// 'unsafe-inline' in script-src is required by Next.js App Router's inlined
// RSC/bootstrap scripts. The robust alternative is a per-request nonce, which
// needs deeper middleware plumbing — tracked as a follow-up in
// .claude/plans/app-route-csp.md. 'unsafe-inline' in style-src is required by
// Tailwind / styled-jsx inline styles.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

// Report-Only during rollout: the browser REPORTS violations but still loads
// everything, so a missed directive can't break a page. Once the observation
// window (see .claude/plans/go-live-runbook.md Phase 5) confirms no violations
// across all routes, flip this to false to enforce.
const CSP_REPORT_ONLY = true;
const CSP_HEADER_NAME = CSP_REPORT_ONLY
  ? "Content-Security-Policy-Report-Only"
  : "Content-Security-Policy";

export function proxy(req: NextRequest) {
  const res = intlMiddleware(req);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(name, value);
  }
  res.headers.set(CSP_HEADER_NAME, CSP);
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
