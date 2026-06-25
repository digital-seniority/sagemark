import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { careTypes, pages } from "@/lib/content";
import { Section, PageHero, CtaBand } from "@/components/ui";

export const metadata: Metadata = {
  title: "Care & Services",
  description:
    "Assisted living and respite care at Cedar Hollow — daily support with personal care, dining, and activities, with the right level of help when it's needed.",
};

export default function CarePage() {
  return (
    <>
      <PageHero
        eyebrow={pages.care.eyebrow}
        heading={pages.care.heading}
        lead={pages.care.lead}
      />

      <Section className="bg-cream">
        <div className="grid gap-8 md:grid-cols-2">
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
                <h2 className="font-serif text-2xl font-semibold text-forest-deep">
                  {care.name}
                </h2>
                <p className="mt-3 text-ink/75">{care.blurb}</p>
                <ul className="mt-5 space-y-2.5">
                  {care.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-3 text-ink/80">
                      <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-forest/10 text-forest">
                        <Check className="size-3.5" />
                      </span>
                      {pt}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/contact"
                  className="mt-6 inline-flex items-center gap-2 self-start text-sm font-semibold text-forest transition-colors hover:text-forest-deep"
                >
                  Ask about {care.name.toLowerCase()}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <CtaBand
        heading="Not sure which option is right?"
        body="Tell us a little about your situation and our team will help you find the level of care that fits — today and as needs change."
      />
    </>
  );
}
