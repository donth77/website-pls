import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import {
  readMetricsSnapshot,
  type MetricsSnapshot,
  type RateLimitSnapshotEntry,
  type RateLimitCounterEntry,
  type RecentEvent,
} from "@/lib/admin/metrics";
import { createLogger } from "@/lib/logger";

const log = createLogger("admin:metrics:dashboard");

/**
 * GET /admin/metrics
 *
 * Server-rendered HTML dashboard showing the same data as the JSON endpoint
 * at /api/admin/metrics. Implemented as a Route Handler (not a Page) so it
 * doesn't pass through the locale segment, doesn't load the React client
 * bundle, and doesn't accept any user input beyond the auth header.
 *
 * Auth: same as the JSON endpoint (Bearer OR Basic, `METRICS_SECRET`).
 * Deliberately gated by its own secret separate from `ADMIN_SECRET` so a
 * leak of the read-only dashboard credential can't escalate to destructive
 * admin endpoints like user deletion.
 * Refresh: meta-refresh every 30 seconds — no JavaScript on the page.
 * Caching: no-store, noindex. The dashboard must never be cached or indexed.
 *
 * Design goals:
 *   1. Zero JavaScript on the client — plain HTML + CSS only
 *   2. Fast to render (one Redis snapshot, one template)
 *   3. Hard to accidentally break (no framework hooks, no components)
 *   4. Easy to delete or migrate when real user-level admin lands
 */
export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin(req, "METRICS_SECRET");
  if (unauthorized) return unauthorized;

  let snapshot: MetricsSnapshot;
  try {
    snapshot = await readMetricsSnapshot({ days: 7, recent: 50 });
  } catch (err) {
    log.error("metrics dashboard snapshot failed", { error: String(err) });
    return new NextResponse(renderError(String(err)), {
      status: 500,
      headers: htmlHeaders(),
    });
  }

  return new NextResponse(renderDashboard(snapshot), {
    status: 200,
    headers: htmlHeaders(),
  });
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

function htmlHeaders(): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; "),
  };
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

/**
 * HTML-escape a string for safe insertion into element content or attribute
 * values. The dashboard renders raw Redis data (user IDs, IPs, slugs, log
 * context) that COULD in principle contain hostile characters, so every
 * dynamic string passes through this helper before reaching the template.
 *
 * Escaping `/` is not strictly necessary for HTML but closes the `</script>`
 * injection vector if a value is ever interpolated into a script block.
 */
function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\//g, "&#x2F;");
}

