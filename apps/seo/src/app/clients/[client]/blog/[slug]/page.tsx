/**
 * Public content-hub SSR render route (PR 015, lane render-geo) — demo-parity
 * article template (lane hub-visual / H5).
 *
 *   /clients/[client]/blog/[slug]
 *
 * Renders ONE published content piece as a Server Component (full body in the
 * INITIAL HTML). Demo-parity shell: a full-bleed dark article hero (breadcrumb +
 * eyebrow + title + dek + E-E-A-T byline), an auto-generated table of contents,
 * the escape-first body (with rich blocks from MD conventions), a FAQ accordion
 * built from the piece's structured faqData, an author block, and a CTA band.
 *
 * Fail-closed: `[client]` resolves by public `blog_slug`; only `status='published'`
 * is served (else 404); `[photo:]`/`[cta:]` are stripped; the body is escape-first.
 * The inner `<article>` is kept ATTRIBUTE-FREE — the SSR contract test pins it.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  NOT_WIRED_PUBLIC_DATA_ACCESS,
  type PublicContentDataAccess,
  type PublishedPiece,
  type PublicClient,
} from "@/lib/content/context";
import {
  renderArticleBody,
  extractToc,
  estimateReadingMinutes,
} from "@/lib/render/client-blog";
import { serializeFaqJsonLd } from "@/lib/render/build-faq-jsonld";
import { buildBrandStyleTag, parseBrandSpec } from "@/lib/render/brand-theme";
import { HUB_STYLESHEET } from "@/lib/render/hub-stylesheet";
import { buildArticleJsonLd, buildBreadcrumbJsonLd } from "@/lib/render/build-article-jsonld";
import { Topbar, type HubNavLink } from "../../_hub/Topbar";
import { Footer } from "../../_hub/Footer";
import { HubScripts } from "../../_hub/HubScripts";
import { resolvePublicContentDataAccess } from "@/lib/content/resolve-public-data-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface RenderDeps {
  data: PublicContentDataAccess;
  origin?: string;
}

const DEFAULT_DEPS: RenderDeps = { data: NOT_WIRED_PUBLIC_DATA_ACCESS };

/** A simple person glyph for the byline / author avatar. */
function PersonGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" strokeLinecap="round" />
    </svg>
  );
}

/** Eyebrow label for the article hero, from the piece's role/stage. */
function articleEyebrow(piece: PublishedPiece): string {
  switch (piece.clusterRole) {
    case "pillar":
      return "The complete guide";
    case "cornerstone":
      return "A cornerstone guide";
    case "faq":
      return "Questions & answers";
    case "checklist":
      return "Printable checklist";
    default:
      return "A family guide";
  }
}

/** Format a date string as "Month YYYY" (or null when absent/invalid). */
function formatMonthYear(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Coerce the structured faqData to a clean {q,a}[] list (defensive). */
function faqItems(faqData: unknown): Array<{ q: string; a: string }> {
  if (!Array.isArray(faqData)) return [];
  const out: Array<{ q: string; a: string }> = [];
  for (const item of faqData) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const q = String(rec.question ?? rec.q ?? "").trim();
    const a = String(rec.answer ?? rec.a ?? "").trim();
    if (q && a) out.push({ q, a });
  }
  return out;
}

export async function resolvePublished(
  clientSlug: string,
  pieceSlug: string,
  deps: RenderDeps = DEFAULT_DEPS,
): Promise<{ client: PublicClient; piece: PublishedPiece } | null> {
  const client = await deps.data.resolveClientByBlogSlug(clientSlug);
  if (!client) return null;
  const piece = await deps.data.loadPublishedPiece(client.id, pieceSlug);
  if (!piece) return null;
  if (piece.clientId !== client.id) return null;
  return { client, piece };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ client: string; slug: string }>;
}): Promise<Metadata> {
  const { client: clientSlug, slug } = await params;
  const data = await resolvePublicContentDataAccess();
  const resolved = await resolvePublished(clientSlug, slug, { data });
  if (!resolved) return { title: "Not found" };
  const { piece } = resolved;
  return {
    title: piece.title,
    description: piece.metaDescription ?? piece.excerpt ?? undefined,
  };
}

