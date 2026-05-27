import { getEncoding } from "js-tiktoken";

export interface ChunkOptions {
  maxTokens?: number;
  overlap?: number;
}

export interface Chunk {
  text: string;
  tokenCount: number;
  chunkIndex: number;
}

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP = 128;

/**
 * Split text into fixed-size token windows with overlap.
 *
 * Strategy (fixed, token-aware, no sentence-boundary detection):
 *   1. Encode the full text once with cl100k_base.
 *   2. Slide a window of `maxTokens` tokens across the stream, stepping by
 *      `maxTokens - overlap` tokens each iteration.
 *   3. Decode each window back to a string slice.
 *
 * Token-aware splitting is load-bearing: embedding providers charge by
 * token and enforce per-input token limits, so character-based chunking
 * would either underpack (wasting cost) or overflow (API errors).
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (maxTokens <= 0) throw new Error("maxTokens must be positive");
  if (overlap < 0 || overlap >= maxTokens) {
    throw new Error("overlap must satisfy 0 <= overlap < maxTokens");
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const encoding = getEncoding("cl100k_base");
  const tokens = encoding.encode(trimmed);
  if (tokens.length === 0) return [];

  const chunks: Chunk[] = [];
  const step = maxTokens - overlap;
  let start = 0;
  let chunkIndex = 0;

  while (start < tokens.length) {
    const end = Math.min(start + maxTokens, tokens.length);
    const window = tokens.slice(start, end);
    const decoded = encoding.decode(window).trim();
    if (decoded.length > 0) {
      chunks.push({
        text: decoded,
        tokenCount: window.length,
        chunkIndex,
      });
      chunkIndex += 1;
    }
    if (end === tokens.length) break;
    start += step;
  }

  return chunks;
}
