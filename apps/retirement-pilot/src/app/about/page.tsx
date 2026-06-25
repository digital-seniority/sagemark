import type { Metadata } from "next";
import Image from "next/image";
import { Check, PawPrint } from "lucide-react";
import { about, pages } from "@/lib/content";
import { Section, PageHero, CtaBand } from "@/components/ui";

export const metadata: Metadata = {
  title: "About",
  description:
    "Cedar Hollow Senior Living has cared for Pinehurst Valley families for more than 15 years — a homelike setting where independence and support come together.",
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow={pages.about.eyebrow}
        heading={pages.about.heading}
        lead={pages.about.lead}
      />

      <Section className="bg-cream">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="max-w-md font-serif text-3xl font-semibold text-forest-deep sm:text-4xl">
              {about.heading}
            </h2>
            <div className="mt-6 space-y-4 text-lg text-ink/80">
              {about.body.map((p) => (
                <p key={p.slice(0, 24)}>{p}</p>
              ))}
            </div>
            <ul className="mt-8 space-y-3">
              {about.highlights.map((h) => (
                <li key={h} className="flex items-start gap-3">
                  <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-forest text-cream">
                    <Check className="size-3.5" />
                  </span>
                  <span className="text-ink/80">{h}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 inline-flex items-center gap-3 rounded-2xl bg-gold-soft px-5 py-3.5 text-sm font-medium text-forest-deep">
              <PawPrint className="size-5 text-gold" />
              Small dogs and cats are warmly welcome
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

      <CtaBand />
    </>
  );
}
