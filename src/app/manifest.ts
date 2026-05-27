import type { MetadataRoute } from "next";

/**
 * PWA web app manifest.
 *
 * Note: For full PWA install support on mobile, add 192x192 and 512x512 PNG
 * icons to public/ and reference them here. Until then, the manifest is still
 * valid — it just won't trigger an Add-to-Home-Screen prompt.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WebsitePls — AI Website Generator",
    short_name: "WebsitePls",
    description:
      "Describe your website and generate it in seconds with AI.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#18181b",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
