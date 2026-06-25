import type { Metadata } from "next";
import Script from "next/script";
import { Fraunces, Inter } from "next/font/google";
import { community } from "@/lib/content";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${community.name} — ${community.tagline}`,
    template: `%s — ${community.name}`,
  },
  description:
    "Cedar Hollow Senior Living offers assisted living and respite care in Pinehurst Valley — a warm, supportive community with thoughtfully designed apartments, chef-prepared meals, and engaging daily activities.",
  openGraph: {
    title: community.name,
    description: `${community.tagline}. Assisted living & respite care in ${community.location}.`,
    type: "website",
    images: ["/images/hero.jpg"],
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="min-h-screen flex flex-col antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <Script
          src="https://embed.agewise.ai/v1/widget.js"
          data-tenant="946c5c8c-0180-40e9-be79-4f19f62da8b0"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
