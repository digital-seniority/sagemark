/**
 * Topbar — branded site header for the hub (Slice 9).
 * Uses CSS vars emitted by buildBrandStyleTag; no Tailwind (the hub carries its own theme).
 * Server component (no "use client"); the mobile nav toggle is in HubScripts.
 */

import type { BrandSpec } from "@sagemark/schema-flywheel";

interface TopbarProps {
  brand: BrandSpec | null;
  clientName: string;
  clientSlug: string;
}

export function Topbar({ brand, clientName, clientSlug }: TopbarProps) {
  const logo = brand?.logo;
  const nap = brand?.nap;
  const phone = nap?.phone?.replace(/[^0-9+\-\(\) \.]/g, "").trim() ?? null;
  const tagline = brand?.tagline ?? null;

  return (
    <header
      data-role="hub-topbar"
      style={{
        background: "var(--brand-color, #3d5446)",
        color: "#fff",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      <div
        style={{
          maxWidth: "1180px",
          margin: "0 auto",
          padding: "0 1.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: "60px",
          gap: "1rem",
        }}
      >
        {/* Brand badge */}
        <a
          href={`/clients/${clientSlug}`}
          aria-label={`${clientName} home`}
          data-role="hub-brand"
          style={{ display: "flex", alignItems: "center", gap: "0.75rem", textDecoration: "none", color: "inherit" }}
        >
          {logo?.url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logo.url}
              alt={logo.alt ?? clientName}
              height={36}
              style={{ maxHeight: "36px", width: "auto", display: "block" }}
            />
          ) : (
            <span style={{ fontFamily: "var(--brand-heading-font, serif)", fontWeight: 600, fontSize: "1.1rem" }}>
              {clientName}
            </span>
          )}
          {tagline ? (
            <span style={{ fontSize: "0.75rem", opacity: 0.8, display: "none" }} className="hub-tagline">
              {tagline}
            </span>
          ) : null}
        </a>

        {/* Mobile nav toggle (behaviour injected by HubScripts) */}
        <button
          id="hub-nav-toggle"
          aria-label="Menu"
          aria-expanded="false"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "inherit",
            display: "none",
            padding: "0.25rem",
          }}
          className="hub-nav-toggle"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </button>

        {/* Primary nav */}
        <nav
          id="hub-nav"
          data-role="hub-nav"
          style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}
        >
          {phone ? (
            <a
              href={`tel:${phone.replace(/\s/g, "")}`}
              data-role="hub-phone-cta"
              style={{
                background: "var(--brand-accent, #c08a4e)",
                color: "#fff",
                padding: "0.4rem 1rem",
                borderRadius: "6px",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "0.875rem",
                whiteSpace: "nowrap",
              }}
            >
              {phone}
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
