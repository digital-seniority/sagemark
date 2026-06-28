/**
 * Public content-hub SSR render route (PR 015, lane render-geo).
 *
 *   /clients/[client]/blog/[slug]
 *
 * THE PUBLIC SURFACE. Renders ONE published content piece as a Server Component
 * so the full article body ships in the INITIAL HTML (acceptance criterion 1 —
 * the SEO/GEO requirement: crawlers + answer engines read server HTML, not a
 * client-hydrated body). Fail-closed:
 *   - `[client]` resolves a tenant by its public `blog_slug` — never a
 *     workspace/client UUID from the URL; every read is scoped by the resolved
 *     client id (no cross-client serve).
 *   - Only `status='published'` pieces are served; ANY non-published slug
 *     (draft/review/approved/archived) or unknown slug -> `notFound()` (404),
 *     never the content (criterion 4). The seam filters; the DB anon RLS policy
 *     (`content_pieces_public_read`, DR-023) is the authoritative second gate.
 *   - Placeholder directives (`[photo:]`/`[cta:]`) are stripped before render —
 *     none leak (criterion 3).
 *   - FAQ content emits valid FAQPage JSON-LD (criterion 2).
 *   - clusterRole branches rendering: article (Article+BreadcrumbList JSON-LD),
 *     faq (FAQPage JSON-LD), checklist (print-sheet, no JSON-LD).
 *
 * The body is rendered to injection-safe HTML by `renderArticleBody` (escape-
 * first) and embedded via `dangerouslySetInnerHTML` — safe by construction.
 *
 * Dynamic: this route reads per-request from the (unwired in this build) public
 * data seam, so it renders at request time (`force-dynamic`); no body is ever
 * statically baked from a non-published state.
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
import { buildArticleJsonLd, buildBreadcrumbJsonLd } from "@/lib/render/build-article-jsonld";
import { Topbar } from "../../_hub/Topbar";
import { Footer } from "../../_hub/Footer";
import { HubScripts } from "../../_hub/HubScripts";

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
  // Defense-in-depth: the seam must already scope by client, but never serve a
  // piece whose clientId disagrees with the resolved client (no cross-tenant).
  if (piece.clientId !== client.id) return null;
  return { client, piece };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ client: string; slug: string }>;
}): Promise<Metadata> {
  const { client: clientSlug, slug } = await params;
  const resolved = await resolvePublished(clientSlug, slug);
  if (!resolved) return { title: "Not found" };
  const { piece } = resolved;
  return {
    title: piece.title,
    description: piece.metaDescription ?? piece.excerpt ?? undefined,
  };
}

/**
 * Render the published article (Server Component). The returned JSX is what
 * Next serializes into the INITIAL HTML response.
 *
 * Slice 10: branched on `clusterRole` — article, faq, checklist.
 * Wrapped in hub chrome (Topbar/Footer/brand style).
 */
export async function renderClientBlogPage(
  clientSlug: string,
  pieceSlug: string,
  deps: RenderDeps = DEFAULT_DEPS,
) {
  const resolved = await resolvePublished(clientSlug, pieceSlug, deps);
  if (!resolved) {
    // Fail-closed: a non-published / unknown slug is a 404, never the content.
    notFound();
  }
  const { client, piece } = resolved;

  // Brand theming (Slice 9/10)
  const brand = parseBrandSpec(client.brandSpec);
  const brandCss = buildBrandStyleTag(brand);

  // Body: placeholder-stripped, injection-safe HTML.
  const bodyHtml = renderArticleBody(piece.body);

  // Branch on clusterRole to choose the page shape + JSON-LD.
  const role = piece.clusterRole ?? "article";

  // Article / BreadcrumbList JSON-LD (for non-faq, non-checklist).
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

  // FAQ JSON-LD: emit whenever faqData is non-empty, regardless of clusterRole.
  // (The clusterRole only controls the visual template, not whether faqData is emitted.)
  const faqJsonLd = serializeFaqJsonLd(piece.faqData);

  return (
    <>
      {/* Injection-safe brand theme vars */}
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: brandCss }} />
      <Topbar brand={brand} clientName={client.name} clientSlug={clientSlug} />

      <main data-role={isChecklist ? "checklist-page" : isFaq ? "faq-page" : "article-page"}>
        {isChecklist ? (
          // Printable checklist: simple, no JSON-LD, print CTA.
          <>
            <article data-role="checklist">
              <h1>{piece.title}</h1>
              {piece.excerpt ? <p data-role="excerpt">{piece.excerpt}</p> : null}
              <div
                data-role="article-body"
                // Safe: bodyHtml is escape-first rendered (see client-blog.ts).
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            </article>
            {/* Print behaviour wired by HubScripts via data-role="print-cta" */}
            <button
              data-role="print-cta"
              style={{
                display: "block",
                margin: "1.5rem auto",
                padding: "0.75rem 1.5rem",
                background: "var(--brand-accent, #c08a4e)",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "1rem",
                fontWeight: 600,
              }}
            >
              Print this checklist
            </button>
          </>
        ) : (
          // Article or FAQ: standard article chrome.
          <article>
            <h1>{piece.title}</h1>
            {piece.excerpt ? <p data-role="excerpt">{piece.excerpt}</p> : null}
            <div
              data-role="article-body"
              // Safe: bodyHtml is escape-first rendered (see client-blog.ts).
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </article>
        )}

        {/* FAQPage JSON-LD */}
        {faqJsonLd ? (
          <script
            type="application/ld+json"
            // Safe: serializeFaqJsonLd is JSON.stringify + closing-tag neutralized.
            dangerouslySetInnerHTML={{ __html: faqJsonLd }}
          />
        ) : null}
      </main>

      <Footer brand={brand} clientName={client.name} clientSlug={clientSlug} />
      <HubScripts />

      {/* Article JSON-LD */}
      {articleLd ? (
        <script
          type="application/ld+json"
          // Safe: buildArticleJsonLd is JSON.stringify + closing-tag neutralized.
          dangerouslySetInnerHTML={{ __html: articleLd }}
        />
      ) : null}

      {/* BreadcrumbList JSON-LD */}
      {breadcrumbLd ? (
        <script
          type="application/ld+json"
          // Safe: buildBreadcrumbJsonLd is JSON.stringify + closing-tag neutralized.
          dangerouslySetInnerHTML={{ __html: breadcrumbLd }}
        />
      ) : null}
    </>
  );
}

export default async function ClientBlogPage({
  params,
}: {
  params: Promise<{ client: string; slug: string }>;
}) {
  const { client: clientSlug, slug } = await params;
  return renderClientBlogPage(clientSlug, slug);
}