function renderDashboard(snap: MetricsSnapshot): string {
  const generatedAt = new Date(snap.generatedAt).toLocaleString();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<meta name="robots" content="noindex, nofollow">
<title>Admin metrics</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0b0c10;
    --panel: #15171c;
    --panel-hi: #1c1f26;
    --border: #2a2e38;
    --text: #e4e6eb;
    --muted: #8a94a8;
    --accent: #6ea8ff;
    --warn: #f5b14a;
    --danger: #f46a6a;
    --ok: #5ac48a;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f7fa;
      --panel: #ffffff;
      --panel-hi: #f0f2f7;
      --border: #dee1e7;
      --text: #1a1d24;
      --muted: #5a6377;
      --accent: #2563eb;
      --warn: #b45309;
      --danger: #b91c1c;
      --ok: #047857;
    }
  }
  body {
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    margin: 0;
    padding: 24px;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 600;
  }
  .meta {
    color: var(--muted);
    font-size: 12px;
    margin-bottom: 24px;
  }
  .meta code {
    font-family: var(--mono);
    font-size: 11px;
    background: var(--panel);
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }
  section {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 20px;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .empty {
    color: var(--muted);
    font-style: italic;
    padding: 8px 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th, td {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  th {
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.04em;
  }
  tr:last-child td {
    border-bottom: 0;
  }
  tr.at-limit td {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  td.id, td.slug {
    font-family: var(--mono);
    font-size: 12px;
    word-break: break-all;
    max-width: 280px;
  }
  td.count, td.num {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pill.ok { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
  .pill.warn { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
  .pill.danger { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
  .event-row td {
    font-family: var(--mono);
    font-size: 12px;
  }
  .event-context {
    color: var(--muted);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
</head>
<body>
<h1>Admin metrics</h1>
<div class="meta">
  Generated <code>${esc(generatedAt)}</code> · Auto-refresh 30s · Source: Redis
</div>

${renderRateLimitsSection(snap.rateLimits)}
${renderCountersSection(snap.rateLimitsHistory)}
${renderEventsSection(snap.recentEvents)}

</body>
</html>`;
}

function renderRateLimitsSection(entries: RateLimitSnapshotEntry[]): string {
  if (entries.length === 0) {
    return `<section>
<h2>Live rate-limit state</h2>
<div class="empty">No entities currently near their limit.</div>
</section>`;
  }
  const rows = entries
    .map((e) => {
      const cls = e.atLimit ? "at-limit" : "";
      const statusPill = e.atLimit
        ? `<span class="pill danger">At limit</span>`
        : e.current >= e.limit * 0.8
          ? `<span class="pill warn">Near limit</span>`
          : `<span class="pill ok">OK</span>`;
      return `<tr class="${cls}">
<td>${esc(e.label)}</td>
<td class="id">${esc(e.id)}</td>
<td class="num">${esc(e.current)} / ${esc(e.limit)}</td>
<td>${statusPill}</td>
</tr>`;
    })
    .join("");
  return `<section>
<h2>Live rate-limit state (${entries.length})</h2>
<table>
<thead><tr><th>Bucket</th><th>Identity</th><th>Current / Limit</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`;
}

function renderCountersSection(entries: RateLimitCounterEntry[]): string {
  if (entries.length === 0) {
    return `<section>
<h2>Rate-limit hits (last 7 days)</h2>
<div class="empty">No rate-limit hits recorded in the counter window.</div>
</section>`;
  }
  const rows = entries
    .map(
      (e) =>
        `<tr>
<td class="num">${esc(e.count)}</td>
<td>${esc(e.day)}</td>
<td>${esc(e.bucket)}</td>
<td class="id">${esc(e.id)}</td>
</tr>`,
    )
    .join("");
  return `<section>
<h2>Rate-limit hits (last 7 days, by user)</h2>
<table>
<thead><tr><th>Hits</th><th>Day</th><th>Bucket</th><th>Identity</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`;
}

function renderEventsSection(events: RecentEvent[]): string {
  if (events.length === 0) {
    return `<section>
<h2>Recent policy events</h2>
<div class="empty">No recent events.</div>
</section>`;
  }
  const rows = events
    .map((e) => {
      const time = new Date(e.at).toLocaleString();
      // Render the event context (everything except `event` and `at`) as a
      // compact JSON string. Escape every character before it hits the HTML.
      const contextObj: Record<string, unknown> = { ...e };
      delete contextObj.event;
      delete contextObj.at;
      const context = Object.keys(contextObj).length
        ? JSON.stringify(contextObj)
        : "";
      return `<tr class="event-row">
<td>${esc(time)}</td>
<td>${esc(e.event)}</td>
<td class="event-context">${esc(context)}</td>
</tr>`;
    })
    .join("");
  return `<section>
<h2>Recent policy events (last ${events.length}, newest first)</h2>
<table>
<thead><tr><th>Time</th><th>Event</th><th>Context</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`;
}

function renderError(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Admin metrics — error</title>
<style>
  body { background: #0b0c10; color: #e4e6eb; font: 14px/1.5 system-ui, sans-serif; padding: 40px; }
  h1 { color: #f46a6a; font-size: 18px; }
  pre { background: #15171c; border: 1px solid #2a2e38; border-radius: 6px; padding: 16px; overflow: auto; }
</style>
</head>
<body>
<h1>Could not read metrics</h1>
<pre>${esc(message)}</pre>
</body>
</html>`;
}
