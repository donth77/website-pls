import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { locales } from "@/i18n/routing";

/**
 * Slug validation + generation for published sites.
 *
 * A slug is the URL identifier at `/p/{slug}`. Rules:
 *   - lowercase ASCII letters, digits, hyphens
 *   - 3–48 characters
 *   - no leading/trailing hyphen
 *   - not in the reserved list
 *
 * The reserved list covers app routes (`api`, `login`, `settings`, …) plus
 * every locale code from `src/i18n/routing.ts`, so adding a new locale
 * automatically reserves its slug. Homoglyph attacks are blocked by the
 * ASCII-only charset.
 */

const MIN_LENGTH = 3;
const MAX_LENGTH = 48;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

/**
 * Paths that must never be claimable as a slug. Lowercase only.
 *
 * Additions should be narrow: reserving a common word also bans legitimate
 * users from using it. Only list slugs that would actually collide with a
 * route or break assumptions elsewhere in the app.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Top-level app paths
  "api",
  "p",
  "preview",
  "login",
  "signup",
  "logout",
  "settings",
  "terms",
  "privacy",
  "auth",
  "admin",
  "dashboard",
  "account",
  "help",
  "docs",
  "blog",
  "about",
  // Framework / infrastructure
  "_next",
  "_vercel",
  "favicon",
  "robots",
  "sitemap",
  "llms",
  // Every i18n locale code — a new locale automatically reserves its slug
  ...locales,
]);

export type SlugValidationError =
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "reserved";

export interface SlugValidationResult {
  ok: boolean;
  error?: SlugValidationError;
  message?: string;
}

/** Validate a user-supplied slug against format + reserved-list rules. */
export function validateSlug(slug: string): SlugValidationResult {
  if (slug.length < MIN_LENGTH) {
    return {
      ok: false,
      error: "too_short",
      message: `Must be at least ${MIN_LENGTH} characters.`,
    };
  }
  if (slug.length > MAX_LENGTH) {
    return {
      ok: false,
      error: "too_long",
      message: `Must be ${MAX_LENGTH} characters or fewer.`,
    };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: "invalid_chars",
      message:
        "Use lowercase letters, numbers, and hyphens only. No leading or trailing hyphen.",
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return {
      ok: false,
      error: "reserved",
      message: "That URL is reserved. Try another.",
    };
  }
  return { ok: true };
}

/**
 * Generate a random 8-character lowercase-alphanumeric slug.
 *
 * Uses `crypto.randomBytes` + base64url, strips the `-` and `_` characters
 * that base64url emits (they'd be valid in a slug but look ugly when
 * auto-generated), lowercases, and takes the first 8 characters. Retries
 * if stripping leaves fewer than 8 characters.
 *
 * Collision space: ~36^8 ≈ 2.8 trillion. The DB unique index is still the
 * final authority on uniqueness — this function is just the candidate.
 */
export function generateSlug(): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = randomBytes(12)
      .toString("base64url")
      .replace(/[_-]/g, "")
      .toLowerCase()
      .slice(0, 8);
    if (candidate.length === 8 && /^[a-z0-9]{8}$/.test(candidate)) {
      return candidate;
    }
  }
  // Extraordinarily unlikely: 10 consecutive calls to randomBytes(12) each
  // failing to yield 8 alphanumerics after stripping. Fall back to a
  // timestamp-based slug rather than throwing.
  return `s${Date.now().toString(36)}`.slice(0, 8);
}

/**
 * Generate a slug that doesn't already exist in `PublishedSite`.
 *
 * Tries up to 3 times, checking the DB between attempts. The final insert
 * still relies on the `@unique` index on `PublishedSite.subdomain` — this
 * is just a best-effort to avoid hitting a 409 on the happy path.
 *
 * Collision probability with a 2.8T address space and a small active-slug
 * population is vanishingly low, so 3 retries is ample.
 */
export async function generateUniqueSlug(): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateSlug();
    const existing = await prisma.publishedSite.findUnique({
      where: { subdomain: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // All 3 attempts collided. Return the last candidate anyway and let
  // the insert's P2002 path handle it — the caller already knows how.
  return generateSlug();
}
