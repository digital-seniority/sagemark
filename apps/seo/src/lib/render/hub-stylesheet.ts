/**
 * hub-stylesheet — the LAYOUT layer for the public content hub (H1, lane render-geo).
 *
 * WHY THIS EXISTS. `brand-theme.ts` (Slice 8) emits only the `:root` brand TOKENS
 * (palette + fonts). The hub routes (`/clients/[client]` + `/blog/[slug]`) render
 * semantic `data-role` markup but shipped with NO layout rules — so the live page
 * rendered as an unstyled wall of text (colored Topbar/Footer via inline styles, but
 * a bare HTML body). THIS module is the missing stylesheet: it styles the hub's
 * `data-role` structure into the reference-demo design
 * (`examples/whispering-willows-demo/styles.css`) — hero band, card grid, sectioned
 * rhythm, dark quality band, CTA, and an article reading column.
 *
 * BRAND-ADAPTIVE BY CONSTRUCTION. Every value derives from the `--brand-*` tokens
 * `buildBrandStyleTag` already sets. Secondary tones (muted text, hairlines, surface
 * tints, hero gradient) are computed with `color-mix()` off those tokens, so the SAME
 * stylesheet re-skins to ANY client palette automatically — a palette swap on the
 * `content_clients.brand_spec` row reflows the whole hub. No per-client interpolation
 * here.
 *
 * INJECTION SAFETY. This is a STATIC string — zero interpolation, zero user/model
 * input — so it is safe to embed via `dangerouslySetInnerHTML` by construction.
 *
 * PAGE-SCOPED. It is rendered ONLY by the hub render functions, so its element
 * selectors (incl. `body`) apply only on hub pages and never leak into the Studio app.
 * The full-bleed-section + centered-content layout is achieved with a padding trick
 * (`max(24px, calc((100% - maxw)/2))`) so NO wrapper-div markup change is needed —
 * the SSR `data-role` contract the render tests pin is preserved verbatim.
 */

