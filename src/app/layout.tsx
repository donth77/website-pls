// Root layout is a pass-through — the [locale] layout renders <html>.
// This file exists only because Next.js requires a root layout.

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
