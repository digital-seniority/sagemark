/**
 * Public content-hub SSR render route (PR 015, lane render-geo) — demo-parity
 * article shell (lane hub-visual).
 *
 *   /clients/[client]/blog/[slug]
 *
 * Renders ONE published content piece as a Server Component (full body in the
 * INITIAL HTML — the SEO/GEO requirement). Wrapped in the demo hub chrome
 * (`.hub` Topbar/Footer + ported stylesheet) with a centered reading column
 * (`.wrap.read` + `.prose`). Fail-closed: `[client]` resolves by public
 * `blog_slug`; only `status='published'` is served (else 404); `[photo:]`/`[cta:]`
 * directives are stripped; the body is rendered escape-first by `renderArticleBody`.
 *
 * The inner `<article>` element is kept ATTRIBUTE-FREE — the SSR contract test
 * pins `/<article>…</article>` on the static markup.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  NOT_WIRED_PUBLIC_DATA_ACCESS,
  type PublicContentDataAccess,
  type PublishedPiece,
  type PublicClient,
} from "@/lib/content/context";
import { renderArticleBody } from "@/lib/render/client-blog";
import { serializeFaqJsonLd } from "@/lib/render/build-faq-jsonld";
import { buildBrandStyleTag, parseBrandSpec } from "@/lib/render/brand-theme";
import { HUB_STYLESHEET } from "@/lib/render/hub-stylesheet";
import { buildArticleJsonLd, buildBreadcrumbJsonLd } from "@/lib/render/build-article-jsonld";
import { Topbar } from "../../_hub/Topbar";
import { Footer } from "../../_hub/Footer";
import { HubScripts } from "../../_hub/HubScripts";
import { resolvePublicContentDataAccess } from "@/lib/content/resolve-public-data-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Injectable deps so SSR tests render with a fixture seam (no live DB). */
export interface RenderDeps {
  data: PublicContentDataAccess;
  /** Optional: base URL for JSON-LD canonical + breadcrumb (injected in tests; live = request.url origin). */
  origin?: string;
}

const DEFAULT_DEPS: RenderDeps = { data: NOT_WIRED_PUBLIC_DATA_ACCESS };

/**
 * Resolve (client, published-piece) from the URL segments, fail-closed. Returns
 * null whenever the client is unknown OR the slug is not a PUBLISHED piece — the
 * caller turns null into a 404 (never leaks existence of a non-published piece).
 */
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

/**
 * Render the published article (Server Component). The returned JSX is what
 * Next serializes into the INITIAL HTML response. Branched on `clusterRole`:
 * article, faq, checklist. Wrapped in the demo hub chrome.
 */
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
  const phone = brand?.nap?.phone ?? null;

  // Body: placeholder-stripped, injection-safe HTML.
  const bodyHtml = renderArticleBody(piece.body);

  const role = piece.clusterRole ?? "article";
  const isChecklist = role === "checklist";
  const isFaq = role === "faq";

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

  const mainRole = isChecklist ? "checklist-page" : isFaq ? "faq-page" : "article-page";

  return (
    <div className="hub" data-role={mainRole}>
      {/* Injection-safe brand theme vars + the ported hub design system */}
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: brandCss }} />
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: HUB_STYLESHEET }} />

      <Topbar brand={brand} clientName={client.name} clientSlug={clientSlug} phone={phone} />

      <main className="article">
        <div className="wrap">
          <div className="read">
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <a href={`/clients/${clientSlug}`}>{client.name}</a> ·{" "}
              <span>{piece.title}</span>
            </nav>

            <div className="article-head">
              <h1>{piece.title}</h1>
              {piece.excerpt ? (
                <p className="dek" data-role="excerpt">
                  {piece.excerpt}
                </p>
              ) : null}
            </div>

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
                {/* Print behaviour wired by HubScripts via data-role="print-cta" */}
                <button className="btn gold" data-role="print-cta">
                  Print this checklist
                </button>
              </div>
            ) : null}

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
      </main>

      <Footer brand={brand} clientName={client.name} clientSlug={clientSlug} />
      <HubScripts />

      {/* Article JSON-LD */}
      {articleLd ? (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: articleLd }}
        />
      ) : null}

      {/* BreadcrumbList JSON-LD */}
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
