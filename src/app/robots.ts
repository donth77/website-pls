import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://websitepls.com";

// Auth-gated or non-content surfaces — no SEO value, and crawling them just
// wastes crawl budget. /preview/ is token-gated; /admin/, /settings/, /projects/
// require sign-in.
const DISALLOW = ["/api/", "/preview/", "/admin/", "/settings/", "/projects/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
      // Explicitly welcome AI crawlers
      {
        userAgent: [
          "GPTBot",
          "ChatGPT-User",
          "Claude-Web",
          "Applebot-Extended",
          "PerplexityBot",
          "Bytespider",
        ],
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
