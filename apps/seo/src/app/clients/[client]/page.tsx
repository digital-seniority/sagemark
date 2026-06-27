/**
 * Generated resource-library homepage (PR 017 / P1.R.3, lane render-geo).
 *
 *   /clients/[client]
 *
 * THE NET-NEW HOMEPAGE TEMPLATE. Renders a client's resource-library hub as a
 * Server Component so the full page ships in the INITIAL HTML (the SEO/GEO
 * requirement — crawlers + answer engines read server HTML). It is fed by the
 * FIRST-CLASS `cluster_role` / `funnel_stage` columns (D7), grouped into:
 *   - a HERO (license-gated image; degrades to no image when unprovenanced),
 *   - a STATISTIC callout,
 *   - a named THREE-STAGE cluster section (awareness / consideration / decision),
 *   - a GUIDE-CARD grid (every spoke; each card links to its piece),
 *   - a QUALITY section,
 *   - a TOUR CTA + a LICENSE BADGE (DR-033: hero provenance is surfaced).
 *
 * Fail-closed (mirrors the blog route, DR-026):
 *   - `[client]` resolves a tenant by its public `blog_slug` — never a UUID from
 *     the URL; every read is scoped by the resolved client id (no cross-client).
 *   - Only PUBLISHED pieces are listed (the seam filters; the DB anon RLS policy
 *     is the authoritative second gate).
 *   - The HERO image is rendered ONLY when its persisted asset carries a non-null
 *     `license` (DR-033 render gate) — an unprovenanced asset is never surfaced.
 *   - No `[photo:]`/`[cta:]` token leaks (escape-first body render reused).
 *
 * Dynamic: reads per-request from the public data seam → `force-dynamic`.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  NOT_WIRED_PUBLIC_DATA_ACCESS,
  type PublicContentDataAccess,
  type PublicClient,
  type PublishedPiece,
  type ReferencedHeroAsset,
} from "@/lib/content/context";
import { buildClusterMap, type ClusterMap } from "@/lib/render/hub-homepage";
import { resolveHeroAsset } from "@/lib/tools/hero-image";
import { resolvePublicContentDataAccess } from "@/lib/content/resolve-public-data-access";

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

/**
 * Resolve the homepage data fail-closed. Returns null when the client slug is
 * unknown (the caller 404s). Heroes are resolved via the READ path
 * (`resolveHeroAsset`) — never generated inline (F8): the SSR render uses
 * already-persisted, license-gated assets only.
 */
export async function resolveHome(
  clientSlug: string,
  deps: HomeDeps = DEFAULT_DEPS,
): Promise<ResolvedHome | null> {
  const client = await deps.data.resolveClientByBlogSlug(clientSlug);
  if (!client) return null;

  const pieces = await deps.data.listPublishedPieces(client.id);
  // Defense-in-depth: never surface a piece whose clientId disagrees.
  const scoped = pieces.filter((p) => p.clientId === client.id);
  const cluster = buildClusterMap(scoped);

  // Resolve the FIRST hero reference (the homepage hero slot) from PERSISTED,
  // license-gated assets. Generation is out-of-band (ensureHeroAsset job); SSR
  // never blocks on it. When the seam can't resolve heroes (optional method
  // absent) OR the asset is unlicensed/unresolved → null (degrade, no image).
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
  const resolved = await resolveHome(clientSlug);
  if (!resolved) return { title: "Not found" };
  return {
    title: `${resolved.client.name} — Resource Library`,
    description: `Guides and answers from ${resolved.client.name}.`,
  };
}