export async function renderClientBlogPage(
  clientSlug: string,
  pieceSlug: string,
  deps: RenderDeps = DEFAULT_DEPS,
) {
  const resolved = await resolvePublished(clientSlug, pieceSlug, deps);
  if (!resolved) {
    notFound();
  }
  const { client, piece } = resolved;

  const brand = parseBrandSpec(client.brandSpec);
  const brandCss = buildBrandStyleTag(brand);
  const hub = brand?.hub;
  const phone = brand?.nap?.phone ?? null;
  const tel = phone ? phone.replace(/[^0-9+]/g, "") : null;
  const blog = (slug: string) => `/clients/${clientSlug}/blog/${slug}`;

  const navLinks: HubNavLink[] = (hub?.nav ?? []).map((n) => ({
    label: n.label,
    href: blog(n.slug),
  }));

  // Body: placeholder-stripped, injection-safe HTML + auto TOC + read time.
  const bodyHtml = renderArticleBody(piece.body);
  const toc = extractToc(piece.body);
  const readMin = estimateReadingMinutes(piece.body);

  const role = piece.clusterRole ?? "article";
  const isChecklist = role === "checklist";
  const isFaq = role === "faq";
  const mainRole = isChecklist ? "checklist-page" : isFaq ? "faq-page" : "article-page";

  const heroImg = hub?.cardImages?.[piece.slug] ?? hub?.imagePool?.[0] ?? null;
  const eyebrow = articleEyebrow(piece);
  const reviewer = hub?.reviewer;
  const authorName = reviewer?.name ? reviewer.name : `${client.name} Care Team`;
  const credential = reviewer?.credential ?? null;
  const updated = formatMonthYear(piece.updatedAt ?? piece.publishedAt);
  const faqs = faqItems(piece.faqData);

  const origin = deps.origin ?? "";
  const pageUrl = origin
    ? `${origin}/clients/${encodeURIComponent(clientSlug)}/blog/${encodeURIComponent(piece.slug)}`
    : undefined;
  const hubUrl = origin ? `${origin}/clients/${encodeURIComponent(clientSlug)}` : undefined;

  const articleLd =
    !isFaq && !isChecklist
      ? buildArticleJsonLd(piece.title, {
          excerpt: piece.excerpt,
          publishedAt: piece.publishedAt,
          updatedAt: piece.updatedAt,
          pageUrl,
        })
      : null;
  const breadcrumbLd =
    !isFaq && !isChecklist && hubUrl
      ? buildBreadcrumbJsonLd(hubUrl, client.name, piece.title, pageUrl)
      : null;
  const faqJsonLd = serializeFaqJsonLd(piece.faqData);

  return (
    <div className="hub" data-role={mainRole}>
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
        {/* ── Full-bleed article hero ─────────────────────────────────────── */}
        <section className="article-hero" data-role="article-hero">
          {heroImg ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={heroImg} alt="" />
          ) : null}
          <div className="hero-inner">
            <div className="read">
              <nav className="breadcrumb" aria-label="Breadcrumb">
                <a href={`/clients/${clientSlug}`}>{client.name}</a> ›{" "}
                <span>{piece.title}</span>
              </nav>
              <span className="eyebrow">{eyebrow}</span>
              <h1>{piece.title}</h1>
              {piece.excerpt ? (
                <p className="dek" data-role="excerpt">
                  {piece.excerpt}
                </p>
              ) : null}
              <div className="byline">
                <span className="av">
                  <PersonGlyph />
                </span>
                <span className="meta">
                  <b>{authorName}</b>
                  <br />
                  <span>
                    {reviewer?.name
                      ? `Reviewed by ${reviewer.name}${credential ? `, ${credential}` : ""}`
                      : "Reviewed for accuracy"}
                    {updated ? ` · Updated ${updated}` : ""} · {readMin} min read
                  </span>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Reading column ──────────────────────────────────────────────── */}
        <div className="wrap">
          <div className="read">
            <div className="article-body-wrap">
              {toc.length >= 3 ? (
                <nav className="toc" aria-label="On this page">
                  <div className="lbl">On this page</div>
                  <ol>
                    {toc.map((t) => (
                      <li key={t.id}>
                        <a href={`#${t.id}`}>{t.text}</a>
                      </li>
                    ))}
                  </ol>
                </nav>
              ) : null}

              <div className="prose">
                <article>
                  <div
                    data-role="article-body"
                    // Safe: bodyHtml is escape-first rendered (see client-blog.ts).
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                </article>
              </div>

              {isChecklist ? (
                <div className="print-actions">
                  <button className="btn gold" data-role="print-cta">
                    Print this checklist
                  </button>
                </div>
              ) : null}

              {/* FAQ accordion (from structured faqData) */}
              {faqs.length > 0 ? (
                <section className="faq" data-role="faq-accordion">
                  <h2 id="frequently-asked-questions">Frequently asked questions</h2>
                  {faqs.map((f, idx) => (
                    <details key={idx}>
                      <summary>
                        {f.q}
                        <span className="ic">+</span>
                      </summary>
                      <div className="ans">
                        <p>{f.a}</p>
                      </div>
                    </details>
                  ))}
                </section>
              ) : null}

              {/* E-E-A-T author block */}
              <div className="author-block">
                <span className="av">
                  <PersonGlyph />
                </span>
                <div>
                  <h4>{authorName}</h4>
                  {credential ? <span className="cred">{credential}</span> : null}
                  <p>
                    {reviewer?.bio ??
                      `Written and reviewed by the ${client.name} care team and grounded in cited, authoritative sources. Educational content — not a substitute for professional medical advice.`}
                  </p>
                </div>
              </div>

              {/* FAQPage JSON-LD */}
              {faqJsonLd ? (
                <script
                  type="application/ld+json"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: faqJsonLd }}
                />
              ) : null}
            </div>
          </div>
        </div>

        {/* ── CTA band ────────────────────────────────────────────────────── */}
        <section className="section" data-role="article-cta">
          <div className="wrap">
            <div className="cta-band">
              <div>
                <h3>{hub?.ctaHeadline ?? `See if ${client.name} is the right fit`}</h3>
                <p>
                  {hub?.ctaBody ??
                    "Schedule a visit, meet the team, and ask every question on your list."}
                </p>
              </div>
              <div className="actions">
                <a
                  className="btn white"
                  href={tel ? `tel:${tel}` : `/clients/${clientSlug}`}
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

      <Footer brand={brand} clientName={client.name} clientSlug={clientSlug} />
      <HubScripts />

      {articleLd ? (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: articleLd }}
        />
      ) : null}
      {breadcrumbLd ? (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: breadcrumbLd }}
        />
      ) : null}
    </div>
  );
}

export default async function ClientBlogPage({
  params,
}: {
  params: Promise<{ client: string; slug: string }>;
}) {
  const { client: clientSlug, slug } = await params;
  const data = await resolvePublicContentDataAccess();
  return renderClientBlogPage(clientSlug, slug, { data });
}
