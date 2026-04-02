import { searchPhotos as unsplashSearch } from "./unsplash";
import { searchPhotos as pexelsSearch } from "./pexels";
import { createLogger } from "@/lib/logger";

const log = createLogger("image-search");

export type ImageAttribution = {
  photographerName: string;
  photographerUrl: string;
  photoUrl: string;
  source: "unsplash" | "pexels";
};

export type SearchResult = {
  url: string;
  photographerName: string;
  photographerUrl: string;
  photoUrl: string;
};

type Query = { query: string; w?: number; h?: number };

/**
 * Search for photos across providers. Tries Unsplash first, then Pexels
 * for any queries that Unsplash didn't resolve (no result or API down).
 *
 * Returns a map of query → { result, source } or null.
 */
export async function searchPhotos(
  queries: Query[],
): Promise<
  Map<string, (SearchResult & { source: "unsplash" | "pexels" }) | null>
> {
  const results = new Map<
    string,
    (SearchResult & { source: "unsplash" | "pexels" }) | null
  >();

  if (queries.length === 0) return results;

  // --- Unsplash first ---
  const unsplashResults = await unsplashSearch(queries);

  const unresolved: Query[] = [];
  for (const q of queries) {
    const hit = unsplashResults.get(q.query);
    if (hit) {
      results.set(q.query, { ...hit, source: "unsplash" });
    } else {
      unresolved.push(q);
    }
  }

  if (unresolved.length === 0) return results;

  // --- Pexels for misses ---
  log.info("Falling back to Pexels for unresolved images", {
    count: unresolved.length,
  });

  const pexelsResults = await pexelsSearch(unresolved);

  for (const q of unresolved) {
    const hit = pexelsResults.get(q.query);
    results.set(q.query, hit ? { ...hit, source: "pexels" } : null);
  }

  return results;
}
