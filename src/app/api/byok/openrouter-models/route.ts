import { NextResponse } from "next/server";
import { getStructuredOutputModels } from "@/lib/byok/openrouter-models";

/**
 * GET /api/byok/openrouter-models
 *
 * Returns the cached, structured-output-capable OpenRouter model list
 * so the BYOK UI can populate its model picker without each client
 * hitting OpenRouter directly. Public — no auth needed; the list itself
 * is public information.
 *
 * Response is HTTP-cached for an hour to match the server-side cache TTL.
 */
export async function GET() {
  try {
    const models = await getStructuredOutputModels();
    return NextResponse.json(
      { models },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fetch failed." },
      { status: 502 },
    );
  }
}
