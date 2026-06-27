/**
 * PR 017 / P1.R.3 — hero-image provenance + license suite (DR-033).
 *
 * Proves the in-process `@sagemark/imagegen` wiring in `hero-image.ts`:
 *   - PEXELS-STOCK-FIRST: a stock hit returns immediately with a RECORDED
 *     license + attribution (no generation).
 *   - GENERATED fallback (only behind `IMAGEGEN_LIVE`): the result carries a
 *     recorded generated license (model id+version) — provenance present.
 *   - FAIL-CLOSED store: with the default NOT_WIRED store the generate path
 *     degrades to null (placeholder-strip) — it never throws a 500.
 *   - LIVE gated OFF: with no live flag + no stock, the result is null (no spend).
 *   - MODERATION refusal degrades to null (not a throw).
 *   - The RENDER GATE (`resolveHeroAsset`): an asset with NO license (or no url)
 *     is refused — an unprovenanced asset is never surfaced (criterion 3).
 *
 * All injected — zero network, zero Gateway spend.
 */

import { describe, it, expect } from "vitest";
import {
  makeFakeImageGenerator,
  makeInMemoryImageStore,
  makeDryRunSignUrl,
  makeNotWiredImageStore,
} from "@sagemark/imagegen";

import {
  ensureHeroAsset,
  resolveHeroAsset,
  makePexelsLicense,
  type PexelsPhoto,
  type HeroToolDeps,
} from "@/lib/tools/hero-image";
import { toReferencedImages, type ReferencedHeroAsset } from "@/lib/content/context";

const TENANCY = {
  workspaceId: "ws-1",
  clientId: "client-1",
  slug: "sunlit-common-room",
};

const STOCK_PHOTO: PexelsPhoto = {
  id: 123,
  url: "https://www.pexels.com/photo/123/",
  photographer: "Jane Doe",
  src: { large2x: "https://images.pexels.com/photos/123/large2x.jpg" },
  alt: "A sunlit common room",
};

/** Deps with a stub Pexels search that returns a stock hit. */
function stockDeps(photo: PexelsPhoto | null): HeroToolDeps {
  return {
    pexelsSearch: async () => photo,
    live: () => false,
  };
}

/** Deps with NO stock + the LIVE generated path on (in-memory store, fake gen). */
function liveGenDeps(): HeroToolDeps {
  return {
    pexelsSearch: async () => null, // no stock → fall through to generate
    live: () => true,
    generator: makeFakeImageGenerator({ costReported: 0 }),
    store: makeInMemoryImageStore(),
    signUrl: makeDryRunSignUrl(),
  };
}

describe("ensureHeroAsset — Pexels-stock-first (preferred, licensed)", () => {
  it("returns a stock asset with a recorded license + attribution", async () => {
    const asset = await ensureHeroAsset({ ...TENANCY, deps: stockDeps(STOCK_PHOTO) });
    expect(asset).not.toBeNull();
    expect(asset!.source).toBe("pexels");
    expect(asset!.url).toBe(STOCK_PHOTO.src.large2x);
    // DR-033: the license is RECORDED (non-null) — uniform with generated.
    expect(asset!.license).not.toBeNull();
    expect(asset!.license!.provider).toBe("pexels");
    expect(asset!.license!.attribution).toContain("Jane Doe");
    expect(asset!.license!.sourceUrl).toBe(STOCK_PHOTO.url);
  });

  it("makePexelsLicense records terms + attribution + sourceUrl", () => {
    const lic = makePexelsLicense(STOCK_PHOTO);
    expect(lic.provider).toBe("pexels");
    expect(lic.terms).toMatch(/Pexels License/i);
    expect(lic.attribution).toContain("Jane Doe");
    expect(lic.sourceUrl).toBe(STOCK_PHOTO.url);
  });
});

