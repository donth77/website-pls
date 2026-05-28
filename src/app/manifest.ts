import type { MetadataRoute } from "next";

/**
 * PWA web app manifest. Icons (192/512 PNG) live in public/ and are
 * generated from src/app/icon.svg — see that file to change the mark.
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
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
