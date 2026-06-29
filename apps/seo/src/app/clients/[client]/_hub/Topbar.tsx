/**
 * Topbar — branded hub header (demo-parity). Server component; emits the demo
 * `.topbar` markup so the ported hub stylesheet styles it. The mobile nav toggle
 * behaviour is wired by HubScripts (toggles `.open` on `#hub-nav`).
 */

import type { BrandSpec } from "@sagemark/schema-flywheel";

export interface HubNavLink {
  label: string;
  href: string;
}

interface TopbarProps {
  brand: BrandSpec | null;
  clientName: string;
  clientSlug: string;
  navLinks?: HubNavLink[];
  phone?: string | null;
}

export function Topbar({ brand, clientName, clientSlug, navLinks = [], phone }: TopbarProps) {
  const logo = brand?.logo;
  const tagline = brand?.tagline ?? null;
  const tel = phone ? phone.replace(/[^0-9+]/g, "") : null;

  return (
    <header className="topbar" data-role="hub-topbar">
      <div className="wrap">
        <a
          className="brand"
          href={`/clients/${clientSlug}`}
          aria-label={`${clientName} home`}
          data-role="hub-brand"
        >
          {logo?.url ? (
            <span className="brand-badge">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo.url} alt={logo.alt ?? clientName} />
            </span>
          ) : (
            <b>{clientName}</b>
          )}
          {tagline ? (
            <span className="brand-tag">
              <small>{tagline}</small>
            </span>
          ) : null}
        </a>

        <button className="nav-toggle" id="hub-nav-toggle" aria-label="Menu" aria-expanded="false">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </button>

        <nav className="nav" id="hub-nav" data-role="hub-nav">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
          {tel ? (
            <a className="btn" href={`tel:${tel}`} data-role="hub-phone-cta">
              Schedule a Tour
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
