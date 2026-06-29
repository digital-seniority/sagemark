/**
 * Generated resource-library homepage (PR 017 / P1.R.3, lane render-geo) —
 * rebuilt to demo-parity (lane render-geo / hub-visual).
 *
 *   /clients/[client]
 *
 * Renders a client's resource-library hub as a Server Component (full page in the
 * INITIAL HTML — the SEO/GEO requirement). The layout mirrors the bundled
 * reference demo (`examples/whispering-willows-demo`): a 2-column hero with a stat
 * badge, a strategy "steps" section, a stage-grouped grid of image cards, a dark
 * quality section, and a CTA band — driven by the first-class
 * `cluster_role`/`funnel_stage` columns plus the client's `brand_spec.hub`
 * presentation layer. Every `data-role` hook the SSR contract tests pin is
 * preserved.
 *
 * Fail-closed (mirrors the blog route, DR-026): `[client]` resolves a tenant by
 * its public `blog_slug` (never a UUID); only PUBLISHED pieces are listed; the
 * HERO image renders only when its persisted asset carries a non-null license
 * (DR-033); no `[photo:]`/`[cta:]` token leaks (excerpts only, escape-first body).
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { HubPresentation } from "@sagemark/schema-flywheel";

import {
  NOT_WIRED_PUBLIC_DATA_ACCESS,
  type PublicContentDataAccess,
  type PublicClient,
  type PublishedPiece,
  type ReferencedHeroAsset,
} from "@/lib/content/context";
import { buildClusterMap, type ClusterMap, type SpokeCard } from "@/lib/render/hub-homepage";
import { resolveHeroAsset } from "@/lib/tools/hero-image";
import { resolvePublicContentDataAccess } from "@/lib/content/resolve-public-data-access";
import { buildBrandStyleTag, parseBrandSpec } from "@/lib/render/brand-theme";
import { HUB_STYLESHEET } from "@/lib/render/hub-stylesheet";
import { buildOrgJsonLd } from "@/lib/render/build-org-jsonld";
import { Topbar, type HubNavLink } from "./_hub/Topbar";
import { Footer } from "./_hub/Footer";
import { HubScripts } from "./_hub/HubScripts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Injectable deps so SSR tests render with a fixture seam (no live DB). */
export interface HomeDeps {
  data: PublicContentDataAccess;
}

const DEFAULT_DEPS: HomeDeps = { data: NOT_WIRED_PUBLIC_DATA_ACCESS };

/** What the homepage needs, resolved fail-closed from the URL `[client]` slug. */
export interface ResolvedHome {
  client: PublicClient;
  pieces: PublishedPiece[];
  cluster: ClusterMap;
  /** The single license-gated hero asset (or null → no hero image). */
  hero: ReferencedHeroAsset | null;
}

/** The generic quality pillars used when a client has not seeded its own. */
const DEFAULT_QUALITY_PILLARS = [
  {
    k: "Source-grounded",
    title: "No invented statistics",
    body: "Every figure traces to a named authority and is cited on the page.",
  },
  {
    k: "Built for AI answers",
    title: "Self-contained and structured",
    body: "Clear headings, comparison tables, and FAQ schema let answer engines lift a clean, quotable passage.",
  },
  {
    k: "E-E-A-T ready",
    title: "A named, accountable byline",
    body: "Health content needs a credentialed human behind it — each page carries a reviewer byline.",
  },
];

/**
 * Resolve the homepage data fail-closed. Returns null when the client slug is
 * unknown (the caller 404s). Heroes are resolved via the READ path
 * (`resolveHeroAsset`) — never generated inline (F8).
 */
export async function resolveHome(
  clientSlug: string,
  deps: HomeDeps = DEFAULT_DEPS,
): Promise<ResolvedHome | null> {
  const client = await deps.data.resolveClientByBlogSlug(clientSlug);
  if (!client) return null;

  const pieces = await deps.data.listPublishedPieces(client.id);
  const scoped = pieces.filter((p) => p.clientId === client.id);
  const cluster = buildClusterMap(scoped);

  let hero: ReferencedHeroAsset | null = null;
  const firstHeroSlug = cluster.heroSlugs[0];
  if (firstHeroSlug && deps.data.resolveHeroAssets) {
    const resolveHeroAssets = deps.data.resolveHeroAssets.bind(deps.data);
    hero = await resolveHeroAsset(firstHeroSlug, async (slug) => {
      const assets = await resolveHeroAssets(client.id, [slug]);
      return assets.find((a) => a.slug === slug) ?? null;
    });
  }

  return { client, pieces: scoped, cluster, hero };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ client: string }>;
}): Promise<Metadata> {
  const { client: clientSlug } = await params;
  const data = await resolvePublicContentDataAccess();
  const resolved = await resolveHome(clientSlug, { data });
  if (!resolved) return { title: "Not found" };
  return {
    title: `${resolved.client.name} — Resource Library`,
    description: `Guides and answers from ${resolved.client.name}.`,
  };
}

