import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared security headers for serving LLM-generated HTML.
 *
 * Used by both the authenticated preview route (`/preview/[versionId]`) and
 * the public publish proxy route (`/p/[slug]`). Keeping a single source of
 * truth prevents the two routes from drifting — published sites MUST have
 * the same CSP as previews, because the underlying bytes are the same and
 * may contain LLM-injected scripts or event handlers.
 *
 * The CSP intentionally allows:
 *   - Tailwind CDN script (`https://cdn.tailwindcss.com`) for utility classes
 *   - Inline styles (required by Tailwind JIT)
 *   - Google Fonts (fonts.googleapis.com + fonts.gstatic.com)
 *   - Images from any HTTPS host + data: URIs (stock photo CDNs)
 *   - A whitelisted set of iframe sources (see `src/lib/iframe-whitelist.txt`)
 * and blocks everything else — no arbitrary scripts, no XHR/fetch, no
 * framing from other origins.
 */

/**
 * Expand a whitelist entry with an explicit path into the two CSP source
 * expressions that together cover both common matching patterns:
 *
 *   - `https://host/path`  — *exact* path match (CSP rule: no trailing slash
 *     means URL path must equal this exactly). Matches `/path?x=1` because
 *     query strings are not part of the path.
 *   - `https://host/path/` — *prefix* match (CSP rule: trailing slash means
 *     URL path must start with this). Matches `/path/anything`.
 *
 * Without both forms, a whitelist entry like `https://www.google.com/maps/embed`
 * would either:
 *   (a) only match `/maps/embed` exactly (the raw entry), missing any future
 *       URLs like `/maps/embed/v2/foo`, OR
 *   (b) only match `/maps/embed/...` (if we naively appended a trailing slash),
 *       missing the actual iframe URL `/maps/embed?pb=...` because the URL's
 *       path is `/maps/embed` with no slash before the query string.
 *
 * Emitting both forms makes every whitelist entry permissive within the
 * author's chosen path, regardless of whether the real URL has a trailing
 * slash or a query string. Entries without a path (origin-only, e.g.
 * `https://www.youtube.com`) already match any URL on the host, so they are
 * left untouched.
 */
function expandCspSource(source: string): string[] {
  try {
    const u = new URL(source);
    if (u.pathname === "/" || u.pathname === "") {
      return [source];
    }
    const withoutSlash = source.endsWith("/") ? source.slice(0, -1) : source;
    const withSlash = `${withoutSlash}/`;
    return [withoutSlash, withSlash];
  } catch {
    return [source];
  }
}

// Read the iframe whitelist once at module load. The file lists one origin
// per line; blank lines and `#` comments are ignored.
const iframeWhitelist = readFileSync(
  join(process.cwd(), "src/lib/iframe-whitelist.txt"),
  "utf-8",
)
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .flatMap(expandCspSource)
  .join(" ");

// `style-src 'unsafe-inline'` is required by the Tailwind CDN JIT runtime and
// cannot be tightened without precompiling Tailwind (a separate workstream).
// Everything else is locked down as far as practical:
//   - `object-src 'none'`       — no <object>/<embed>/<applet>
//   - `base-uri 'none'`         — prevents a prompt-injected <base> from
//                                 rewriting all relative URLs on the page
//   - `form-action 'none'`      — blocks prompt-injected forms from POSTing
//                                 credentials to an attacker origin
const CSP = [
  "default-src 'none'",
  "script-src https://cdn.tailwindcss.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' https: data:",
  `frame-src ${iframeWhitelist}`,
  "connect-src 'none'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export interface GeneratedHtmlHeaderOptions {
  /**
   * Override the cache-control header. Defaults to `no-store` (preview route).
   * The publish proxy passes a short public TTL so shared caches can serve
   * the same version between republishes.
   */
  cacheControl?: string;
}

/**
 * Build the response header set for a generated-HTML response.
 *
 * Returns a plain object suitable for passing to `new NextResponse(html, { headers })`.
 */
export function buildGeneratedHtmlHeaders(
  options: GeneratedHtmlHeaderOptions = {},
): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": options.cacheControl ?? "no-store",
    // Helps third-party image CDNs (e.g. Wikimedia) receive a normal Referer from subresources.
    "referrer-policy": "strict-origin-when-cross-origin",
    // CSP: allow Tailwind CDN script + inline styles (Tailwind JIT) + stock photo CDNs.
    // Block all other scripts (mitigates LLM-injected <script>/event handlers).
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
  };
}
