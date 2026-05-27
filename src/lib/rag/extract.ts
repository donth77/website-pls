import { extractText as extractPdfText } from "unpdf";
import { getEncoding } from "js-tiktoken";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_TOKENS_POST_EXTRACTION = 100_000;

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export class UnsupportedMimeTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported mime type: ${mimeType}`);
    this.name = "UnsupportedMimeTypeError";
  }
}

export class FileTooLargeError extends Error {
  constructor(size: number) {
    super(
      `File too large: ${size} bytes (max ${MAX_FILE_SIZE_BYTES} bytes / 10 MB)`,
    );
    this.name = "FileTooLargeError";
  }
}

export interface ExtractResult {
  text: string;
  tokenCount: number;
  truncated: boolean;
}

/**
 * Extract text from a buffer and cap the total token count.
 *
 * Truncation is non-fatal: we log and return the truncated text. A huge
 * reference document should not block generation — the user still gets
 * their site, just with fewer chunks indexed. The hard ceiling exists
 * to bound embedding-provider spend per file.
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractResult> {
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(buffer.byteLength);
  }
  if (!isSupportedMimeType(mimeType)) {
    throw new UnsupportedMimeTypeError(mimeType);
  }

  const raw = await rawExtract(buffer, mimeType);
  return capTokens(raw);
}

function isSupportedMimeType(mimeType: string): mimeType is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType);
}

async function rawExtract(
  buffer: Buffer,
  mimeType: SupportedMimeType,
): Promise<string> {
  if (mimeType === "application/pdf") {
    const uint8 = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    const { text } = await extractPdfText(uint8, { mergePages: true });
    return text;
  }
  return buffer.toString("utf-8");
}

function capTokens(text: string): ExtractResult {
  const encoding = getEncoding("cl100k_base");
  const tokens = encoding.encode(text);

  if (tokens.length <= MAX_TOKENS_POST_EXTRACTION) {
    return { text, tokenCount: tokens.length, truncated: false };
  }

  const cappedTokens = tokens.slice(0, MAX_TOKENS_POST_EXTRACTION);
  const cappedText = encoding.decode(cappedTokens);
  return {
    text: cappedText,
    tokenCount: cappedTokens.length,
    truncated: true,
  };
}
