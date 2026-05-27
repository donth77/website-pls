/**
 * OpenRouter model allowlist with a one-hour in-memory cache.
 *
 * Filters /api/v1/models to entries whose `supported_parameters` includes
 * `"structured_outputs"` — the orchestrator's JSON-schema path requires it,
 * and exposing non-structured models would mean users can pick something
 * that will silently fail mid-generation.
 *
 * No auth needed to read the public list. We cache per server process; a
 * stale list on the worker just means a model that was added in the last
 * hour won't appear in the picker yet.
 */

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

interface RawModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const ENDPOINT = "https://openrouter.ai/api/v1/models";

let cache: { fetchedAt: number; models: OpenRouterModel[] } | null = null;
let inflight: Promise<OpenRouterModel[]> | null = null;

export async function getStructuredOutputModels(): Promise<OpenRouterModel[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models;
  }
  // Coalesce concurrent callers so we only hit OpenRouter once per refresh.
  if (inflight) return inflight;
  inflight = fetchAndCache();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function fetchAndCache(): Promise<OpenRouterModel[]> {
  const res = await fetch(ENDPOINT, {
    headers: { Accept: "application/json" },
    // Be generous: list is ~few hundred KB.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Fall back to stale cache rather than throwing — better to show
    // yesterday's list than break the picker entirely.
    if (cache) return cache.models;
    throw new Error(`OpenRouter models fetch failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: RawModel[] };
  const raw = json.data ?? [];
  const filtered: OpenRouterModel[] = raw
    .filter((m) => m.supported_parameters?.includes("structured_outputs"))
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      context_length: m.context_length,
      pricing: m.pricing,
    }))
    // Stable ordering so the picker doesn't shuffle between refreshes.
    .sort((a, b) => a.name.localeCompare(b.name));
  cache = { fetchedAt: Date.now(), models: filtered };
  return filtered;
}

/** Server-side check: is this model in the current structured-output allowlist? */
export async function isAllowedOpenRouterModel(id: string): Promise<boolean> {
  const models = await getStructuredOutputModels();
  return models.some((m) => m.id === id);
}
