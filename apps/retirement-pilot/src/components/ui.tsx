import Link from "next/link";
import { Check, Phone, ArrowRight } from "lucide-react";
import { community } from "@/lib/content";

/* ───────────────────────── layout primitives ───────────────────────── */

export function Section({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={className}>
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        {children}
      </div>
    </section>
  );
}

export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-xs font-semibold uppercase tracking-[0.18em] text-forest ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Banner that opens every inner page. Sits below the fixed header (note the
 * extra top padding) and gives each route a consistent title treatment.
 */
export function PageHero({
  eyebrow,
  heading,
  lead,
}: {
  eyebrow: string;
  heading: string;
  lead?: string;
}) {
  return (
    <section className="border-b border-border bg-forest-soft">
      <div className="mx-auto max-w-6xl px-5 pt-32 pb-14 sm:px-8 sm:pt-36 sm:pb-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-serif text-4xl font-semibold leading-[1.07] tracking-tight text-forest-deep sm:text-5xl">
          {heading}
        </h1>
        {lead ? (
          <p className="mt-5 max-w-2xl text-lg text-ink/75 sm:text-xl">{lead}</p>
        ) : null}
      </div>
    </section>
  );
}

/* ───────────────────────── shared content blocks ───────────────────────── */

export function AmenityList({
  heading,
  items,
}: {
  heading: string;
  items: readonly string[];
}) {
  return (
    <div>
      <h3 className="font-serif text-lg font-semibold text-forest-deep">
        {heading}
      </h3>
      <ul className="mt-4 space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-3 text-ink/80">
            <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-forest/10 text-forest">
              <Check className="size-3.5" />
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ContactDetail({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-forest-soft text-forest">
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          {label}
        </p>
        <p className="mt-0.5 text-ink/85">{children}</p>
      </div>
    </div>
  );
}

/**
 * Closing call-to-action band shown near the bottom of every inner page,
 * pointing visitors to the contact page or a phone call.
 */
export function CtaBand({
  heading = "Come see Cedar Hollow for yourself",
  body = "The best way to know if a community is the right fit is to walk through the doors. We'd love to show you around.",
}: {
  heading?: string;
  body?: string;
}) {
  return (
    <section className="bg-forest-deep text-cream">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-20 text-center sm:px-8 sm:py-24">
        <h2 className="max-w-2xl font-serif text-3xl font-semibold sm:text-4xl">
          {heading}
        </h2>
        <p className="max-w-xl text-lg text-cream/85">{body}</p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/contact"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-gold px-7 py-3.5 text-base font-semibold text-forest-deep transition-colors hover:bg-gold/90"
          >
            Schedule a tour
            <ArrowRight className="size-5" />
          </Link>
          <a
            href={community.phoneHref}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-cream/40 bg-cream/5 px-7 py-3.5 text-base font-semibold text-cream backdrop-blur transition-colors hover:bg-cream/15"
          >
            <Phone className="size-5" />
            {community.phone}
          </a>
        </div>
      </div>
    </section>
  );
}
