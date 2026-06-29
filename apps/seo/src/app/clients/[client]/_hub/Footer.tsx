/**
 * Footer — branded hub footer (demo-parity). Server component; emits the demo
 * `.footer` markup styled by the ported hub stylesheet. Columns: brand + blurb,
 * family-guide links, and visit/call NAP + accreditation line.
 */

import type { BrandSpec } from "@sagemark/schema-flywheel";
import type { HubNavLink } from "./Topbar";

interface FooterProps {
  brand: BrandSpec | null;
  clientName: string;
  clientSlug: string;
  links?: HubNavLink[];
}

export function Footer({ brand, clientName, clientSlug, links = [] }: FooterProps) {
  const nap = brand?.nap;
  const hub = brand?.hub;
  const logo = brand?.logo;
  const phone = nap?.phone ?? null;
  const tel = phone ? phone.replace(/[^0-9+]/g, "") : null;
  const blurb = hub?.footerBlurb ?? brand?.tagline ?? null;
  const license = hub?.footerLicense ?? null;
  const legalName = nap?.legalName ?? clientName;
  const cityLine = [nap?.locality, nap?.region, nap?.postalCode].filter(Boolean).join(", ");
  const year = new Date().getFullYear();

  return (
    <footer className="footer" data-role="hub-footer">
      <div className="wrap">
        <div className="grid">
          <div>
            <a className="brand" href={`/clients/${clientSlug}`} style={{ marginBottom: "16px" }}>
              {logo?.url ? (
                <span className="brand-badge">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo.url} alt={logo.alt ?? clientName} />
                </span>
              ) : (
                <b style={{ color: "#fff" }}>{clientName}</b>
              )}
            </a>
            {blurb ? <p>{blurb}</p> : null}
          </div>

          {links.length > 0 ? (
            <div>
              <h5>Family Guides</h5>
              <ul className="links">
                {links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href}>{l.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div />
          )}

          <div>
            <h5>Visit or Call</h5>
            <p className="nap">
              {nap?.streetAddress ? (
                <>
                  {nap.streetAddress}
                  <br />
                </>
              ) : null}
              {cityLine ? (
                <>
                  {cityLine}
                  <br />
                </>
              ) : null}
              {tel ? (
                <a href={`tel:${tel}`}>
                  <b>{phone}</b>
                </a>
              ) : null}
            </p>
            {license ? (
              <p className="nap" style={{ marginTop: "10px", fontSize: ".82rem", color: "#9fb3a6" }}>
                {license}
              </p>
            ) : null}
          </div>
        </div>

        <div className="legal">
          <span>
            © {year} {legalName}. Educational content — not a substitute for medical advice.
          </span>
        </div>
      </div>
    </footer>
  );
}