describe("ensureHeroAsset — generated fallback (behind IMAGEGEN_LIVE)", () => {
  it("generates with a RECORDED generated license (provenance) when live", async () => {
    const asset = await ensureHeroAsset({ ...TENANCY, deps: liveGenDeps() });
    expect(asset).not.toBeNull();
    expect(asset!.source).toBe("generated");
    expect(asset!.license).not.toBeNull();
    expect(asset!.license!.provider).toBe("generated");
    // The model id+version is recorded as the provenance terms.
    expect(asset!.license!.terms).toBeTruthy();
    expect(asset!.url).toBeTruthy();
  });

  it("records the generation in the imagegen store (provenance row)", async () => {
    const store = makeInMemoryImageStore();
    await ensureHeroAsset({
      ...TENANCY,
      deps: {
        pexelsSearch: async () => null,
        live: () => true,
        generator: makeFakeImageGenerator(),
        store,
        signUrl: makeDryRunSignUrl(),
      },
    });
    expect(store.records.length).toBe(1);
    expect(store.records[0]!.license.provider).toBe("generated");
    expect(store.records[0]!.status).toBe("succeeded");
  });
});

describe("ensureHeroAsset — fail-closed degradation (F8)", () => {
  it("returns null (degrade) with the NOT_WIRED store — never throws", async () => {
    const asset = await ensureHeroAsset({
      ...TENANCY,
      deps: {
        pexelsSearch: async () => null,
        live: () => true,
        generator: makeFakeImageGenerator(),
        store: makeNotWiredImageStore(), // throws on every call
        signUrl: makeDryRunSignUrl(),
      },
    });
    expect(asset).toBeNull();
  });

  it("returns null when live is OFF and there is no stock (no spend)", async () => {
    const asset = await ensureHeroAsset({ ...TENANCY, deps: stockDeps(null) });
    expect(asset).toBeNull();
  });

  it("degrades to null on a moderation refusal (not a throw)", async () => {
    const asset = await ensureHeroAsset({
      ...TENANCY,
      // A subject the default local moderator refuses (deny-listed content).
      subject: "graphic violence and gore",
      deps: {
        pexelsSearch: async () => null,
        live: () => true,
        generator: makeFakeImageGenerator(),
        store: makeInMemoryImageStore(),
        signUrl: makeDryRunSignUrl(),
      },
    });
    expect(asset).toBeNull();
  });
});

describe("resolveHeroAsset — the RENDER GATE (criterion 3)", () => {
  const licensed: ReferencedHeroAsset = {
    slug: "x",
    source: "pexels",
    url: "https://img/x.jpg",
    license: { provider: "pexels", terms: "Pexels License" },
  };
  const unlicensed: ReferencedHeroAsset = {
    slug: "x",
    source: "generated",
    url: "https://img/x.png",
    license: null,
  };
  const noUrl: ReferencedHeroAsset = {
    slug: "x",
    source: "pexels",
    url: null,
    license: { provider: "pexels" },
  };

  it("returns a LICENSED asset for render", async () => {
    const out = await resolveHeroAsset("x", async () => licensed);
    expect(out).toEqual(licensed);
  });

  it("BLOCKS an UNLICENSED (unprovenanced) asset → null", async () => {
    const out = await resolveHeroAsset("x", async () => unlicensed);
    expect(out).toBeNull();
  });

  it("BLOCKS an asset with no renderable URL → null", async () => {
    const out = await resolveHeroAsset("x", async () => noUrl);
    expect(out).toBeNull();
  });

  it("returns null when the asset is not persisted (placeholder-strip)", async () => {
    const out = await resolveHeroAsset("x", async () => null);
    expect(out).toBeNull();
  });
});

describe("toReferencedImages — publish-gate mapping (DR-033)", () => {
  const licensed: ReferencedHeroAsset = {
    slug: "a",
    source: "generated",
    url: "u",
    license: { provider: "generated", terms: "m@v" },
  };
  const unlicensed: ReferencedHeroAsset = {
    slug: "b",
    source: "pexels",
    url: "u",
    license: null,
  };

  it("a licensed reference → resolved + licensed", () => {
    expect(toReferencedImages(["a"], [licensed])).toEqual([
      { slug: "a", resolved: true, licensed: true },
    ]);
  });

  it("an unlicensed reference → resolved but NOT licensed (blocks publish)", () => {
    expect(toReferencedImages(["b"], [unlicensed])).toEqual([
      { slug: "b", resolved: true, licensed: false },
    ]);
  });

  it("an orphaned reference (no asset row) → unresolved (blocks publish)", () => {
    expect(toReferencedImages(["missing"], [])).toEqual([
      { slug: "missing", resolved: false, licensed: false },
    ]);
  });
});
