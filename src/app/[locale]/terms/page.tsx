import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://websitepls.com";

function urlFor(locale: string): string {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${BASE_URL}${prefix}/terms`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Terms" });
  const canonical = urlFor(locale);

  return {
    title: t("heading"),
    openGraph: {
      title: t("heading"),
      url: canonical,
      type: "article",
    },
    twitter: {
      title: t("heading"),
    },
    alternates: {
      canonical,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, urlFor(l)])),
        "x-default": urlFor(routing.defaultLocale),
      },
    },
  };
}

export default function TermsPage() {
  const t = useTranslations("Terms");

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("heading")}
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {t("lastUpdated")}
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <p>{t("placeholder")}</p>
      </div>
    </div>
  );
}