export const HUB_STYLESHEET = `
/* ── Derived design tokens (computed off the brand palette) ─────────────── */
[data-role="resource-home"],
[data-role="article-page"],
[data-role="faq-page"],
[data-role="checklist-page"] {
  --hub-maxw: 1180px;
  --hub-readw: 760px;
  --hub-radius: 16px;
  --hub-muted: color-mix(in srgb, var(--brand-ink) 55%, var(--brand-bg));
  --hub-soft-ink: color-mix(in srgb, var(--brand-ink) 80%, var(--brand-bg));
  --hub-line: color-mix(in srgb, var(--brand-ink) 13%, var(--brand-bg));
  --hub-surface-alt: color-mix(in srgb, var(--brand-bg) 91%, var(--brand-ink));
  --hub-accent-soft: color-mix(in srgb, var(--brand-color) 14%, #ffffff);
  --hub-hero-top: color-mix(in srgb, var(--brand-color) 9%, var(--brand-bg));
  --hub-shadow: 0 1px 2px rgba(20,20,20,.05), 0 10px 30px rgba(20,20,20,.08);
  --hub-shadow-lg: 0 26px 55px -22px rgba(20,30,24,.45);
}

/* ── Page base (scoped to hub routes by injection) ─────────────────────── */
body:has([data-role="resource-home"]),
body:has([data-role="article-page"]),
body:has([data-role="faq-page"]),
body:has([data-role="checklist-page"]) {
  margin: 0;
  background: var(--brand-bg);
  color: var(--brand-ink);
  font-family: var(--brand-body-font);
  font-size: 18px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
[data-role="resource-home"] img,
[data-role="article-page"] img,
[data-role="faq-page"] img,
[data-role="checklist-page"] img { max-width: 100%; display: block; }

[data-role="resource-home"] h1, [data-role="resource-home"] h2, [data-role="resource-home"] h3,
[data-role="article-page"] h1, [data-role="article-page"] h2, [data-role="article-page"] h3,
[data-role="faq-page"] h1, [data-role="faq-page"] h2, [data-role="faq-page"] h3,
[data-role="checklist-page"] h1, [data-role="checklist-page"] h2 {
  font-family: var(--brand-heading-font);
  color: var(--brand-ink);
  line-height: 1.18;
  font-weight: 600;
  letter-spacing: -.01em;
}

/* ── Homepage section rhythm — full-bleed bg, centered content ──────────── */
[data-role="resource-home"] > section {
  padding-top: 64px;
  padding-bottom: 64px;
  padding-left: max(24px, calc((100% - var(--hub-maxw)) / 2));
  padding-right: max(24px, calc((100% - var(--hub-maxw)) / 2));
}

/* ── Hero ───────────────────────────────────────────────────────────────── */
[data-role="hero"] {
  background: linear-gradient(180deg, var(--hub-hero-top), var(--brand-bg));
  text-align: center;
  padding-top: 72px;
  padding-bottom: 72px;
}
[data-role="hero-image"] { margin: 0 auto 30px; max-width: 780px; }
[data-role="hero-image"] img {
  width: 100%; aspect-ratio: 16 / 8; object-fit: cover;
  border-radius: 22px; box-shadow: var(--hub-shadow-lg);
}
[data-role="license-badge"] { font-size: .78rem; color: var(--hub-muted); margin-top: 10px; }
[data-role="hero"] h1 {
  font-size: clamp(2.2rem, 5vw, 3.5rem);
  margin: .15em auto .35em; max-width: 20ch;
}
[data-role="hero-lede"] {
  font-size: 1.2rem; color: var(--hub-soft-ink);
  max-width: 62ch; margin: 0 auto;
}

/* ── Statistic callout (slim, sits under the hero) ─────────────────────── */
[data-role="statistic-callout"] { text-align: center; padding-top: 30px; padding-bottom: 10px; }
[data-role="statistic-callout"] p { color: var(--hub-muted); font-size: 1.05rem; margin: 0; }
[data-role="statistic-value"] { color: var(--brand-color); font-weight: 700; font-size: 1.15em; }

/* ── Pillar feature band ───────────────────────────────────────────────── */
[data-role="pillar"] { background: var(--hub-surface-alt); }
[data-role="pillar"] h2 { margin: 0 0 .3em; font-size: clamp(1.6rem, 3.2vw, 2.2rem); }
[data-role="pillar"] h2 a { text-decoration: none; color: var(--brand-dark); }
[data-role="pillar"] h2 a:hover { color: var(--brand-accent); }
[data-role="pillar"] > p { color: var(--hub-muted); max-width: 66ch; margin: 0; }

/* ── Funnel-stage groups ───────────────────────────────────────────────── */
[data-role="cluster-stages"] { display: flex; flex-direction: column; gap: 52px; }
[data-role="stage-label"] { font-size: clamp(1.4rem, 2.6vw, 1.85rem); margin: 0 0 20px; }
[data-role="stage-empty"] { color: var(--hub-muted); }

/* ── Card grids (stage cards + all-guides) ─────────────────────────────── */
[data-role="stage-cards"], [data-role="all-guides"] {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
}
[data-role="guide-card"] { display: flex; }
[data-role="guide-card"] > [data-role="spoke-link"] {
  display: flex; flex-direction: column; gap: 10px; width: 100%;
  background: var(--brand-surface);
  border: 1px solid var(--hub-line);
  border-radius: var(--hub-radius);
  padding: 24px 24px 26px;
  box-shadow: var(--hub-shadow);
  text-decoration: none; color: inherit;
  transition: transform .18s ease, box-shadow .18s ease;
}
[data-role="guide-card"] > [data-role="spoke-link"]:hover {
  transform: translateY(-4px); box-shadow: var(--hub-shadow-lg);
}
[data-role="guide-card"] h3 { margin: 0; font-size: 1.25rem; }
[data-role="guide-card"] p { margin: 0; color: var(--hub-muted); font-size: .96rem; }
[data-role="guide-card"] > [data-role="spoke-link"]::after {
  content: "Read the guide \\2192";
  margin-top: 4px; font-size: .92rem; font-weight: 600; color: var(--brand-color);
}

[data-role="guide-grid"] > h2 { font-size: clamp(1.5rem, 3vw, 2rem); margin: 0 0 26px; }

/* ── Quality band (dark) ───────────────────────────────────────────────── */
[data-role="quality"] { background: var(--brand-dark); color: #fff; text-align: center; }
[data-role="quality"] h2 { color: #fff; margin: 0 0 .4em; }
[data-role="quality"] p { color: rgba(255,255,255,.82); max-width: 62ch; margin: 0 auto; }

/* ── Tour CTA ──────────────────────────────────────────────────────────── */
[data-role="tour-cta"] { text-align: center; }
[data-role="cta-tour"] {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--brand-accent); color: #fff; text-decoration: none;
  padding: 15px 30px; border-radius: 999px; font-weight: 600; font-size: 1.02rem;
  box-shadow: var(--hub-shadow);
}
[data-role="cta-tour"]:hover { filter: brightness(.94); }

/* ── Article / FAQ / checklist reading column ──────────────────────────── */
[data-role="article-page"], [data-role="faq-page"], [data-role="checklist-page"] {
  background: var(--brand-bg);
  padding: 50px max(24px, calc((100% - var(--hub-readw)) / 2)) 76px;
}
[data-role="article-page"] h1, [data-role="faq-page"] h1, [data-role="checklist-page"] h1 {
  font-size: clamp(2rem, 4.4vw, 2.9rem); margin: 0 0 .3em;
}
[data-role="excerpt"] {
  font-size: 1.2rem; color: var(--hub-soft-ink); margin: 0 0 1.5em;
}
[data-role="article-body"] { font-size: 1.06rem; }
[data-role="article-body"] > p:first-of-type { font-size: 1.15rem; }
[data-role="article-body"] p, [data-role="article-body"] li { font-size: 1.06rem; }
[data-role="article-body"] h2 {
  font-size: clamp(1.5rem, 3vw, 2rem); margin: 1.9em 0 .5em; scroll-margin-top: 90px;
}
[data-role="article-body"] h2::after {
  content: ""; display: block; width: 54px; height: 3px;
  background: var(--brand-accent); border-radius: 2px; margin-top: .45rem;
}
[data-role="article-body"] h3 { font-size: 1.3rem; margin: 1.5em 0 .4em; }
[data-role="article-body"] ul, [data-role="article-body"] ol { padding-left: 1.25em; margin: 0 0 1.2em; }
[data-role="article-body"] li { margin: .4em 0; }
[data-role="article-body"] a { color: var(--brand-color); text-underline-offset: 3px; }
[data-role="article-body"] blockquote {
  margin: 28px 0; padding: 4px 0 4px 22px;
  border-left: 4px solid var(--brand-accent);
  font-family: var(--brand-heading-font); font-style: italic; color: var(--brand-dark);
}
[data-role="article-body"] table {
  width: 100%; border-collapse: collapse; margin: 26px 0; font-size: .98rem;
  border: 1px solid var(--hub-line); border-radius: var(--hub-radius); overflow: hidden;
}
[data-role="article-body"] th, [data-role="article-body"] td {
  padding: 13px 16px; text-align: left; border-bottom: 1px solid var(--hub-line); vertical-align: top;
}
[data-role="article-body"] thead th { background: var(--brand-dark); color: #fff; font-weight: 600; }
[data-role="article-body"] img { border-radius: 14px; box-shadow: var(--hub-shadow); margin: 22px 0; }

/* ── Responsive ────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  [data-role="stage-cards"], [data-role="all-guides"] { grid-template-columns: 1fr; }
  [data-role="resource-home"] > section { padding-top: 48px; padding-bottom: 48px; }
}
`;
