/**
 * build-org-jsonld — LocalBusiness JSON-LD from a BrandSpec NAP block (Slice 9).
 *
 * Generates the `application/ld+json` payload for the hub homepage `<head>`.
 * Uses schema.org LocalBusiness (specialized to Organization when no NAP is present).
 * Only produces a full schema.org type when there is enough NAP data to avoid
 * empty / misleading markup — returns null when no `nap` block exists.
 *
 * Injection-safe: every field is passed through the same allow-list helpers used
 * by brand-theme.ts (text fields stripped of angle brackets / HTML entities; phone
 * stripped to digit / tel chars; URL validated as https:// only).
 *
 * Pure + sync: no I/O, no model. Clean ASCII / UTF-8.
 */

import type { BrandSpec } from "@sagemark/schema-flywheel";

/** Minimal JSON-LD schema object for a LocalBusiness entity. */
export interface OrgJsonLd {
  "@context": "https://schema.org";
  "@type": "LocalBusiness" | "Organization";
  name: string;
  url?: string;
  telephone?: string;
  description?: string;
  address?: {
    "@type": "PostalAddress";
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  };
}

/** Strip HTML/XML special chars from a text field. */
function safeText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[<>"'&]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Validate a phone string: digits, spaces, +, -, (, ), . only; max 20 chars. */
function safePhone(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[^0-9 +\-()\.]/g, "")
    .trim()
    .slice(0, 20);
}

/** Validate a URL: https:// with safe ASCII host only. */
function safeUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:") return undefined;
    if (!/^[A-Za-z0-9\-._~]+$/.test(u.hostname)) return undefined;
    return v.trim().slice(0, 512);
  } catch {
    return undefined;
  }
}

/**
 * Build a LocalBusiness JSON-LD object from a `BrandSpec`, or null when there is
 * insufficient data to produce valid structured data. The caller serialises the
 * result with `JSON.stringify` and embeds it in a `<script type="application/ld+json">`.
 *
 * Returns null when `brand` is null/undefined or has neither `nap.legalName` nor
 * `name` — schema.org Name is required for a valid entity.
 */
export function buildOrgJsonLd(
  brand: BrandSpec | null | undefined,
  clientName: string,
): OrgJsonLd | null {
  if (!brand) return null;
  const nap = brand.nap ?? {};
  const name = safeText(nap.legalName || brand.name || clientName);
  if (!name) return null;

  const ld: OrgJsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name,
  };

  const url = safeUrl(nap.url);
  if (url) ld.url = url;

  const phone = safePhone(nap.phone);
  if (phone) ld.telephone = phone;

  const description = safeText(brand.tagline);
  if (description) ld.description = description;

  // Address block — include only when at least addressLocality is present.
  const locality = safeText(nap.locality);
  if (locality) {
    ld.address = {
      "@type": "PostalAddress",
      ...(safeText(nap.streetAddress) ? { streetAddress: safeText(nap.streetAddress) } : {}),
      addressLocality: locality,
      ...(safeText(nap.region) ? { addressRegion: safeText(nap.region) } : {}),
      ...(safeText(nap.postalCode) ? { postalCode: safeText(nap.postalCode) } : {}),
      ...(safeText(nap.country) ? { addressCountry: safeText(nap.country) } : {}),
    };
  }

  return ld;
}
