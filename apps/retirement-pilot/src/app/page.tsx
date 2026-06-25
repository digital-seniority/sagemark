import Image from "next/image";
import Link from "next/link";
import {
  Check,
  Phone,
  MapPin,
  Award,
  PawPrint,
  Quote,
  ArrowRight,
} from "lucide-react";
import {
  community,
  hero,
  about,
  careTypes,
  amenities,
  testimonials,
} from "@/lib/content";
import { Section, Eyebrow, CtaBand } from "@/components/ui";

export default function HomePage() {
  return (
    <>
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="relative isolate flex min-h-[88vh] items-center overflow-hidden">
        <Image
          src="/images/hero.jpg"
          alt="The grounds at Cedar Hollow Senior Living"
          fill
          priority
          sizes="100vw"
          className="-z-20 object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-forest-deep/85 via-forest-deep/60 to-forest-deep/25" />

        <div className="mx-auto w-full max-w-6xl px-5 pt-24 pb-16 sm:px-8">
          <div className="max-w-2xl text-cream">
            <span className="inline-flex items-center gap-2 rounded-full bg-cream/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] backdrop-blur">
              {hero.eyebrow}
            </span>
            <h1 className="mt-6 font-serif text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              {hero.heading}
            </h1>
            <p className="mt-6 max-w-xl text-lg text-cream/90 sm:text-xl">
              {hero.subheading}
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href={hero.primaryCta.href}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-gold px-7 py-3.5 text-base font-semibold text-forest-deep transition-colors hover:bg-gold/90"
              >
                {hero.primaryCta.label}
                <ArrowRight className="size-5" />
              </Link>
              <Link
                href={hero.secondaryCta.href}
                className="inline-flex items-center justify-center rounded-full border border-cream/40 bg-cream/5 px-7 py-3.5 text-base font-semibold text-cream backdrop-blur transition-colors hover:bg-cream/15"
              >
                {hero.secondaryCta.label}
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-cream/85">
              <span className="inline-flex items-center gap-2">
                <Award className="size-5 text-gold" />
                {community.award.title}
              </span>
              <span className="inline-flex items-center gap-2">
                <MapPin className="size-5 text-gold" />
                {community.location}
              </span>
              <a
                href={community.phoneHref}
                className="inline-flex items-center gap-2 font-semibold"
              >
                <Phone className="size-5 text-gold" />
                {community.phone}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── ABOUT TEASER ───────────────────────── */}
      <Section className="bg-cream">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow>{about.eyebrow}</Eyebrow>
            <h2 className="mt-3 max-w-md font-serif text-3xl font-semibold text-forest-deep sm:text-4xl">
              {about.heading}
            </h2>
            <p className="mt-6 text-lg text-ink/80">{about.body[0]}</p>
            <div className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-gold-soft px-5 py-3.5 text-sm font-medium text-forest-deep">
              <PawPrint className="size-5 text-gold" />
              Small dogs and cats are warmly welcome
            </div>
            <div className="mt-8">
              <Link
                href="/about"
                className="inline-flex items-center gap-2 text-sm font-semibold text-forest transition-colors hover:text-forest-deep"
              >
                More about Cedar Hollow
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-xl">
              <Image
                src="/images/exterior-front.jpg"
                alt="The Cedar Hollow community building"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </div>
            <div className="absolute -bottom-6 -left-6 hidden w-40 rounded-2xl bg-forest p-5 text-cream shadow-lg sm:block">
              <p className="font-serif text-3xl font-semibold">15+</p>
              <p className="mt-1 text-xs text-cream/80">
                years caring for Pinehurst Valley families
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ───────────────────────── CARE PREVIEW ───────────────────────── */}
      <Section className="bg-forest-soft">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <Eyebrow>Services &amp; care</Eyebrow>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-forest-deep sm:text-4xl">
              The right level of support, exactly when it&apos;s needed
            </h2>
          </div>
          <Link
            href="/care"
            className="inline-flex items-center gap-2 text-sm font-semibold text-forest transition-colors hover:text-forest-deep"
          >
            View all care options
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {careTypes.map((care) => (
            <article
              key={care.slug}
              className="flex flex-col overflow-hidden rounded-3xl bg-cream shadow-sm ring-1 ring-border"
            >
              <div className="relative aspect-[16/10] overflow-hidden">
                <Image
                  src={care.image}
                  alt={care.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                />
              </div>
              <div className="flex flex-1 flex-col p-7">
                <h3 className="font-serif text-2xl font-semibold text-forest-deep">
                  {care.name}
                </h3>
                <p className="mt-3 text-ink/75">{care.blurb}</p>
                <Link
                  href="/care"
                  className="mt-6 inline-flex items-center gap-2 self-start text-sm font-semibold text-forest transition-colors hover:text-forest-deep"
                >
                  Learn more about {care.name.toLowerCase()}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* ───────────────────────── AMENITIES TEASER ───────────────────────── */}
      <Section className="bg-cream">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
          <div className="relative order-2 lg:order-1">
            <div className="relative aspect-[5/4] overflow-hidden rounded-3xl shadow-xl">
              <Image
                src="/images/community-life.jpg"
                alt="Residents enjoying community life at Cedar Hollow"
                fill
                sizes="(max-width: 1024px) 100vw, 45vw"
                className="object-cover"
              />
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <Eyebrow>Amenities &amp; life</Eyebrow>
            <h2 className="mt-3 font-serif text-3xl font-semibold text-forest-deep sm:text-4xl">
              Everything you need, thoughtfully included
            </h2>
            <p className="mt-4 text-lg text-ink/75">
              Three chef-prepared meals a day, weekly housekeeping, a courtyard
              bird sanctuary, and a calendar full of things to look forward to —
              it&apos;s all part of life here.
            </p>
            <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {amenities.included.items.slice(0, 4).map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 text-ink/80"
                >
                  <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-forest/10 text-forest">
                    <Check className="size-3.5" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
              <Link
                href="/amenities"
                className="inline-flex items-center gap-2 text-sm font-semibold text-forest transition-colors hover:text-forest-deep"
              >
                Explore amenities
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/life"
                className="inline-flex items-center gap-2 text-sm font-semibold text-forest transition-colors hover:text-forest-deep"
              >
                See daily life
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </Section>

      {/* ───────────────────────── TESTIMONIALS ───────────────────────── */}
      <Section className="bg-forest-deep text-cream">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow className="text-gold">What families say</Eyebrow>
          <h2 className="mt-3 font-serif text-3xl font-semibold sm:text-4xl">
            Loved by residents and the people who love them
          </h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <figure
              key={t.name}
              className="flex flex-col rounded-3xl bg-cream/5 p-7 ring-1 ring-cream/15"
            >
              <Quote className="size-8 text-gold" />
              <blockquote className="mt-4 flex-1 text-cream/90">
                “{t.quote}”
              </blockquote>
              <figcaption className="mt-6">
                <p className="font-semibold">{t.name}</p>
                <p className="text-sm text-cream/60">{t.relation}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