// ── Presentation helpers ───────────────────────────────────────────────────────

function shortLabel(title: string): string {
  return title.length > 24 ? `${title.slice(0, 22).trimEnd()}…` : title;
}

/** A short tag pill for a card, from a per-slug override or its cluster role/stage. */
function cardTag(card: SpokeCard, hub?: HubPresentation): string {
  const override = hub?.cardTags?.[card.slug];
  if (override) return override;
  if (card.clusterRole === "pillar" || card.clusterRole === "cornerstone") return "Cornerstone";
  if (card.clusterRole === "faq") return "Questions";
  if (card.clusterRole === "checklist") return "Free · printable";
  switch (card.funnelStage) {
    case "awareness":
      return "Understanding the basics";
    case "consideration":
      return "Comparing options";
    case "decision":
      return "Making the decision";
    default:
      return "Guide";
  }
}

/** Resolve a card image: per-slug override, else cycle the pool, else null. */
function pickImage(slug: string, idx: number, hub?: HubPresentation): string | null {
  if (hub?.cardImages?.[slug]) return hub.cardImages[slug]!;
  const pool = hub?.imagePool ?? [];
  if (!pool.length) return null;
  return pool[((idx % pool.length) + pool.length) % pool.length]!;
}

/** The "Read the X" verb for a card by role. */
function moreLabel(role: string): string {
  if (role === "faq") return "Read the answers";
  if (role === "checklist") return "Open & print";
  return "Read the guide";
}

/** A single guide card (demo `.card` — image + tag + title + excerpt + more). */
function GuideCard({
  href,
  title,
  excerpt,
  tag,
  image,
  more,
}: {
  href: string;
  title: string;
  excerpt: string | null;
  tag: string;
  image: string | null;
  more: string;
}) {
  return (
    <a className="card" href={href} data-role="guide-card">
      {image ? (
        <div className="ph">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" loading="lazy" />
        </div>
      ) : null}
      <div className="body">
        <span className="tag">{tag}</span>
        <h3>{title}</h3>
        {excerpt ? <p>{excerpt}</p> : null}
        <span className="more">{more} →</span>
      </div>
    </a>
  );
}

/**
 * Render the resource-library homepage (Server Component). The returned JSX is
 * what Next serializes into the INITIAL HTML response.
 */
