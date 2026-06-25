import type { Metadata } from "next";
import Image from "next/image";
import { amenities, pages } from "@/lib/content";
import { Section, PageHero, AmenityList, CtaBand } from "@/components/ui";

export const metadata: Metadata = {
  title: "Amenities",
  description:
    "Everything you need at Cedar Hollow, thoughtfully included — chef-prepared meals, housekeeping, 24-hour support, a courtyard bird sanctuary, salon, library, and more.",
};

export default function AmenitiesPage() {
  return (
    <>
      <PageHero
        eyebrow={pages.amenities.eyebrow}
        heading={pages.amenities.heading}
        lead={pages.amenities.lead}
      />

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

          <div className="order-1 lg:order-2 grid gap-8 sm:grid-cols-2">
            <AmenityList
              heading={amenities.included.heading}
              items={amenities.included.items}
            />
            <AmenityList
              heading={amenities.onSite.heading}
              items={amenities.onSite.items}
            />
          </div>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
