/**
 * Tokenized client-review surface (PR 018 / P1.C.1, lane client-review).
 *
 *   /review/[token]
 *
 * THE CLIENT-FACING REVIEW LINK. An opaque token resolves — fail-closed, at the
 * DATA layer — to EXACTLY ONE `(workspaceId, clientId, pieceId, version)` tuple
 * (`resolveReviewToken`). An unknown/expired/revoked token, or a token whose
 * tuple no longer resolves, → `notFound()` (404), NEVER the content. A token for
 * client A can never read client B's piece or a different version: the denial is
 * the zero-rows DB lookup, not a UI conditional (the agency-ending-leak boundary,
 * both directions — AC#1).
 *
 * WHAT THE CLIENT SEES (and ONLY this):
 *   - the REAL published/draft hub, rendered by the EXISTING SSR render route
 *     (`/clients/[client]/blog/[slug]`, PR 015 — NOT a forked renderer) inside a
 *     SAME-ORIGIN, SANDBOXED iframe, with element-anchored pinned comments
 *     (PinOverlay + PreviewClickHandler + useIframePinDrop) and section Approve /
 *     Request-changes verbs (SectionApprovalBeat);
 *   - the paired SerpPreview (how the piece appears in search).
 *
 * WHAT THE CLIENT NEVER SEES (AC#2): the gate scorecard, credits, cost, model, or
 * raw markdown export. These are structurally absent — the page is handed ONLY
 * the review-safe `ReviewPreviewTarget` projection (slugs + SERP fields); no
 * internal/gate field is ever in scope to render. The iframe shows the public
 * SSR hub (published body only), not the studio inspector.
 *
 * Dynamic + node runtime, mirroring the SSR render route: the token resolves
 * per-request against the (unwired in this build) review data seam, so the page
 * renders at request time. Fail-closed by construction: the production seam
 * throws NOT_WIRED until the service-role Drizzle impl is wired (DR-006).
 */

import { notFound } from "next/navigation";

import {
  resolveReviewToken,
  NOT_WIRED_REVIEW_TOKEN_ACCESS,
  type ReviewTokenDataAccess,
  type ReviewPreviewTarget,
  type ReviewScope,
} from "@/lib/review/resolve-token";
import { ReviewPinCanvas } from "./PreviewClickHandler";
import { SectionApprovalBeat } from "./SectionApprovalBeat";
import { SerpPreview } from "./SerpPreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Injectable deps so the page resolves against a fixture seam (no live DB). */
export interface ReviewPageDeps {
  tokens: ReviewTokenDataAccess;
}

const DEFAULT_DEPS: ReviewPageDeps = { tokens: NOT_WIRED_REVIEW_TOKEN_ACCESS };

/**
 * The resolved, review-safe surface state: the tuple scope + the display target.
 * Returns null whenever the token does not resolve OR its tuple no longer maps to
 * a piece — the caller 404s (never leaks which case it was).
 */
export async function resolveReviewSurface(
  token: string,
  deps: ReviewPageDeps = DEFAULT_DEPS,
): Promise<{ scope: ReviewScope; target: ReviewPreviewTarget } | null> {
  const resolved = await resolveReviewToken(token, deps.tokens);
  if (!resolved.ok) return null;
  const target = await deps.tokens.resolvePreviewTarget(resolved.scope);
  if (!target) return null;
  return { scope: resolved.scope, target };
}

/**
 * Render the review surface (Server Component). Composed of: the SERP preview,
 * the iframe-backed pin canvas (the REAL SSR hub), and the section verbs.
 * `notFound()` on any unresolved token — fail-closed, never the content.
 */
export async function renderReviewPage(
  token: string,
  deps: ReviewPageDeps = DEFAULT_DEPS,
) {
  const surface = await resolveReviewSurface(token, deps);
  if (!surface) notFound();
  const { target } = surface;

  // The same-origin iframe src is the EXISTING SSR hub render route — the REAL
  // published/draft hub, NOT a forked renderer (PR 015). Built from the
  // review-safe slugs only.
  const previewSrc = `/clients/${encodeURIComponent(
    target.clientBlogSlug,
  )}/blog/${encodeURIComponent(target.pieceSlug)}`;

  // The reviewing client is identified by the token's tuple; the author label is
  // the token surface itself (no operator identity is exposed to the client).
  const author = `review:${token.slice(0, 12)}`;

  return (
    <main
      data-testid="review-surface"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
        gap: 24,
        padding: 24,
        minHeight: "100vh",
      }}
    >
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
          Review: {target.title}
        </h1>
        {/* The REAL hub in a same-origin sandboxed iframe + the pin layer. */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "70vh",
            borderRadius: 8,
            overflow: "hidden",
            border:
              "1px solid color-mix(in srgb, var(--foreground) 12%, transparent)",
          }}
        >
          <ReviewPinCanvas
            token={token}
            previewSrc={previewSrc}
            author={author}
          />
        </div>
      </section>

      <aside style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SerpPreview
          title={target.title}
          displayUrl={target.displayUrl}
          metaDescription={target.metaDescription}
        />
        <SectionApprovalBeat
          token={token}
          sectionLabel="Overall piece"
          author={author}
        />
      </aside>
    </main>
  );
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return renderReviewPage(token);
}
