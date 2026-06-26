/**
 * Shared fixtures for the PR 015 render suites — an injected, in-memory
 * `PublicContentDataAccess` so the SSR logic is unit-tested with no live DB.
 *
 * The fixture enforces the SAME fail-closed contract the production seam must:
 * `loadPublishedPiece` returns a row ONLY when its status is 'published'; any
 * other status (draft/review/approved/archived) resolves to null. This is what
 * lets the status-filter test prove a non-published slug is never served.
 */

import type {
  PublicContentDataAccess,
  PublicClient,
  PublishedPiece,
  ReferencedHeroAsset,
} from "@/lib/content/context";
import type { ContentStatus } from "@sagemark/schema-flywheel";
import type { GeoFaqItem } from "@sagemark/core";

export const CLIENT_SLUG = "whispering-willows";
export const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OTHER_CLIENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** An internal row the fixture stores (carries status so the seam can filter). */
export interface FixturePiece {
  clientId: string;
  slug: string;
  title: string;
  body: string;
  excerpt?: string | null;
  metaDescription?: string | null;
  faqData?: GeoFaqItem[] | null;
  status: ContentStatus;
  publishedAt?: string | null;
  updatedAt?: string | null;
  /** D7 cluster columns (PR 017 homepage grouping). */
  clusterRole?: string | null;
  funnelStage?: string | null;
}

function toPublished(r: FixturePiece): PublishedPiece {
  return {
    clientId: r.clientId,
    slug: r.slug,
    title: r.title,
    body: r.body,
    excerpt: r.excerpt ?? null,
    metaDescription: r.metaDescription ?? null,
    faqData: r.faqData ?? null,
    publishedAt: r.publishedAt ?? null,
    updatedAt: r.updatedAt ?? null,
    clusterRole: r.clusterRole ?? null,
    funnelStage: r.funnelStage ?? null,
  };
}

export interface FixtureOptions {
  clients?: PublicClient[];
  pieces?: FixturePiece[];
  /** Persisted hero assets keyed by slug (PR 017 — the render-gate fixture). */
  heroAssets?: ReferencedHeroAsset[];
}

/**
 * Build a fail-closed in-memory public seam from injected clients + pieces.
 * `loadPublishedPiece`/`listPublishedPieces` expose ONLY published rows.
 */
export function makePublicData(opts: FixtureOptions = {}): PublicContentDataAccess {
  const clients = opts.clients ?? [
    { id: CLIENT_ID, blogSlug: CLIENT_SLUG, name: "Whispering Willows" },
  ];
  const pieces = opts.pieces ?? [];
  const heroAssets = opts.heroAssets ?? [];

  return {
    async resolveClientByBlogSlug(blogSlug) {
      return clients.find((c) => c.blogSlug === blogSlug) ?? null;
    },
    async loadPublishedPiece(clientId, slug) {
      const row = pieces.find(
        (p) => p.clientId === clientId && p.slug === slug,
      );
      // FAIL-CLOSED: only a 'published' row is ever returned.
      if (!row || row.status !== "published") return null;
      return toPublished(row);
    },
    async listPublishedPieces(clientId) {
      return pieces
        .filter((p) => p.clientId === clientId && p.status === "published")
        .map(toPublished);
    },
    async resolveHeroAssets(_clientId, slugs) {
      // Return only the seeded assets whose slug the body references.
      return heroAssets.filter((a) => slugs.includes(a.slug));
    },
  };
}

/** A canonical published piece with FAQ + a placeholder marker in the body. */
export function publishedPiece(over: Partial<FixturePiece> = {}): FixturePiece {
  return {
    clientId: CLIENT_ID,
    slug: "what-is-memory-care",
    title: "What is memory care?",
    body:
      "## What is memory care?\n\n" +
      "[photo: front porch of the community]\n\n" +
      "Memory care is a specialized type of long-term care designed for people " +
      "living with dementia. It combines a secured, calming environment with " +
      "trained staff.\n\n" +
      "- Secured, calming environment\n" +
      "- Dementia-trained staff\n\n" +
      "[cta: schedule a tour]\n",
    excerpt: "A short, plain-language overview of memory care.",
    metaDescription: "What memory care is and who it serves.",
    faqData: [
      {
        question: "What is memory care?",
        answer:
          "Memory care is specialized long-term care for people living with dementia, " +
          "combining a secured environment with dementia-trained staff.",
      },
      {
        question: "Is memory care the same as a nursing home?",
        answer:
          "No. Memory care is residential, home-like care focused on day-to-day " +
          "needs, not hospital-level medical treatment.",
      },
    ],
    status: "published",
    publishedAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    ...over,
  };
}
