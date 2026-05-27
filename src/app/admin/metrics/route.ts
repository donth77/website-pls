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
/** Rows per page for each paginated section. Same number across all three so
 *  the layout stays predictable; tweak per-section if the event table starts
 *  looking too tall vs. the others. */
const PAGE_SIZE = 25;

/** Hard cap on the events read from Redis — matches `RECENT_EVENTS_MAX`
 *  inside the ring buffer, so paging never reveals more than the buffer
 *  retains and we never round-trip wasted bytes. */
const EVENTS_MAX = 500;

/** Query-string keys for each section's current page. Short on purpose so
 *  URLs stay readable; defaults to 1 when absent. */
const PAGE_PARAMS = {
  rateLimits: "rl",
  history: "hist",
  events: "evt",
} as const;

type PageState = Record<keyof typeof PAGE_PARAMS, number>;

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin(req, "METRICS_SECRET");
  if (unauthorized) return unauthorized;

  const pages = parsePageState(req.nextUrl.searchParams);

  let snapshot: MetricsSnapshot;
  try {
    // Read the full ring (up to EVENTS_MAX) so the renderer can slice
    // whichever page was requested. The history + rate-limit reads already
    // return everything they have, so we paginate them client-side too.
    snapshot = await readMetricsSnapshot({ days: 7, recent: EVENTS_MAX });
  } catch (err) {
    log.error("metrics dashboard snapshot failed", { error: String(err) });
    return new NextResponse(renderError(String(err)), {
      status: 500,
      headers: htmlHeaders(),
    });
  }

  return new NextResponse(renderDashboard(snapshot, pages), {
    status: 200,
    headers: htmlHeaders(),
  });
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

function parsePageState(params: URLSearchParams): PageState {
  return {
    rateLimits: parsePage(params.get(PAGE_PARAMS.rateLimits)),
    history: parsePage(params.get(PAGE_PARAMS.history)),
    events: parsePage(params.get(PAGE_PARAMS.events)),
  };
}

