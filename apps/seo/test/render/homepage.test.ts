/**
 * PR 017 / P1.R.3 — the resource-library homepage SSR + cluster-map suite.
 *
 * Covers the acceptance criteria:
 *   1. The homepage groups pieces by `funnel_stage` with `cluster_role` labels,
 *      driven by the FIRST-CLASS columns (`clusterRole`/`funnelStage`), not jsonb.
 *   2. Each spoke card links to its piece; the pillar links to every spoke (no
 *      orphan spoke by construction; `orphanSpokes` proves the invariant).
 *   3. A license-gated hero renders ONLY when its persisted asset carries a
 *      non-null license (DR-033 render gate); an unlicensed/unresolved asset is
 *      blocked from rendering.
 *   4. Published-only + tenancy (fail-closed): an unknown client → 404; no
 *      cross-client serve; no leaked `[photo:]`/`[cta:]` tokens.
 *
 * The Server Component is rendered to a STATIC HTML string (the initial-response
 * markup) with react-dom/server.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { renderHomePage, resolveHome } from "@/app/clients/[client]/page";
import {
  buildClusterMap,
  collectHeroSlugs,
  FUNNEL_STAGE_LABELS,
} from "@/lib/render/hub-homepage";
import type { ReferencedHeroAsset } from "@/lib/content/context";
import { makePublicData, publishedPiece, CLIENT_SLUG, CLIENT_ID } from "./fixtures";

// A small published cluster: a pillar + one spoke per funnel stage, off the
// first-class columns. The pillar body carries a `[photo:]` hero reference.
function clusterPieces() {
  return [
    publishedPiece({
      slug: "memory-care-guide",
      title: "The complete memory care guide",
      excerpt: "Everything families need to know.",
      clusterRole: "pillar",
      funnelStage: "awareness",
      body: "## Guide\n\n[photo: sunlit common room]\n\nA warm overview.\n",
      faqData: null,
    }),
    publishedPiece({
      slug: "what-is-memory-care",
      title: "What is memory care?",
      excerpt: "A plain-language overview.",
      clusterRole: "spoke",
      funnelStage: "awareness",
      body: "Memory care is specialized care.\n",
      faqData: null,
    }),
    publishedPiece({
      slug: "memory-care-vs-assisted-living",
      title: "Memory care vs assisted living",
      excerpt: "How to choose.",
      clusterRole: "spoke",
      funnelStage: "consideration",
      body: "Comparing your options.\n",
      faqData: null,
    }),
    publishedPiece({
      slug: "how-to-schedule-a-tour",
      title: "How to schedule a tour",
      excerpt: "Take the next step.",
      clusterRole: "spoke",
      funnelStage: "decision",
      body: "Ready when you are.\n",
      faqData: null,
    }),
  ];
}

const LICENSED_HERO: ReferencedHeroAsset = {
  slug: "sunlit common room",
  source: "pexels",
  url: "https://images.pexels.com/photos/1/x.jpg",
  license: {
    provider: "pexels",
    terms: "Pexels License (free to use)",
    attribution: "Photo by Jane Doe on Pexels",
    sourceUrl: "https://www.pexels.com/photo/1/",
  },
  alt: "A sunlit common room",
};

const UNLICENSED_HERO: ReferencedHeroAsset = {
  slug: "sunlit common room",
  source: "generated",
  url: "https://example.test/orphan.png",
  license: null, // unprovenanced → must NOT render (DR-033 render gate)
};

async function renderHtml(clientSlug: string, data = makePublicData({ pieces: clusterPieces() })) {
  const element = await renderHomePage(clientSlug, { data });
  return renderToStaticMarkup(element);
}

describe("buildClusterMap (off the first-class columns)", () => {
  it("groups spokes by funnel stage with the named stage labels", () => {
    const data = clusterPieces();
    const map = buildClusterMap(data.map((p) => ({
      ...p,
      excerpt: p.excerpt ?? null,
      metaDescription: p.metaDescription ?? null,
      faqData: p.faqData ?? null,
      publishedAt: p.publishedAt ?? null,
      updatedAt: p.updatedAt ?? null,
      clusterRole: p.clusterRole ?? null,
      funnelStage: p.funnelStage ?? null,
    })));

    expect(map.pillar?.slug).toBe("memory-care-guide");
    const awareness = map.sections.find((s) => s.stage === "awareness")!;
    const consideration = map.sections.find((s) => s.stage === "consideration")!;
    const decision = map.sections.find((s) => s.stage === "decision")!;
    expect(awareness.label).toBe(FUNNEL_STAGE_LABELS.awareness);
    // The pillar is NOT a spoke card; only the awareness SPOKE is grouped here.
    expect(awareness.cards.map((c) => c.slug)).toEqual(["what-is-memory-care"]);
    expect(consideration.cards.map((c) => c.slug)).toEqual([
      "memory-care-vs-assisted-living",
    ]);
    expect(decision.cards.map((c) => c.slug)).toEqual(["how-to-schedule-a-tour"]);
  });

  it("the pillar links to EVERY spoke — no orphan spoke by construction", () => {
    const data = clusterPieces().map((p) => ({
      ...p,
      excerpt: p.excerpt ?? null,
      metaDescription: p.metaDescription ?? null,
      faqData: p.faqData ?? null,
      publishedAt: p.publishedAt ?? null,
      updatedAt: p.updatedAt ?? null,
      clusterRole: p.clusterRole ?? null,
      funnelStage: p.funnelStage ?? null,
    }));
    const map = buildClusterMap(data);
    expect(map.pillar?.spokeSlugs.sort()).toEqual(
      ["how-to-schedule-a-tour", "memory-care-vs-assisted-living", "what-is-memory-care"].sort(),
    );
    expect(map.orphanSpokes).toEqual([]);
  });

  it("with NO pillar, every spoke is reported as an orphan (defect surfaced)", () => {
    const map = buildClusterMap([]);
    expect(map.pillar).toBeNull();
    expect(map.orphanSpokes).toEqual([]);
  });

  it("collectHeroSlugs reads the [photo:] references from the bodies", () => {
    const data = clusterPieces().map((p) => ({
      ...p,
      excerpt: p.excerpt ?? null,
      metaDescription: p.metaDescription ?? null,
      faqData: p.faqData ?? null,
      publishedAt: p.publishedAt ?? null,
      updatedAt: p.updatedAt ?? null,
      clusterRole: p.clusterRole ?? null,
      funnelStage: p.funnelStage ?? null,
    }));
    expect(collectHeroSlugs(data)).toEqual(["sunlit common room"]);
  });
});

describe("homepage SSR (criterion 1+2)", () => {
  it("renders the three named funnel-stage sections in the initial HTML", async () => {
    const html = await renderHtml(CLIENT_SLUG);
    expect(html).toContain(FUNNEL_STAGE_LABELS.awareness);
    expect(html).toContain(FUNNEL_STAGE_LABELS.consideration);
    expect(html).toContain(FUNNEL_STAGE_LABELS.decision);
    expect(html).toContain('data-role="cluster-stages"');
    expect(html).toContain('data-stage="awareness"');
  });

  it("each spoke card links to its piece", async () => {
    const html = await renderHtml(CLIENT_SLUG);
    expect(html).toContain(`href="/clients/${CLIENT_SLUG}/blog/what-is-memory-care"`);
    expect(html).toContain(
      `href="/clients/${CLIENT_SLUG}/blog/memory-care-vs-assisted-living"`,
    );
    expect(html).toContain(`href="/clients/${CLIENT_SLUG}/blog/how-to-schedule-a-tour"`);
  });

  it("the pillar links out (the cluster owner)", async () => {
    const html = await renderHtml(CLIENT_SLUG);
    expect(html).toContain(`href="/clients/${CLIENT_SLUG}/blog/memory-care-guide"`);
    expect(html).toContain("The complete memory care guide");
  });

  it("surfaces the statistic callout + tour CTA + quality section", async () => {
    const html = await renderHtml(CLIENT_SLUG);
    expect(html).toContain('data-role="statistic-callout"');
    expect(html).toContain('data-role="tour-cta"');
    expect(html).toContain('data-role="quality"');
  });

  it("never leaks a [photo:]/[cta:] token into the homepage HTML", async () => {
    const html = await renderHtml(CLIENT_SLUG);
    expect(html).not.toMatch(/\[photo:/i);
    expect(html).not.toMatch(/\[cta:/i);
  });
});

describe("DR-033 render gate — hero is license-gated (criterion 3)", () => {
  it("renders the hero image + license badge when the asset is LICENSED", async () => {
    const data = makePublicData({
      pieces: clusterPieces(),
      heroAssets: [LICENSED_HERO],
    });
    const html = await renderHtml(CLIENT_SLUG, data);
    expect(html).toContain('data-role="hero-image"');
    expect(html).toContain(LICENSED_HERO.url!);
    // The license badge surfaces the recorded provenance/attribution.
    expect(html).toContain('data-role="license-badge"');
    expect(html).toContain("Photo by Jane Doe on Pexels");
  });

  it("BLOCKS rendering an UNLICENSED (unprovenanced) hero asset", async () => {
    const data = makePublicData({
      pieces: clusterPieces(),
      heroAssets: [UNLICENSED_HERO],
    });
    const html = await renderHtml(CLIENT_SLUG, data);
    // No hero image figure, and the orphan URL never appears in the markup.
    expect(html).not.toContain('data-role="hero-image"');
    expect(html).not.toContain("orphan.png");
  });

  it("degrades to NO hero image when no asset is persisted (placeholder-strip)", async () => {
    const data = makePublicData({ pieces: clusterPieces(), heroAssets: [] });
    const html = await renderHtml(CLIENT_SLUG, data);
    expect(html).not.toContain('data-role="hero-image"');
    // The rest of the homepage still renders (no 500).
    expect(html).toContain('data-role="resource-home"');
  });
});

describe("published-only + tenancy (criterion 4, fail-closed)", () => {
  it("an unknown client slug resolves to null (the page 404s)", async () => {
    const resolved = await resolveHome("no-such-client", {
      data: makePublicData({ pieces: clusterPieces() }),
    });
    expect(resolved).toBeNull();
  });

  it("only lists pieces scoped to the resolved client (no cross-client serve)", async () => {
    const data = makePublicData({
      pieces: [
        ...clusterPieces(),
        publishedPiece({
          clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          slug: "other-client-piece",
          title: "Other client's piece",
          clusterRole: "spoke",
          funnelStage: "awareness",
          faqData: null,
        }),
      ],
    });
    const resolved = await resolveHome(CLIENT_SLUG, { data });
    expect(resolved).not.toBeNull();
    expect(resolved!.pieces.every((p) => p.clientId === CLIENT_ID)).toBe(true);
    expect(resolved!.pieces.find((p) => p.slug === "other-client-piece")).toBeUndefined();
  });

  it("does not list a non-published piece on the homepage", async () => {
    const data = makePublicData({
      pieces: [
        ...clusterPieces(),
        publishedPiece({
          slug: "draft-only",
          title: "Draft only",
          status: "draft",
          clusterRole: "spoke",
          funnelStage: "awareness",
          faqData: null,
        }),
      ],
    });
    const html = await renderHtml(CLIENT_SLUG, data);
    expect(html).not.toContain("draft-only");
    expect(html).not.toContain("Draft only");
  });
});
