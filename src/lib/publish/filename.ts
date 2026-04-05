/**
 * Sanitize a project name into a safe filename base.
 *
 * The result is interpolated into `Content-Disposition: attachment;
 * filename="..."`, which means any character that could inject CRLF or
 * close the quoted value would be a header-injection bug. This function
 * strips to `[a-z0-9-]` which makes injection impossible by construction.
 *
 * Used by both the server (export route) and the client (download button)
 * so the filename a user sees matches the one the server would generate.
 *
 *   buildDownloadFilename("Sunrise Café ☕")  → "sunrise-cafe"
 *   buildDownloadFilename("")                 → "website"
 *   buildDownloadFilename(null)               → "website"
 *   buildDownloadFilename('"; X-Evil: yes')   → "x-evil-yes"
 */
const FALLBACK = "website";

export function buildDownloadFilename(name: string | null | undefined): string {
  if (!name) return FALLBACK;

  const cleaned = name
    // Decompose so we can strip diacritics (é → e + combining mark → e)
    .normalize("NFKD")
    // Strip combining marks (Mn = Mark, Nonspacing)
    .replace(/\p{M}/gu, "")
    // Strip emoji and pictographs
    .replace(/\p{Extended_Pictographic}/gu, "")
    .toLowerCase()
    // Collapse every run of non-alphanumerics into a single hyphen
    .replace(/[^a-z0-9]+/g, "-")
    // Trim leading/trailing hyphens
    .replace(/^-+|-+$/g, "");

  return cleaned || FALLBACK;
}
