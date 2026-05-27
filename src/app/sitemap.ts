import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://websitepls.com";

/** Update this date when page content meaningfully changes. */
const LAST_CONTENT_UPDATE = new Date("2026-04-03");

/** English (default locale) has no prefix; others get /{locale}. */
function localePath(locale: string, page: string): string {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${BASE_URL}${prefix}${page === "/" ? "" : page}`;
}

/**
 * Indexable pages. Auth-walled routes (/login, /signup, /forgot-password,
 * /reset-password, /projects, /settings) are intentionally excluded — they have
 * no SEO value and crawling them wastes budget.
 */
const PAGES = ["/", "/privacy", "/terms"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.flatMap((page) =>
    routing.locales.map((locale) => ({
      url: localePath(locale, page),
      lastModified: LAST_CONTENT_UPDATE,
      alternates: {
        languages: {
          ...Object.fromEntries(
            routing.locales.map((l) => [l, localePath(l, page)]),
          ),
          // x-default tells Google which URL to surface when no locale matches.
          "x-default": localePath(routing.defaultLocale, page),
        },
      },
    })),
  );
}
