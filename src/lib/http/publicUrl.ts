import "server-only";

/**
 * Resolve the app's public origin for building absolute URLs (publish links,
 * canonical URLs, etc.).
 *
 * Resolution order:
 *   1. `APP_PUBLIC_URL` env (e.g. `https://websitepls.com`) — authoritative.
 *   2. `x-forwarded-proto` / `x-forwarded-host` — only when `TRUST_PROXY=true`.
 *      Required for Cloudflare / load-balancer deployments where the proxy
 *      terminates TLS and forwards the scheme via headers.
 *   3. Fallback: `https` + the `host` header. Safer than trusting
 *      `x-forwarded-proto` from an unknown source — an attacker controlling
 *      that header could otherwise downgrade generated URLs to `http`.
 *
 * Returns a string like `"https://example.com"` with no trailing slash.
 */
export function resolvePublicOrigin(headers: Headers): string {
  const configured = process.env.APP_PUBLIC_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const host = headers.get("host") ?? "localhost";

  if (process.env.TRUST_PROXY === "true") {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const fwdHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const safeProto = proto === "http" || proto === "https" ? proto : "https";
    return `${safeProto}://${fwdHost || host}`;
  }

  return `https://${host}`;
}
