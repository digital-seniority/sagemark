/**
 * Reachability gate — sitemap == published+indexable set, BOTH directions
 * (PR 016, lane render-geo, build P1.R.2). The CI regression backstop for GEO
 * reachability.
 *
 * THE INVARIANT (both directions):
 *   (a) every URL in the sitemap is a published+indexable piece's URL — no
 *       draft / review / approved / archived / non-indexable URL LEAKS into the
 *       sitemap; and
 *   (b) every published+indexable piece's URL is in the sitemap — no published
 *       piece is ORPHANED / unreachable.
 *
 * The set is computed INDEPENDENTLY of the sitemap serializer
 * (`computeIndexableUrlSet`, reading PR 015's `listPublishedPieces` seam) and
 * cross-checked against the URLs PARSED OUT of the actual rendered sitemap
 * (`buildSitemapXml` via `handleSitemap`). If the route's URL convention ever
 * drifts from the canonical set, OR a non-published row leaks in, OR a published
 * row is dropped, the diff is non-empty and this gate FAILS.
 *
 * "indexable" == published (this build): `PublishedPiece` carries no per-piece
 * `noindex`/`excluded` flag, and the seam returns published-only rows, so the
 * two collapse. `isIndexable` is the single place that tightens when a flag is
 * added. See `src/lib/render/indexable-set.ts` for the documented assumption.
 *
 * FAILING-CASE PROOF: each direction has a test that INJECTS a sitemap-vs-set
 * mismatch and asserts the diff catches it — proving the gate is not vacuously
 * green (it would actually fail on a real leak/orphan).
 */

import { describe, it, expect } from "vitest";

import { handleSitemap } from "@/app/clients/[client]/sitemap.xml/route";
import {
  computeIndexableUrlSet,
  parseSitemapUrls,
  diffReachability,
  pieceUrl,
  clientHubUrl,
} from "@/lib/render/indexable-set";
import { makePublicData, publishedPiece, CLIENT_SLUG } from "./fixtures";

const ORIGIN = "https://hub.example.com";
const req = (path: string) => new Request(`${ORIGIN}${path}`);

/** Render the real sitemap and parse its `<loc>` URLs into a set (crawler's view). */
async function sitemapUrlSet(
  data: ReturnType<typeof makePublicData>,
  clientSlug = CLIENT_SLUG,
): Promise<Set<string>> {
  const res = await handleSitemap(
    req(`/clients/${clientSlug}/sitemap.xml`),
    clientSlug,
    { data },
  );
  expect(res.status).toBe(200);
  return parseSitemapUrls(await res.text());
}

describe("reachability gate — sitemap == published+indexable set (both directions)", () => {
  it("PASSES on a healthy client: the two sets are EQUAL (no leaks, no orphans)", async () => {
    // A realistic mix: published pieces (must appear) + non-published noise
    // (must be absent). The gate must conclude the sets are identical.
    const data = makePublicData({
      pieces: [
        publishedPiece({ slug: "pub-1" }),
        publishedPiece({ slug: "pub-2" }),
        publishedPiece({ slug: "pub-3" }),
        publishedPiece({ slug: "draft-1", status: "draft" }),
        publishedPiece({ slug: "review-1", status: "review" }),
        publishedPiece({ slug: "approved-1", status: "approved" }),
        publishedPiece({ slug: "archived-1", status: "archived" }),
      ],
    });

    const sitemapUrls = await sitemapUrlSet(data);
    const indexableUrls = await computeIndexableUrlSet(data, ORIGIN, CLIENT_SLUG);

    const diff = diffReachability(sitemapUrls, indexableUrls);

    // ── BOTH DIRECTIONS, the core assertion ──────────────────────────────────
    // (a) no URL in the sitemap is outside the indexable set (no leak):
    expect(diff.leakedIntoSitemap).toEqual([]);
    // (b) no URL in the indexable set is missing from the sitemap (no orphan):
    expect(diff.missingFromSitemap).toEqual([]);
    // Equivalently: the sets are exactly equal.
    expect([...sitemapUrls].sort()).toEqual([...indexableUrls].sort());

    // Sanity: the equal set is the 3 published pieces + the hub root (size 4),
    // and contains none of the non-published slugs.
    expect(indexableUrls.size).toBe(4);
    expect(indexableUrls.has(clientHubUrl(ORIGIN, CLIENT_SLUG))).toBe(true);
    expect(indexableUrls.has(pieceUrl(ORIGIN, CLIENT_SLUG, "pub-2"))).toBe(true);
    for (const leaked of ["draft-1", "review-1", "approved-1", "archived-1"]) {
      expect(sitemapUrls.has(pieceUrl(ORIGIN, CLIENT_SLUG, leaked))).toBe(false);
    }
  });

  it("direction (a): a non-published piece is NOT leaked into the sitemap", async () => {
    // An archived piece exists; it must not be reachable via the sitemap, and
    // the indexable set must not contain it — so neither side leaks it.
    const data = makePublicData({
      pieces: [
        publishedPiece({ slug: "live" }),
        publishedPiece({ slug: "gone", status: "archived" }),
      ],
    });
    const sitemapUrls = await sitemapUrlSet(data);
    const indexableUrls = await computeIndexableUrlSet(data, ORIGIN, CLIENT_SLUG);

    const goneUrl = pieceUrl(ORIGIN, CLIENT_SLUG, "gone");
    expect(sitemapUrls.has(goneUrl)).toBe(false);
    expect(indexableUrls.has(goneUrl)).toBe(false);
    // No leak in this direction.
    expect(diffReachability(sitemapUrls, indexableUrls).leakedIntoSitemap).toEqual([]);
  });

  it("direction (b): every published piece is reachable (no orphan)", async () => {
    const data = makePublicData({
      pieces: [
        publishedPiece({ slug: "alpha" }),
        publishedPiece({ slug: "beta" }),
        publishedPiece({ slug: "gamma" }),
      ],
    });
    const sitemapUrls = await sitemapUrlSet(data);
    const indexableUrls = await computeIndexableUrlSet(data, ORIGIN, CLIENT_SLUG);

    // Every indexable URL is present in the sitemap.
    for (const u of indexableUrls) {
      expect(sitemapUrls.has(u)).toBe(true);
    }
    expect(diffReachability(sitemapUrls, indexableUrls).missingFromSitemap).toEqual([]);
  });

  it("empty client (only the hub root) is consistent both directions", async () => {
    const data = makePublicData({ pieces: [] });
    const sitemapUrls = await sitemapUrlSet(data);
    const indexableUrls = await computeIndexableUrlSet(data, ORIGIN, CLIENT_SLUG);
    const diff = diffReachability(sitemapUrls, indexableUrls);
    expect(diff.leakedIntoSitemap).toEqual([]);
    expect(diff.missingFromSitemap).toEqual([]);
    // Just the hub root on both sides.
    expect(indexableUrls).toEqual(new Set([clientHubUrl(ORIGIN, CLIENT_SLUG)]));
  });
});