export async function renderHomePage(
  clientSlug: string,
  deps: HomeDeps = DEFAULT_DEPS,
) {
  const resolved = await resolveHome(clientSlug, deps);
  if (!resolved) {
    notFound();
  }
  const { client, cluster, hero } = resolved;
  const totalGuides = cluster.allSpokes.length + (cluster.pillar ? 1 : 0);

  const brand = parseBrandSpec(client.brandSpec);
  const brandCss = buildBrandStyleTag(brand);
  const orgLd = buildOrgJsonLd(brand, client.name);
  const hub = brand?.hub;

  const phone = brand?.nap?.phone ?? null;
  const tel = phone ? phone.replace(/[^0-9+]/g, "") : null;
  const blog = (slug: string) => `/clients/${clientSlug}/blog/${slug}`;

  // Topbar nav: curated override, else derived from the cluster.
  const navLinks: HubNavLink[] = hub?.nav?.length
    ? hub.nav.map((n) => ({ label: n.label, href: blog(n.slug) }))
    : [
        ...(cluster.pillar ? [{ label: "Start here", href: blog(cluster.pillar.slug) }] : []),
        ...cluster.sections.flatMap((s) =>
          s.cards.slice(0, 1).map((c) => ({ label: shortLabel(c.title), href: blog(c.slug) })),
        ),
      ];

  const footerLinks: HubNavLink[] = [
    ...(cluster.pillar ? [{ label: cluster.pillar.title, href: blog(cluster.pillar.slug) }] : []),
    ...cluster.allSpokes.slice(0, 7).map((c) => ({ label: c.title, href: blog(c.slug) })),
  ];

  // Deterministic image cycling across all spoke cards.
  const cardIndex = new Map(cluster.allSpokes.map((c, i) => [c.slug, i]));

  // Hero art: a license-gated asset (DR-033) takes precedence; else the brand hero image.
  const licensedHero = hero && hero.url && hero.license ? hero : null;
  const pillarImg = cluster.pillar
    ? hub?.cardImages?.[cluster.pillar.slug] ?? hub?.imagePool?.[0] ?? null
    : null;

  const steps = (
    hub?.steps && hub.steps.length
      ? hub.steps
      : cluster.sections.map((s, i) => ({ k: `0${i + 1}`, title: s.label, body: "" }))
  ).slice(0, 3);

  const qualityPillars = (
    hub?.qualityPillars && hub.qualityPillars.length ? hub.qualityPillars : DEFAULT_QUALITY_PILLARS
  ).slice(0, 3);

  return (
    <div className="hub" data-role="resource-home">
      {/* Injection-safe brand theme vars + the ported hub design system */}
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: brandCss }} />
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: HUB_STYLESHEET }} />

      <Topbar
        brand={brand}
        clientName={client.name}
        clientSlug={clientSlug}
        navLinks={navLinks}
        phone={phone}
      />

      <main>
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="hero" data-role="hero">
          <div className="wrap">
            <div>
              <span className="eyebrow">{hub?.eyebrow ?? "A family resource library"}</span>
              <h1>{hub?.heroHeadline ?? `${client.name} Resource Library`}</h1>
              <p className="lead">
                {hub?.heroLede ??
                  cluster.pillar?.excerpt ??
                  `Clear, trustworthy guides from ${client.name}.`}
              </p>
              <div className="cta-row">
                <a className="btn gold" href="#articles">
                  {hub?.primaryCtaLabel ?? "Read the guides"}
                </a>
                {tel ? (
                  <a className="btn ghost" href={`tel:${tel}`}>
                    Call {phone}
                  </a>
                ) : null}
              </div>
            </div>

            {licensedHero || hub?.heroImage || hub?.heroStat ? (
              <div className="hero-art">
                {licensedHero ? (
                  <figure data-role="hero-image" style={{ margin: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={licensedHero.url!} alt={licensedHero.alt ?? client.name} />
                    <figcaption
                      data-role="license-badge"
                      style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: "8px" }}
                    >
                      {licensedHero.license!.attribution ??
                        `Image: ${licensedHero.license!.provider}`}
                    </figcaption>
                  </figure>
                ) : hub?.heroImage ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={hub.heroImage} alt={hub.heroHeadline ?? client.name} />
                ) : null}
                {hub?.heroStat ? (
                  <div className="hero-badge">
                    {hub.heroStat.value ? <span className="n">{hub.heroStat.value}</span> : null}
                    {hub.heroStat.label ? <small>{hub.heroStat.label}</small> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {/* ── STAT STRIP (semantic statistic-callout) ──────────────────────── */}
        <section
          className="section"
          data-role="statistic-callout"
          style={{ paddingTop: "30px", paddingBottom: "0" }}
        >
          <div className="wrap" style={{ textAlign: "center" }}>
            <p style={{ color: "var(--muted)", margin: 0 }}>
              <strong data-role="statistic-value" style={{ color: "var(--willow-700)" }}>
                {totalGuides}
              </strong>{" "}
              published guides and answers — each reviewed for accuracy and grounded in cited sources.
            </p>
          </div>
        </section>

        {/* ── STRATEGY STEPS ───────────────────────────────────────────────── */}
        <section className="section" id="strategy">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">{hub?.stepsEyebrow ?? "How to use this library"}</span>
              <h2>{hub?.stepsHeadline ?? "Guidance for every stage of the journey"}</h2>
              {hub?.stepsLede ? <p>{hub.stepsLede}</p> : null}
            </div>
            <div className="steps">
              {steps.map((st, i) => (
                <div className="step" key={i}>
                  <div className="k">{st.k}</div>
                  <h3>{st.title}</h3>
                  {st.body ? <p>{st.body}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── ARTICLES — stage-grouped card grid (cluster-stages) ──────────── */}
        <section className="section alt" id="articles" data-role="cluster-stages">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">{hub?.libraryEyebrow ?? "The resource library"}</span>
              <h2>{hub?.libraryHeadline ?? "Every guide, organized by where you are"}</h2>
              {hub?.libraryLede ? <p>{hub.libraryLede}</p> : null}
            </div>

            {/* Pillar feature card */}
            {cluster.pillar ? (
              <div data-role="pillar" style={{ maxWidth: "640px", margin: "0 auto 12px" }}>
                <a className="card" href={blog(cluster.pillar.slug)}>
                  {pillarImg ? (
                    <div className="ph">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={pillarImg} alt="" />
                    </div>
                  ) : null}
                  <div className="body">
                    <span className="tag">Start here · the pillar guide</span>
                    <h3>{cluster.pillar.title}</h3>
                    {cluster.pillar.excerpt ? <p>{cluster.pillar.excerpt}</p> : null}
                    <span className="more">Read the guide →</span>
                  </div>
                </a>
              </div>
            ) : null}

            {cluster.sections.map((sec) => (
              <div
                key={sec.stage}
                data-role="funnel-stage"
                data-stage={sec.stage}
                style={{ marginTop: "44px" }}
              >
                <h2 data-role="stage-label" style={{ textAlign: "center", marginTop: 0 }}>
                  {sec.label}
                </h2>
                {sec.cards.length > 0 ? (
                  <div className="cards">
                    {sec.cards.map((card) => (
                      <GuideCard
                        key={card.slug}
                        href={blog(card.slug)}
                        title={card.title}
                        excerpt={card.excerpt}
                        tag={cardTag(card, hub)}
                        image={pickImage(card.slug, cardIndex.get(card.slug) ?? 0, hub)}
                        more={moreLabel(card.clusterRole)}
                      />
                    ))}
                  </div>
                ) : (
                  <p data-role="stage-empty" style={{ textAlign: "center", color: "var(--muted)" }}>
                    More guides coming soon.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── QUALITY (willow dark) ────────────────────────────────────────── */}
        <section className="section willow" data-role="quality">
          <div className="wrap">
            <div className="section-head center" style={{ maxWidth: "720px" }}>
              <span className="eyebrow">
                {hub?.qualityEyebrow ?? "Why these guides are built to be trusted"}
              </span>
              <h2>{hub?.qualityHeadline ?? "Quality is the strategy"}</h2>
              <p>
                {hub?.qualityLede ??
                  "Every guide is engineered to be accurate, citable, and safe — held to a standard that protects your brand."}
              </p>
            </div>
            <div className="steps">
              {qualityPillars.map((p, i) => (
                <div className="step" key={i}>
                  <div className="k">{p.k}</div>
                  <h3>{p.title}</h3>
                  {p.body ? <p>{p.body}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA BAND ─────────────────────────────────────────────────────── */}
        <section className="section" data-role="tour-cta">
          <div className="wrap">
            <div className="cta-band">
              <div>
                <h3>{hub?.ctaHeadline ?? `See if ${client.name} is the right fit`}</h3>
                <p>
                  {hub?.ctaBody ??
                    "Schedule a visit, meet the team, and ask every question on your list. There's no pressure — just clear answers."}
                </p>
              </div>
              <div className="actions">
                <a
                  className="btn white"
                  href={tel ? `tel:${tel}` : `/clients/${clientSlug}/tour`}
                  data-role="cta-tour"
                >
                  Schedule a Tour
                </a>
                {phone ? (
                  <div className="phone">
                    or call <b>{phone}</b>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer brand={brand} clientName={client.name} clientSlug={clientSlug} links={footerLinks} />
      <HubScripts />

      {/* LocalBusiness JSON-LD (schema.org) */}
      {orgLd ? (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
        />
      ) : null}
    </div>
  );
}

export default async function ClientHomePage({
  params,
}: {
  params: Promise<{ client: string }>;
}) {
  const { client: clientSlug } = await params;
  const data = await resolvePublicContentDataAccess();
  const deps: HomeDeps = { ...DEFAULT_DEPS, data };
  return renderHomePage(clientSlug, deps);
}
