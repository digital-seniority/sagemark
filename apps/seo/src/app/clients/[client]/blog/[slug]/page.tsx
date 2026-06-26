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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Injectable deps so SSR tests render with a fixture seam (no live DB). */
export interface RenderDeps {
  data: PublicContentDataAccess;
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
  const { piece } = resolved;

  // Body: placeholder-stripped, injection-safe HTML — embedded in the SSR markup.
  const bodyHtml = renderArticleBody(piece.body);
  // FAQ JSON-LD (empty string when the piece has no FAQ — then we emit nothing).
  const faqJsonLd = serializeFaqJsonLd(piece.faqData);

  return (
    <main>
      <article>
        <h1>{piece.title}</h1>
        {piece.excerpt ? <p data-role="excerpt">{piece.excerpt}</p> : null}
        <div
          data-role="article-body"
          // Safe: bodyHtml is escape-first rendered (see client-blog.ts).
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </article>
      {faqJsonLd ? (
        <script
          type="application/ld+json"
          // Safe: serializeFaqJsonLd is JSON.stringify + closing-tag neutralized.
          dangerouslySetInnerHTML={{ __html: faqJsonLd }}
        />
      ) : null}
    </main>
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