// ─── FAILING-CASE PROOF ────────────────────────────────────────────────────────
// The gate above is only meaningful if it would actually FAIL on a real mismatch.
// These tests INJECT a sitemap-vs-set divergence in each direction and assert the
// diff catches it (non-empty in the expected direction). This proves the gate is
// not vacuously green.
describe("reachability gate — failing-case proof (both directions detected)", () => {
  it("direction (a) FAILS when a non-indexable URL leaks INTO the sitemap", async () => {
    // The healthy, equal sets:
    const data = makePublicData({
      pieces: [publishedPiece({ slug: "pub-1" }), publishedPiece({ slug: "pub-2" })],
    });
    const indexableUrls = await computeIndexableUrlSet(data, ORIGIN, CLIENT_SLUG);

    // Inject a LEAK: a draft URL that should NEVER be in the sitemap appears in
    // the sitemap's URL set (simulating a route regression that stopped filtering
    // by status). The indexable set (correctly) does not contain it.
    const leakedUrl = pieceUrl(ORIGIN, CLIENT_SLUG, "secret-draft");
    const corruptedSitemap = new Set([...indexableUrls, leakedUrl]);

    const diff = diffReachability(corruptedSitemap, indexableUrls);
    // The gate catches the leak …
    expect(diff.leakedIntoSitemap).toEqual([leakedUrl]);
    // … the other direction stays clean (this is purely a direction-(a) failure).
    expect(diff.missingFromSitemap).toEqual([]);

    // And the assertion the real gate makes would FAIL here:
    expect(() => expect(diff.leakedIntoSitemap).toEqual([])).toThrow();
  });

  it("direction (b) FAILS when a published piece is MISSING from the sitemap (orphan)", async () => {
    const data = makePublicData({
      pieces: [
        publishedPiece({ slug: "pub-1" }),
        publishedPiece({ slug: "pub-2" }),
        publishedPiece({ slug: "orphan" }),
      ],
    });
    const indexableUrls = await computeIndexableUrlSet(data, ORIGIN, CLIENT_SLUG);

    // Inject an ORPHAN: drop a published piece's URL from the sitemap set
    // (simulating a route regression that skipped a row). The indexable set still
    // (correctly) contains it.
    const orphanUrl = pieceUrl(ORIGIN, CLIENT_SLUG, "orphan");
    const corruptedSitemap = new Set(
      [...indexableUrls].filter((u) => u !== orphanUrl),
    );

    const diff = diffReachability(corruptedSitemap, indexableUrls);
    // The gate catches the orphan …
    expect(diff.missingFromSitemap).toEqual([orphanUrl]);
    // … the other direction stays clean (this is purely a direction-(b) failure).
    expect(diff.leakedIntoSitemap).toEqual([]);

    // And the assertion the real gate makes would FAIL here:
    expect(() => expect(diff.missingFromSitemap).toEqual([])).toThrow();
  });
});
