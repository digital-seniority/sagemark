/**
 * hub-homepage — the cluster-map computation for the resource-library homepage
 * (PR 017 / P1.R.3, lane render-geo).
 *
 * THE HOMEPAGE DATA MODEL. Turns the client's PUBLISHED pieces into the grouped,
 * pillar+spoke structure the homepage template renders. The grouping is driven by
 * the FIRST-CLASS `cluster_role` / `funnel_stage` columns (D7, migration 0031) —
 * NOT re-derived from `brief_snapshot` jsonb (acceptance criterion: "driven by
 * the first-class columns").
 *
 * Acceptance criteria this module encodes:
 *   - Pieces are queried by `client_id` and grouped by `funnel_stage` with
 *     `cluster_role` labels (the three funnel stages awareness/consideration/
 *     decision, + the pillar).
 *   - Each spoke card links to its piece; the pillar links out to every spoke
 *     (no orphan spoke BY CONSTRUCTION — `orphanSpokes` surfaces any spoke not
 *     reachable from the pillar so the template/test can prove the invariant).
 *
 * Pure + deterministic; no React, no network. The page Server Component consumes
 * the returned `ClusterMap` and the resolved hero assets (resolved separately via
 * `resolveHeroAssets`, license-gated) to render the SSR homepage.
 */

import type { PublishedPiece } from "@/lib/content/context";
import { parseReferencedPhotoSlugs } from "@/lib/content/context";

/** The three top-of-funnel → bottom-of-funnel stages the homepage sections use. */
export const FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "decision",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** Human labels for each funnel stage (the named three-stage cluster section). */
export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  awareness: "Start here — understanding the basics",
  consideration: "Comparing your options",
  decision: "Ready to take the next step",
};

/** A spoke card the homepage grid renders. */
export interface SpokeCard {
  slug: string;
  title: string;
  excerpt: string | null;
  clusterRole: string;
  funnelStage: string | null;
}

/** A single funnel-stage section: a label + the spoke cards in that stage. */
export interface FunnelStageSection {
  stage: FunnelStage;
  label: string;
  cards: SpokeCard[];
}

/** The pillar (cornerstone) piece that links out to every spoke. */
export interface PillarPiece {
  slug: string;
  title: string;
  excerpt: string | null;
  /** Every spoke slug the pillar links to (no orphan spoke by construction). */
  spokeSlugs: string[];
}

/** The computed homepage cluster map. */
export interface ClusterMap {
  /** The pillar, or null when the client has no pillar/cornerstone piece yet. */
  pillar: PillarPiece | null;
  /** The three funnel-stage sections (always all three, possibly with no cards). */
  sections: FunnelStageSection[];
  /** Every spoke card (across stages), for the flat guide-card grid. */
  allSpokes: SpokeCard[];
  /**
   * Spokes NOT reachable from the pillar (the orphan-detection invariant). Empty
   * in the happy path — the pillar links out to every spoke. A non-empty list is
   * a content-structure defect the template/test surfaces.
   */
  orphanSpokes: SpokeCard[];
  /**
   * The `[photo:slug]` references the homepage body content carries (pillar +
   * spokes). The page resolves these to LICENSED hero assets (DR-033 render
   * gate); an unresolved/unlicensed slug is stripped, never surfaced.
   */
  heroSlugs: string[];
}

/** Is a cluster_role a pillar-grade role (the cornerstone that owns the cluster)? */
function isPillarRole(role: string | null): boolean {
  return role === "pillar" || role === "cornerstone";
}

/** Normalize a piece's funnel stage to one of the three homepage stages, or null. */
function toFunnelStage(stage: string | null): FunnelStage | null {
  if (stage === "awareness" || stage === "consideration" || stage === "decision") {
    return stage;
  }
  // 'retention' (and any unknown) is not one of the three homepage sections.
  return null;
}

function toCard(p: PublishedPiece): SpokeCard {
  return {
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    clusterRole: p.clusterRole ?? "spoke",
    funnelStage: p.funnelStage,
  };
}

/**
 * Build the homepage cluster map from a client's PUBLISHED pieces (already
 * scoped + published-only by the caller's seam read). Grouping is OFF the
 * first-class `clusterRole`/`funnelStage` columns.
 *
 * Pillar selection: the first piece whose `clusterRole` is pillar/cornerstone.
 * Spokes: every non-pillar published piece. The pillar links to EVERY spoke
 * (`spokeSlugs` = all spokes) so no spoke is orphaned by construction; any spoke
 * that (defensively) is not in that set is reported in `orphanSpokes`.
 */
export function buildClusterMap(pieces: PublishedPiece[]): ClusterMap {
  // The pillar is the first pillar/cornerstone-roled piece (deterministic order).
  const pillarPiece = pieces.find((p) => isPillarRole(p.clusterRole)) ?? null;
  const spokes = pieces.filter((p) => p !== pillarPiece);
  const allSpokes = spokes.map(toCard);

  // Group spokes into the three funnel-stage sections.
  const sections: FunnelStageSection[] = FUNNEL_STAGES.map((stage) => ({
    stage,
    label: FUNNEL_STAGE_LABELS[stage],
    cards: allSpokes.filter((c) => toFunnelStage(c.funnelStage) === stage),
  }));

  const pillar: PillarPiece | null = pillarPiece
    ? {
        slug: pillarPiece.slug,
        title: pillarPiece.title,
        excerpt: pillarPiece.excerpt,
        // The pillar links to EVERY spoke — no orphan spoke by construction.
        spokeSlugs: allSpokes.map((s) => s.slug),
      }
    : null;

  // Orphan detection: a spoke whose slug is not reachable from the pillar's
  // spokeSlugs. With the construction above this is always empty when a pillar
  // exists; when there is NO pillar, every spoke is (trivially) an orphan.
  const reachable = new Set(pillar?.spokeSlugs ?? []);
  const orphanSpokes = pillar
    ? allSpokes.filter((s) => !reachable.has(s.slug))
    : [...allSpokes];

  // Hero references the homepage body carries (pillar + every spoke body).
  const heroSlugs = collectHeroSlugs(pieces);

  return { pillar, sections, allSpokes, orphanSpokes, heroSlugs };
}

/** Collect the de-duplicated `[photo:slug]` references across all piece bodies. */
export function collectHeroSlugs(pieces: PublishedPiece[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pieces) {
    for (const slug of parseReferencedPhotoSlugs(p.body)) {
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(slug);
      }
    }
  }
  return out;
}
