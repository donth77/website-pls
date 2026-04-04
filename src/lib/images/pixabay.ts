import { createLogger } from "@/lib/logger";

const log = createLogger("pixabay");
const PIXABAY_API = "https://pixabay.com/api";

type PixabayHit = {
  webformatURL: string;
  largeImageURL: string;
  pageURL: string;
  user: string;
  userImageURL: string;
};

type SearchResult = {
  url: string;
  photographerName: string;
  photographerUrl: string;
  photoUrl: string;
};

function getApiKey(): string | null {
  return process.env.PIXABAY_API_KEY ?? null;
}

/**
 * Search Pixabay for a photo matching `query`. Returns the first result
 * or null if nothing found or the API key is missing.
 */
export async function searchPhoto(
  query: string,
  w = 800,
  _h = 600,
  orientation: "horizontal" | "vertical" = "horizontal",
): Promise<SearchResult | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    per_page: "3",
    image_type: "photo",
    orientation,
    safesearch: "true",
  });

  const res = await fetch(`${PIXABAY_API}/?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    log.warn("Search failed", { status: res.status, query });
    return null;
  }

  const json = (await res.json()) as { hits: PixabayHit[] };
  const hit = json.hits[0];
  if (!hit) return null;

  // Pixabay doesn't support dynamic resizing — use largeImageURL for
  // higher quality, fall back to webformatURL (max 640px wide).
  const url = w > 640 ? hit.largeImageURL : hit.webformatURL;

  return {
    url,
    photographerName: hit.user,
    photographerUrl: `https://pixabay.com/users/${encodeURIComponent(hit.user)}/`,
    photoUrl: hit.pageURL,
  };
}

/**
 * Search Pixabay for multiple queries in parallel. Returns a map of
 * query → result (or null if that query had no hits).
 */
export async function searchPhotos(
  queries: { query: string; w?: number; h?: number }[],
): Promise<Map<string, SearchResult | null>> {
  const results = new Map<string, SearchResult | null>();
  if (!getApiKey()) {
    log.warn("PIXABAY_API_KEY is not set — skipping Pixabay image search");
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
