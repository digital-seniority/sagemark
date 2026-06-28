/**
 * Footer — branded site footer for the hub (Slice 9).
 * Server component. Uses CSS vars from buildBrandStyleTag.
 */

import type { BrandSpec } from "@sagemark/schema-flywheel";

interface FooterProps {
  brand: BrandSpec | null;
  clientName: string;
  clientSlug: string;
}

export function Footer({ brand, clientName, clientSlug: _slug }: FooterProps) {
  const nap = brand?.nap;
  const phone = nap?.phone?.replace(/[^0-9+\-\(\) \.]/g, "").trim() ?? null;
  const email = typeof nap?.email === "string" ? nap.email.replace(/[<>"']/g, "") : null;
  const locality = nap?.locality ?? null;
  const region = nap?.region ?? null;

  return (
    <footer
      data-role="hub-footer"
      style={{
        background: "var(--brand-dark, #2f4339)",
        color: "rgba(255,255,255,0.8)",
        marginTop: "4rem",
        padding: "2.5rem 1.25rem",
      }}
    >
      <div
        style={{
          maxWidth: "1180px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "2rem",
          alignItems: "start",
        }}
      >
        <div>
          <div style={{ fontFamily: "var(--brand-heading-font, serif)", fontWeight: 600, fontSize: "1.1rem", color: "#fff", marginBottom: "0.5rem" }}>
            {clientName}
          </div>
          {(locality || region) ? (
            <div style={{ fontSize: "0.875rem", opacity: 0.7, marginBottom: "0.5rem" }}>
              {[locality, region].filter(Boolean).join(", ")}
            </div>
          ) : null}
          {phone ? (
            <a href={`tel:${phone.replace(/\s/g, "")}`} style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.875rem", display: "block", marginBottom: "0.25rem" }}>
              {phone}
            </a>
          ) : null}
          {email ? (
            <a href={`mailto:${email}`} style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.875rem", display: "block" }}>
              {email}
            </a>
          ) : null}
        </div>
        <div style={{ fontSize: "0.75rem", opacity: 0.5, textAlign: "right", alignSelf: "end" }}>
          © {new Date().getFullYear()} {clientName}
        </div>
      </div>
    </footer>
  );
}
