/**
 * indexable-set — the canonical "what SHOULD be in the sitemap" set (PR 016,
 * lane render-geo, build P1.R.2).
 *
 * THE REACHABILITY SOURCE OF TRUTH. PR 015 ships the sitemap (`sitemap.xml/
 * route.ts`) as a SERIALIZER of the published set. PR 016 adds the *gate* that
 * proves, in CI, that the sitemap and the published+indexable set agree in BOTH
 * directions — no draft/archived URL leaks INTO the sitemap, and no published
 * piece is left OUT of it (orphaned/unreachable). To assert that, we need the
 * set computed INDEPENDENTLY of the sitemap serializer, from the same data seam.
 * This module is that independent computation.
 *
 * "INDEXABLE" — DEFINITION + ASSUMPTION.
 *   A piece is *indexable* iff it is PUBLISHED **and** not excluded from
 *   indexing. The `content_pieces` row / `PublishedPiece` projection (DR-026,
 *   `context.ts`) carries NO per-piece `noindex`/`excluded`/`robots` flag — and
 *   the public read seam (`listPublishedPieces`) already returns published-only
 *   rows. So in THIS build the two collapse:
 *
 *       indexable  ==  published
 *
 *   This module encodes that as the single `isIndexable` predicate so that, the
 *   day a `noindex` flag is added to the seam, the gate tightens in ONE place
 *   (extend `isIndexable`) — the both-directions assertion needs no change.
 *
 * URL CANONICALIZATION. The set is a set of ABSOLUTE URLs built with the SAME
 * convention the sitemap uses (`buildSitemapXml`): `{origin}/clients/{client}/
 * blog/{slug}` per piece, plus the client hub root `{origin}/clients/{client}`
 * (the branded homepage, not /blog). The gate compares THIS set against the URLs
 * parsed out of the rendered
 * sitemap XML — if the route ever diverged from this convention, the gate fails.
 *
 * Pure + deterministic; no React, no network, no `server-only` marker (imported
 * by plain-Node tests and the CI gate).
 */

import type {
  PublicContentDataAccess,
  PublishedPiece,
} from "@/lib/content/context";

/**
 * Is this piece part of the canonical indexable set?
 *
 * indexable == published AND not excluded-from-indexing. The seam hands us
 * published-only rows and there is no per-piece `noindex` flag yet (see the
 * file header), so today this is a tautology over the seam's output. It is kept
 * as an explicit, single-source predicate: add the `noindex` check HERE when the
 * seam grows one, and both the sitemap route and this gate stay consistent.
 */
export function isIndexable(_piece: PublishedPiece): boolean {
  // No `noindex`/`excluded` field exists on `PublishedPiece` (DR-026). The seam
  // (`listPublishedPieces`) already filters to status='published'. Therefore
  // every piece the seam returns is indexable. Documented assumption: when an
  // exclusion flag lands, gate it here.
  return true;
}

/** Build the absolute client-hub-root URL (mirrors `buildSitemapXml`). */
export function clientHubUrl(origin: string, clientSlug: string): string {
  return `${origin}/clients/${encodeURIComponent(clientSlug)}`;
}

/** Build the absolute URL for one published piece (mirrors `buildSitemapXml`). */
export function pieceUrl(
  origin: string,
  clientSlug: string,
  pieceSlug: string,
): string {
  return `${origin}/clients/${encodeURIComponent(clientSlug)}/blog/${encodeURIComponent(pieceSlug)}`;
}

/**
 * Compute the canonical published+indexable URL set for one client, scoped by
 * the client's resolved id (multi-tenant: never cross-client). Returns the
 * ABSOLUTE URLs that the sitemap is REQUIRED to contain — exactly, no more, no
 * fewer. Includes the client hub root (the sitemap lists it too).
 *
 * Reuses PR 015's published-piece read (`listPublishedPieces`) — the SAME source
 * the sitemap route reads — then applies `isIndexable` and canonicalizes URLs.
 * The gate compares this set against the sitemap's parsed URLs in both
 * directions.
 *
 * Throws if the client slug does not resolve (fail-closed: a gate over a
 * non-existent client is a bug, not an empty pass).
 */
export async function computeIndexableUrlSet(
  data: PublicContentDataAccess,
  origin: string,
  clientSlug: string,
): Promise<Set<string>> {
  const client = await data.resolveClientByBlogSlug(clientSlug);
  if (!client) {
    throw new Error(
      `reachability: client slug '${clientSlug}' does not resolve — ` +
        `cannot compute the indexable set for a non-existent client`,
    );
  }
  const pieces = await data.listPublishedPieces(client.id);
  const urls = new Set<string>();
  // The client hub root is always part of the reachable set (the sitemap lists it).
  urls.add(clientHubUrl(origin, clientSlug));
  for (const p of pieces) {
    if (!isIndexable(p)) continue;
    urls.add(pieceUrl(origin, clientSlug, p.slug));
  }
  return urls;
}

/**
 * Parse the `<loc>` URLs out of a sitemap XML document into a Set. Mirrors what
 * a crawler reads — the gate compares this against `computeIndexableUrlSet`. XML
 * entities the serializer emits (`&amp;` etc.) are decoded so the two sets are
 * compared as real URLs, not escaped strings.
 */
export function parseSitemapUrls(xml: string): Set<string> {
  const urls = new Set<string>();
  const re = /<loc>([\s\S]*?)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    urls.add(xmlUnescape(m[1]!.trim()));
  }
  return urls;
}

/** Inverse of the sitemap route's `xmlEscape` (the 5 XML-significant entities). */
function xmlUnescape(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/** The result of a both-directions reachability comparison. */
export interface ReachabilityDiff {
  /** URLs in the sitemap but NOT in the indexable set (leaks: draft/archived/etc.). */
  leakedIntoSitemap: string[];
  /** URLs in the indexable set but NOT in the sitemap (orphans: unreachable pieces). */
  missingFromSitemap: string[];
}

/**
 * Compare the sitemap's URL set against the canonical indexable set in BOTH
 * directions. An empty diff (both arrays empty) means the sets are EQUAL — the
 * reachability invariant holds. The gate test asserts both arrays are empty.
 */
export function diffReachability(
  sitemapUrls: Set<string>,
  indexableUrls: Set<string>,
): ReachabilityDiff {
  const leakedIntoSitemap: string[] = [];
  for (const u of sitemapUrls) {
    if (!indexableUrls.has(u)) leakedIntoSitemap.push(u);
  }
  const missingFromSitemap: string[] = [];
  for (const u of indexableUrls) {
    if (!sitemapUrls.has(u)) missingFromSitemap.push(u);
  }
  leakedIntoSitemap.sort();
  missingFromSitemap.sort();
  return { leakedIntoSitemap, missingFromSitemap };
}
