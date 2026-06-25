import Link from "next/link";
import { Phone, MapPin, Mail } from "lucide-react";
import { community, nav } from "@/lib/content";

export function SiteFooter() {
  return (
    <footer className="bg-forest-deep text-cream">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-3">
        <div>
          <Link href="/" className="font-serif text-2xl font-semibold">
            {community.name}
          </Link>
          <p className="mt-3 max-w-xs text-sm text-cream/70">
            {community.tagline}. A welcoming community where independence and
            support come together.
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-cream/60">
            Explore
          </h3>
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm text-cream/80 transition-colors hover:text-cream"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-cream/60">
            Visit us
          </h3>
          <ul className="mt-4 space-y-3 text-sm text-cream/85">
            <li className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 size-4 shrink-0 text-gold" />
              <span>
                {community.address.line1}
                <br />
                {community.address.city}, {community.address.state}{" "}
                {community.address.zip}
              </span>
            </li>
            <li>
              <a
                href={community.phoneHref}
                className="flex items-center gap-2.5 transition-colors hover:text-cream"
              >
                <Phone className="size-4 shrink-0 text-gold" />
                {community.phone}
              </a>
            </li>
            <li>
              <a
                href={`mailto:${community.email}`}
                className="flex items-center gap-2.5 transition-colors hover:text-cream"
              >
                <Mail className="size-4 shrink-0 text-gold" />
                {community.email}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-cream/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-cream/55 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>
            © {2026} {community.name}. All rights reserved.
          </p>
          <p className="text-cream/45">
            Demo / pilot site — community and details are fictional.
          </p>
        </div>
      </div>
    </footer>
  );
}
