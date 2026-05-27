import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import {
  Geist,
  Geist_Mono,
  Playfair_Display,
  Instrument_Serif,
} from "next/font/google";
import { routing, RTL_LOCALES } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { auth } from "@/lib/auth/authOptions";
import { SessionProvider } from "@/components/auth/session-provider";
import { Header } from "@/components/header";
import { VerifyEmailBanner } from "@/components/auth/verify-email-banner";
import { Toaster } from "sonner";
import "../globals.css";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://websitepls.com";

// Maps next-intl locale codes to OpenGraph BCP-47-style locales. Used for
// og:locale and og:locale:alternate so social platforms render previews in the
// right language/region.
const OG_LOCALES: Record<string, string> = {
  en: "en_US",
  zh: "zh_CN",
  es: "es_ES",
  ar: "ar_AR",
  pt: "pt_BR",
  fr: "fr_FR",
  de: "de_DE",
  ja: "ja_JP",
  ru: "ru_RU",
  ko: "ko_KR",
  hi: "hi_IN",
  it: "it_IT",
  tr: "tr_TR",
  nl: "nl_NL",
  pl: "pl_PL",
  vi: "vi_VN",
  th: "th_TH",
  id: "id_ID",
  uk: "uk_UA",
  sv: "sv_SE",
};

function canonicalFor(locale: string): string {
  return locale === routing.defaultLocale ? BASE_URL : `${BASE_URL}/${locale}`;
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });

  const ogLocale = OG_LOCALES[locale] ?? "en_US";
  const alternateLocales = routing.locales
    .filter((l) => l !== locale)
    .map((l) => OG_LOCALES[l] ?? "en_US");

  return {
    metadataBase: new URL(BASE_URL),
    title: {
      default: t("title"),
      template: `%s | ${t("siteName")}`,
    },
    description: t("description"),
    openGraph: {
      title: t("title"),
      description: t("description"),
      siteName: t("siteName"),
      type: "website",
      url: canonicalFor(locale),
      locale: ogLocale,
      alternateLocale: alternateLocales,
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 625,
          alt: t("title"),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: ["/og-image.png"],
    },
    alternates: {
      canonical: canonicalFor(locale),
      languages: {
        ...Object.fromEntries(
          routing.locales.map((l) => [l, canonicalFor(l)]),
        ),
        // x-default: which URL Google should surface when no locale matches.
        "x-default": canonicalFor(routing.defaultLocale),
      },
    },
  };
}

function SkipLink() {
  const t = useTranslations("A11y");
  return (
    <a
      href="#main-content"
      className="sr-only fixed top-2 left-2 z-[100] rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-lg focus:not-sr-only focus:ring-2 focus:ring-indigo-500 focus:outline-none"
    >
      {t("skipToContent")}
    </a>
  );
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const [messages, session] = await Promise.all([getMessages(), auth()]);
  const dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${instrumentSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex h-dvh flex-col" suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "WebsitePls",
              url: canonicalFor(locale),
              description:
                "AI-powered website generator. Describe a website in plain language and get a fully built, responsive web page in seconds.",
              applicationCategory: "DesignApplication",
              operatingSystem: "Web",
              image: `${BASE_URL}/og-image.png`,
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              inLanguage: locale,
            }),
          }}
        />
        <NextIntlClientProvider messages={messages}>
          <SessionProvider session={session}>
            <SkipLink />
            <Header />
            <VerifyEmailBanner />
            <main id="main-content" className="min-h-0 flex-1 overflow-auto">
              {children}
            </main>
            <Toaster
              position="bottom-right"
              toastOptions={{
                classNames: {
                  toast:
                    "border border-zinc-200 bg-white text-zinc-900 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
                  description: "text-zinc-500 dark:text-zinc-400",
                  error:
                    "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
                },
              }}
            />
          </SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
