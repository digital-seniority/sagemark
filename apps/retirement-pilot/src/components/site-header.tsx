"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Phone } from "lucide-react";
import { community, nav } from "@/lib/content";

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Only the home page has a dark, full-bleed hero behind the header.
  const onHome = pathname === "/";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Transparent only when floating over the home hero (not scrolled, menu
  // closed). Inner pages always get the solid, light header.
  const transparent = onHome && !scrolled && !open;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled || open
          ? "bg-cream/95 backdrop-blur border-b border-border"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:h-20 sm:px-8">
        {/* Wordmark */}
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className={`flex size-9 items-center justify-center rounded-full transition-colors ${
              transparent
                ? "bg-cream text-forest"
                : "bg-forest text-cream"
            }`}
          >
            <CedarMark className="size-5" />
          </span>
          <span
            className={`font-serif text-lg font-semibold leading-none tracking-tight transition-colors sm:text-xl ${
              transparent ? "text-cream" : "text-forest-deep"
            }`}
          >
            Cedar Hollow
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 lg:flex">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`text-sm font-medium transition-colors ${
                  transparent
                    ? "text-cream/90 hover:text-cream"
                    : active
                      ? "text-forest"
                      : "text-ink/75 hover:text-forest"
                } ${active ? "underline decoration-gold decoration-2 underline-offset-8" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href={community.phoneHref}
            className={`hidden items-center gap-2 text-sm font-semibold transition-colors sm:flex ${
              transparent ? "text-cream" : "text-forest-deep"
            }`}
          >
            <Phone className="size-4" />
            {community.phone}
          </a>
          <Link
            href="/contact"
            className={`hidden rounded-full px-5 py-2.5 text-sm font-semibold transition-colors sm:inline-block ${
              transparent
                ? "bg-cream text-forest-deep hover:bg-cream/90"
                : "bg-forest text-cream hover:bg-forest-deep"
            }`}
          >
            Schedule a tour
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className={`flex size-10 items-center justify-center rounded-full transition-colors lg:hidden ${
              transparent ? "text-cream" : "text-forest-deep"
            }`}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <nav className="border-t border-border bg-cream px-5 pb-6 pt-2 lg:hidden">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`block border-b border-border/60 py-3 text-base font-medium ${
                pathname === item.href ? "text-forest" : "text-ink/80"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/contact"
            onClick={() => setOpen(false)}
            className="mt-4 block rounded-full bg-forest px-5 py-3 text-center text-base font-semibold text-cream"
          >
            Schedule a tour
          </Link>
          <a
            href={community.phoneHref}
            className="mt-3 flex items-center justify-center gap-2 text-base font-semibold text-forest-deep"
          >
            <Phone className="size-4" />
            {community.phone}
          </a>
        </nav>
      )}
    </header>
  );
}

function CedarMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 2 7 9h3l-4 6h5v5h2v-5h5l-4-6h3z" />
    </svg>
  );
}
