import { searchPhotos as unsplashSearch } from "./unsplash";
import { searchPhotos as pexelsSearch } from "./pexels";
import { searchPhotos as pixabaySearch } from "./pixabay";
import { createLogger } from "@/lib/logger";

const log = createLogger("image-search");

export type ImageSource = "unsplash" | "pexels" | "pixabay";

export type ImageAttribution = {
  photographerName: string;
  photographerUrl: string;
  photoUrl: string;
  source: ImageSource;
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
): Promise<Map<string, (SearchResult & { source: ImageSource }) | null>> {
  const results = new Map<
    string,
    (SearchResult & { source: ImageSource }) | null
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

  const stillUnresolved: Query[] = [];
  for (const q of unresolved) {
    const hit = pexelsResults.get(q.query);
    if (hit) {
      results.set(q.query, { ...hit, source: "pexels" });
    } else {
      stillUnresolved.push(q);
    }
  }

  if (stillUnresolved.length === 0) return results;

  // --- Pixabay for remaining misses ---
  log.info("Falling back to Pixabay for unresolved images", {
    count: stillUnresolved.length,
  });

  const pixabayResults = await pixabaySearch(stillUnresolved);

  for (const q of stillUnresolved) {
    const hit = pixabayResults.get(q.query);
    results.set(q.query, hit ? { ...hit, source: "pixabay" } : null);
  }

  return results;
}
