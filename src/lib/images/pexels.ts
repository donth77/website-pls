import { createLogger } from "@/lib/logger";

const log = createLogger("pexels");
const PEXELS_API = "https://api.pexels.com/v1";

type PexelsPhoto = {
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
  };
  photographer: string;
  photographer_url: string;
  url: string;
};

type SearchResult = {
  url: string;
  photographerName: string;
  photographerUrl: string;
  photoUrl: string;
};

function getApiKey(): string | null {
  return process.env.PEXELS_API_KEY ?? null;
}

/**
 * Search Pexels for a photo matching `query`. Returns the first result
 * sized to `w`x`h`, or null if nothing found or the API key is missing.
 */
export async function searchPhoto(
  query: string,
  w = 800,
  h = 600,
  orientation: "landscape" | "portrait" | "square" = "landscape",
): Promise<SearchResult | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    query,
    per_page: "1",
    orientation,
  });

  const res = await fetch(`${PEXELS_API}/search?${params}`, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    log.warn("Search failed", { status: res.status, query });
    return null;
  }

  const json = (await res.json()) as { photos: PexelsPhoto[] };
  const photo = json.photos[0];
  if (!photo) return null;

  // Pexels supports dynamic resizing via query params on the original URL.
  const sizedUrl = `${photo.src.original}?auto=compress&cs=tinysrgb&w=${w}&h=${h}&fit=crop`;

  return {
    url: sizedUrl,
    photographerName: photo.photographer,
    photographerUrl: photo.photographer_url,
    photoUrl: photo.url,
  };
}

/**
 * Search Pexels for multiple queries in parallel. Returns a map of
 * query → result (or null if that query had no hits).
 */
export async function searchPhotos(
  queries: { query: string; w?: number; h?: number }[],
): Promise<Map<string, SearchResult | null>> {
  const results = new Map<string, SearchResult | null>();
  if (!getApiKey()) {
    log.warn("PEXELS_API_KEY is not set — skipping Pexels image search");
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
