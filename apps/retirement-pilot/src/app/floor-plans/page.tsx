import type { Metadata } from "next";
import Image from "next/image";
import { floorplans, pages } from "@/lib/content";
import { Section, PageHero, CtaBand } from "@/components/ui";

export const metadata: Metadata = {
  title: "Floor Plans",
  description:
    "Studio, large studio, and two-bedroom apartments at Cedar Hollow — thoughtfully designed homes with assisted living starting at $2,799 / month.",
};

export default function FloorPlansPage() {
  return (
    <>
      <PageHero
        eyebrow={pages.floorplans.eyebrow}
        heading={pages.floorplans.heading}
        lead={pages.floorplans.lead}
      />

      <Section className="bg-cream">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <p className="max-w-xl text-lg text-ink/75">
            Every apartment includes the full range of Cedar Hollow services and
            amenities — choose the layout that suits the life you want to live.
          </p>
          <span className="rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-cream">
            {floorplans.startingNote}
          </span>
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {floorplans.plans.map((plan) => (
            <article
              key={plan.name}
              className="overflow-hidden rounded-3xl bg-cream shadow-sm ring-1 ring-border"
            >
              <div className="relative aspect-[4/3] bg-white">
                <Image
                  src={plan.image}
                  alt={`${plan.name} floor plan`}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-contain p-4"
                />
              </div>
              <div className="border-t border-border p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-serif text-xl font-semibold text-forest-deep">
                    {plan.name}
                  </h2>
                  <span className="text-sm font-semibold text-gold">
                    {plan.sqft}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink/70">{plan.description}</p>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <CtaBand
        heading="Find the right apartment for you"
        body="Pricing and availability change often. Reach out and we'll share current openings and set up a time to tour the floor plans in person."
      />
    </>
  );
}
