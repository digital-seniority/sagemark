import type { Metadata } from "next";
import Image from "next/image";
import { activities, pages } from "@/lib/content";
import { Section, PageHero, CtaBand } from "@/components/ui";

export const metadata: Metadata = {
  title: "Life & Activities",
  description:
    "Life at Cedar Hollow — social and creative programs, celebrations and outings, wellness and faith. A calendar built around the things that bring residents joy.",
};

export default function LifePage() {
  return (
    <>
      <PageHero
        eyebrow={pages.life.eyebrow}
        heading={pages.life.heading}
        lead={pages.life.lead}
      />

      <Section className="bg-cream">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <p className="text-lg text-ink/75">{activities.body}</p>

            <div className="mt-8 space-y-6">
              {activities.groups.map((group) => (
                <div key={group.title}>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-forest">
                    {group.title}
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.items.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-forest-soft px-4 py-1.5 text-sm text-forest-deep"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl shadow-xl">
            <Image
              src={activities.image}
              alt="A resident enjoying the garden with a furry companion"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
