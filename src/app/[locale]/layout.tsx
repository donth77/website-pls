import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { Geist, Geist_Mono } from "next/font/google";
import { routing, RTL_LOCALES } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { SessionProvider } from "@/components/auth/session-provider";
import { GlobalBar } from "@/components/global-bar";
import "../globals.css";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://websitepls.com";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return {
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
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
    },
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((l) => [
          l,
          l === routing.defaultLocale ? "/" : `/${l}`,
        ]),
      ),
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
  const messages = await getMessages();
  const dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
              url: `${BASE_URL}/${locale}`,
              description:
                "AI-powered website generator. Describe a website in plain language and get a fully built, responsive web page in seconds.",
              applicationCategory: "DesignApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              inLanguage: routing.locales,
            }),
          }}
        />
        <NextIntlClientProvider messages={messages}>
          <SessionProvider>
            <SkipLink />
            <GlobalBar />
            <main id="main-content" className="min-h-0 flex-1 overflow-auto">
              {children}
            </main>
          </SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
