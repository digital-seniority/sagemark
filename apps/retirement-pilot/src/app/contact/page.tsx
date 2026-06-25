import type { Metadata } from "next";
import Image from "next/image";
import { Phone, MapPin } from "lucide-react";
import { community, pages } from "@/lib/content";
import { Section, PageHero, ContactDetail } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Schedule a visit to Cedar Hollow Senior Living in Pinehurst Valley. Call us or send a note and our team will help you plan a tour.",
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow={pages.contact.eyebrow}
        heading={pages.contact.heading}
        lead={pages.contact.lead}
      />

      <Section className="bg-cream">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-lg text-ink/75">
              The best way to know if a community is right is to walk through the
              doors. Tell us a little about what you&apos;re looking for and
              we&apos;ll set up a visit that works for you.
            </p>

            <div className="mt-8 space-y-5">
              <ContactDetail icon={<Phone className="size-5" />} label="Call us">
                <a
                  href={community.phoneHref}
                  className="font-semibold text-forest-deep hover:text-forest"
                >
                  {community.phone}
                </a>
              </ContactDetail>
              <ContactDetail
                icon={<MapPin className="size-5" />}
                label="Visit us"
              >
                {community.address.line1}, {community.address.city},{" "}
                {community.address.state} {community.address.zip}
              </ContactDetail>
            </div>

            <div className="mt-8 overflow-hidden rounded-3xl">
              <Image
                src="/images/exterior-overhead.jpg"
                alt="Aerial view of the Cedar Hollow community"
                width={1200}
                height={500}
                className="h-48 w-full object-cover"
              />
            </div>
          </div>

          <div className="rounded-3xl bg-white p-7 shadow-sm ring-1 ring-border sm:p-9">
            <ContactForm />
          </div>
        </div>
      </Section>
    </>
  );
}
