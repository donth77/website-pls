import { defineRouting } from "next-intl/routing";

export const locales = [
  "en",
  "zh",
  "es",
  "ar",
  "pt",
  "fr",
  "de",
  "ja",
  "ru",
  "ko",
  "hi",
  "it",
  "tr",
  "nl",
  "pl",
  "vi",
  "th",
  "id",
  "uk",
  "sv",
] as const;

export type Locale = (typeof locales)[number];

export const RTL_LOCALES: ReadonlySet<string> = new Set(["ar"]);

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
});