/** A single guide card (a spoke linking to its piece). */
function GuideCard({
  clientSlug,
  slug,
  title,
  excerpt,
}: {
  clientSlug: string;
  slug: string;
  title: string;
  excerpt: string | null;
}) {
  return (
    <li data-role="guide-card">
      <a href={`/clients/${clientSlug}/blog/${slug}`} data-role="spoke-link">
        <h3>{title}</h3>
        {excerpt ? <p>{excerpt}</p> : null}
      </a>
    </li>
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

  return (
    <main data-role="resource-home">
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section data-role="hero">
        {/* Render the hero image ONLY when license-gated (DR-033). */}
        {hero && hero.url && hero.license ? (
          <figure data-role="hero-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hero.url} alt={hero.alt ?? client.name} />
            {/* LICENSE BADGE — surfaces the recorded provenance (DR-033). */}
            <figcaption data-role="license-badge">
              {hero.license.attribution ??
                `Image: ${hero.license.provider}${
                  hero.license.terms ? ` (${hero.license.terms})` : ""
                }`}
            </figcaption>
          </figure>
        ) : null}
        <h1>{client.name} Resource Library</h1>
        {cluster.pillar?.excerpt ? (
          <p data-role="hero-lede">{cluster.pillar.excerpt}</p>
        ) : null}
      </section>

      {/* ── STATISTIC CALLOUT ────────────────────────────────────────────── */}
      <section data-role="statistic-callout">
        <p>
          <strong data-role="statistic-value">{totalGuides}</strong>{" "}
          published guides and answers, organized to meet you wherever you are.
        </p>
      </section>

      {/* ── PILLAR (links out to every spoke — no orphan by construction) ─── */}
      {cluster.pillar ? (
        <section data-role="pillar">
          <h2>
            <a href={`/clients/${clientSlug}/blog/${cluster.pillar.slug}`}>
              {cluster.pillar.title}
            </a>
          </h2>
          {cluster.pillar.excerpt ? <p>{cluster.pillar.excerpt}</p> : null}
        </section>
      ) : null}

      {/* ── NAMED THREE-STAGE CLUSTER SECTION ────────────────────────────── */}
      <section data-role="cluster-stages">
        {cluster.sections.map((sec) => (
          <div key={sec.stage} data-role="funnel-stage" data-stage={sec.stage}>
            <h2 data-role="stage-label">{sec.label}</h2>
            {sec.cards.length > 0 ? (
              <ul data-role="stage-cards">
                {sec.cards.map((card) => (
                  <GuideCard
                    key={card.slug}
                    clientSlug={clientSlug}
                    slug={card.slug}
                    title={card.title}
                    excerpt={card.excerpt}
                  />
                ))}
              </ul>
            ) : (
              <p data-role="stage-empty">More guides coming soon.</p>
            )}
          </div>
        ))}
      </section>

      {/* ── GUIDE-CARD GRID (every spoke) ────────────────────────────────── */}
      <section data-role="guide-grid">
        <h2>All guides</h2>
        <ul data-role="all-guides">
          {cluster.allSpokes.map((card) => (
            <GuideCard
              key={card.slug}
              clientSlug={clientSlug}
              slug={card.slug}
              title={card.title}
              excerpt={card.excerpt}
            />
          ))}
        </ul>
      </section>

      {/* ── QUALITY SECTION ──────────────────────────────────────────────── */}
      <section data-role="quality">
        <h2>How we write</h2>
        <p>
          Every guide is reviewed for accuracy by qualified staff and grounded in
          authoritative sources before it is published.
        </p>
      </section>

      {/* ── TOUR CTA ─────────────────────────────────────────────────────── */}
      <section data-role="tour-cta">
        <a href={`/clients/${clientSlug}/tour`} data-role="cta-tour">
          Schedule a tour
        </a>
      </section>
    </main>
  );
}

export default async function ClientHomePage({
  params,
}: {
  params: Promise<{ client: string }>;
}) {
  const { client: clientSlug } = await params;
  // ACTIVATION (DR-026): resolve the live PUBLIC seam BEHIND the service-role creds
  // gate. This composes the live published-content reads (resolveClientByBlogSlug /
  // loadPublishedPiece / listPublishedPieces, status='published' only) WITH the
  // live hero-asset resolver (C.021.2/DR-035) on the SAME gate. With no creds set
  // it returns NOT_WIRED_PUBLIC_DATA_ACCESS (+ gated-off hero) → today's behavior
  // (the route 404s; hero degrades to placeholder-strip). No hero-path regression.
  const data = await resolvePublicContentDataAccess();
  const deps: HomeDeps = { ...DEFAULT_DEPS, data };
  return renderHomePage(clientSlug, deps);
}
