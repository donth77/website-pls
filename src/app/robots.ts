import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://websitepls.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/preview/"],
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
        disallow: ["/api/", "/preview/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
