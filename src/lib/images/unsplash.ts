import { createLogger } from "@/lib/logger";

const log = createLogger("unsplash");
const UNSPLASH_API = "https://api.unsplash.com";

type UnsplashPhoto = {
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  user: {
    name: string;
    links: { html: string };
  };
  links: { html: string };
};

type SearchResult = {
  url: string;
  photographerName: string;
  photographerUrl: string;
  photoUrl: string;
};

function getAccessKey(): string | null {
  return process.env.UNSPLASH_ACCESS_KEY ?? null;
}

/**
 * Max characters sent to Unsplash. Orchestrator prompts are short (a few
 * words per image), so long queries indicate LLM misuse or prompt-injected
 * data leaking into the search string.
 */
const MAX_QUERY_LEN = 80;

function sanitizeQuery(query: string): string | null {
  const cleaned = query
    // Strip control chars (including null bytes).
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    // Collapse whitespace.
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, MAX_QUERY_LEN);
}

/**
 * Search Unsplash for a photo matching `query`. Returns the first result
 * sized to `w`x`h` via Unsplash's dynamic resizing, or null if nothing found
 * or the API key is missing.
 */
export async function searchPhoto(
  query: string,
  w = 800,
  h = 600,
  orientation: "landscape" | "portrait" | "squarish" = "landscape",
): Promise<SearchResult | null> {
  const accessKey = getAccessKey();
  if (!accessKey) return null;

  const safeQuery = sanitizeQuery(query);
  if (!safeQuery) return null;

  const params = new URLSearchParams({
    query: safeQuery,
    per_page: "1",
    orientation,
  });

  const res = await fetch(`${UNSPLASH_API}/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${accessKey}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    log.warn("Search failed", { status: res.status, query });
    return null;
  }

  const json = (await res.json()) as { results: UnsplashPhoto[] };
  const photo = json.results[0];
  if (!photo) return null;

  // Unsplash dynamic resizing: append width/height/fit to the raw URL.
  const sizedUrl = `${photo.urls.raw}&w=${w}&h=${h}&fit=crop&auto=format`;

  return {
    url: sizedUrl,
    photographerName: photo.user.name,
    photographerUrl: photo.user.links.html,
    photoUrl: photo.links.html,
  };
}

export type ImageAttribution = {
  photographerName: string;
  photographerUrl: string;
  photoUrl: string;
};

/**
 * Search Unsplash for multiple queries in parallel. Returns a map of
 * query → result (or null if that query had no hits).
 */
export async function searchPhotos(
  queries: { query: string; w?: number; h?: number }[],
): Promise<Map<string, SearchResult | null>> {
  const results = new Map<string, SearchResult | null>();
  if (!getAccessKey()) {
    log.warn("UNSPLASH_ACCESS_KEY is not set — skipping image search");
    return results;
  }

  const unique = [...new Map(queries.map((q) => [q.query, q])).values()];

  const settled = await Promise.allSettled(
    unique.map((q) => searchPhoto(q.query, q.w, q.h)),
  );

  for (let i = 0; i < unique.length; i++) {
    const s = settled[i];
    if (s.status === "rejected") {
      log.warn("Search error", {
        query: unique[i].query,
        error: String(s.reason),
      });
    }
    results.set(unique[i].query, s.status === "fulfilled" ? s.value : null);
  }

  return results;
}