function parsePage(raw: string | null): number {
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

interface PageView<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

/** Clamp the requested page into range and return the slice. */
function sliceForPage<T>(all: T[], requestedPage: number): PageView<T> {
  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * PAGE_SIZE;
  return {
    items: all.slice(start, start + PAGE_SIZE),
    page,
    pageCount,
    total,
  };
}

/**
 * Build a relative URL for a specific section's page link, preserving the
 * other sections' current pages. Page-1 params are omitted to keep the URL
 * tidy (and to make the canonical no-pagination URL equal to the bare path).
 */
function pageUrl(
  state: PageState,
  section: keyof typeof PAGE_PARAMS,
  page: number,
): string {
  const next: PageState = { ...state, [section]: page };
  const params = new URLSearchParams();
  for (const key of Object.keys(PAGE_PARAMS) as (keyof typeof PAGE_PARAMS)[]) {
    if (next[key] > 1) params.set(PAGE_PARAMS[key], String(next[key]));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
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

function renderDashboard(snap: MetricsSnapshot, pages: PageState): string {
  const generatedAt = new Date(snap.generatedAt).toLocaleString();
  const rateLimitsView = sliceForPage(snap.rateLimits, pages.rateLimits);
  const historyView = sliceForPage(snap.rateLimitsHistory, pages.history);
  const eventsView = sliceForPage(snap.recentEvents, pages.events);
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
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    margin-top: 14px;
    font-size: 12px;
  }
  .pagination a, .pagination span.page-disabled, .pagination span.page-current {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    text-decoration: none;
    color: var(--text);
    background: var(--panel-hi);
    font-variant-numeric: tabular-nums;
  }
  .pagination a:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .pagination span.page-current {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .pagination span.page-disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .pagination .page-ellipsis {
    color: var(--muted);
    padding: 0 4px;
  }
  .pagination .page-summary {
    color: var(--muted);
    margin-left: 8px;
  }
</style>
</head>
<body>
<h1>Admin metrics</h1>
<div class="meta">
  Generated <code>${esc(generatedAt)}</code> · Auto-refresh 30s · Source: Redis
</div>

${renderRateLimitsSection(rateLimitsView, pages)}
${renderCountersSection(historyView, pages)}
${renderEventsSection(eventsView, pages)}

</body>
</html>`;
}

function renderRateLimitsSection(
  view: PageView<RateLimitSnapshotEntry>,
  pages: PageState,
): string {
  if (view.total === 0) {
    return `<section>
<h2>Live rate-limit state</h2>
<div class="empty">No entities currently near their limit.</div>
</section>`;
  }
  const rows = view.items
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
<h2>Live rate-limit state (${view.total})</h2>
<table>
<thead><tr><th>Bucket</th><th>Identity</th><th>Current / Limit</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${renderPagination(view, pages, "rateLimits")}
</section>`;
}

function renderCountersSection(
  view: PageView<RateLimitCounterEntry>,
  pages: PageState,
): string {
  if (view.total === 0) {
    return `<section>
<h2>Rate-limit hits (last 7 days)</h2>
<div class="empty">No rate-limit hits recorded in the counter window.</div>
</section>`;
  }
  const rows = view.items
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
<h2>Rate-limit hits (last 7 days, by user) — ${view.total} total</h2>
<table>
<thead><tr><th>Hits</th><th>Day</th><th>Bucket</th><th>Identity</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${renderPagination(view, pages, "history")}
</section>`;
}

function renderEventsSection(
  view: PageView<RecentEvent>,
  pages: PageState,
): string {
  if (view.total === 0) {
    return `<section>
<h2>Recent policy events</h2>
<div class="empty">No recent events.</div>
</section>`;
  }
  const rows = view.items
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
<h2>Recent policy events — ${view.total} total, newest first</h2>
<table>
<thead><tr><th>Time</th><th>Event</th><th>Context</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${renderPagination(view, pages, "events")}
</section>`;
}

/**
 * Compact pagination control: Prev / numbered pages with ellipses / Next +
 * a summary like "26–50 of 187". Plain anchor links so the dashboard
 * stays JS-free; preserves the other sections' page params via `pageUrl`.
 *
 * Renders nothing when the data fits on a single page (no extra chrome
 * for the common small-deployment case).
 */
function renderPagination(
  view: PageView<unknown>,
  pages: PageState,
  section: keyof typeof PAGE_PARAMS,
): string {
  if (view.pageCount <= 1) return "";
  const { page, pageCount, total } = view;

  const link = (label: string, target: number, extraClass = ""): string =>
    `<a class="${extraClass}" href="${esc(pageUrl(pages, section, target))}" rel="nofollow">${esc(label)}</a>`;
  const disabled = (label: string): string =>
    `<span class="page-disabled">${esc(label)}</span>`;
  const current = (label: string): string =>
    `<span class="page-current" aria-current="page">${esc(label)}</span>`;

  // Build the compressed page-number sequence: always show first + last +
  // a small window around the current page, with ellipses for gaps.
  const window: (number | "ellipsis")[] = [];
  const push = (n: number | "ellipsis") => {
    const last = window[window.length - 1];
    if (n === "ellipsis" && last === "ellipsis") return;
    window.push(n);
  };
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 1) {
      push(n);
    } else {
      push("ellipsis");
    }
  }

  const numberLinks = window
    .map((n) =>
      n === "ellipsis"
        ? `<span class="page-ellipsis">…</span>`
        : n === page
          ? current(String(n))
          : link(String(n), n),
    )
    .join("");

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  return `<nav class="pagination" aria-label="Pagination">
${page > 1 ? link("‹ Prev", page - 1) : disabled("‹ Prev")}
${numberLinks}
${page < pageCount ? link("Next ›", page + 1) : disabled("Next ›")}
<span class="page-summary">${esc(start)}–${esc(end)} of ${esc(total)}</span>
</nav>`;
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
