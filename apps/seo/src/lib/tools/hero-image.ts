/**
 * hero-image — in-process hero-image resolution for the resource-library
 * homepage (PR 017 / P1.R.3, lane render-geo).
 *
 * THE IMAGE BOUNDARY between the SSR homepage and `@sagemark/imagegen`. Wires
 * `generateHeroImage` IN-PROCESS (source-consumed, like `@sagemark/core`), with
 * the F8 trip-hazards from audit-004 designed OUT:
 *
 *  1. NEVER inline-SSR-blocking. The homepage renders from ALREADY-PERSISTED
 *     hero assets (`resolveHeroAsset` reads the persisted/signed asset; it does
 *     NOT generate). Generation is a SEPARATE step (`ensureHeroAsset`, intended
 *     for a job/route) — `page.tsx` only ever calls the read path. So a cold
 *     homepage degrades to placeholder-strip, it never awaits a live image gen.
 *
 *  2. FAIL-CLOSED store inject. The default store is `makeNotWiredImageStore()`:
 *     when `IMAGEGEN_LIVE` / creds / bucket are absent, the generate path throws
 *     `StoreNotWiredError` and `ensureHeroAsset` catches it → returns null (the
 *     caller degrades to placeholder-strip, P1.R.1 behavior) — NOT a 500.
 *
 *  3. PEXELS-STOCK-FIRST, then generate. We prefer a properly-licensed Pexels
 *     stock photo (the `PEXELS_API_KEY` path) before falling back to a generated
 *     image. Stock images carry a recorded license + attribution (DR-033), so
 *     the publish/render license gate is uniform across stock + generated.
 *
 *  4. The LIVE generated path is gated behind `IMAGEGEN_LIVE` (OFF by default):
 *     no live Gateway spend in tests/SSR. Tenancy `(workspaceId, clientId)` and
 *     the per-request cost cap are enforced HOST-SIDE here (passed into
 *     `generateHeroImage`, which checks them pre-spend).
 *
 * All I/O is INJECTED via `HeroToolDeps` so the unit tests run with the in-memory
 * store + fake generator + a stub Pexels fetch (zero network, zero spend).
 */

import {
  generateHeroImage,
  makeNotWiredImageStore,
  makeFakeImageGenerator,
  type HeroImageDeps,
  type HeroImageResult,
  type HeroImageRefusal,
  type ImageGenerator,
  type GeneratedImageStore,
} from "@sagemark/imagegen";

import type {
  ReferencedHeroAsset,
  HeroAssetLicense,
} from "@/lib/content/context";

// ---------------------------------------------------------------------------
// Pexels stock fetch (the preferred, licensed source)
// ---------------------------------------------------------------------------

/** A single Pexels search hit (the subset we read). */
export interface PexelsPhoto {
  id: number;
  url: string;
  photographer: string;
  src: { large2x?: string; large?: string; original?: string };
  alt?: string;
}

/**
 * Inject the Pexels HTTP search. Default reads `PEXELS_API_KEY` and calls the
 * Pexels v1 search API (mirrors `scripts/fetch-pexels-images.py`); returns null
 * when no key is set OR no landscape result is found (then we fall back to gen).
 * No key committed — the key is read from env at call time.
 */
export type PexelsSearch = (query: string) => Promise<PexelsPhoto | null>;

/** The default Pexels search — keyed off `PEXELS_API_KEY`, landscape, first hit. */
export function makeDefaultPexelsSearch(
  fetchImpl: typeof fetch = fetch,
): PexelsSearch {
  return async (query: string) => {
    const key = process.env.PEXELS_API_KEY?.trim();
    if (!key) return null; // no key → skip stock, fall back to generate
    const url =
      "https://api.pexels.com/v1/search?" +
      new URLSearchParams({
        query,
        per_page: "5",
        orientation: "landscape",
      }).toString();
    const res = await fetchImpl(url, { headers: { Authorization: key } });
    if (!res.ok) return null;
    const json = (await res.json()) as { photos?: PexelsPhoto[] };
    return json.photos?.[0] ?? null;
  };
}

/** The Pexels License terms note (recorded on the stock asset's license). */
export const PEXELS_LICENSE_TERMS = "Pexels License (free to use)";

/** Build the recorded license/attribution for a Pexels stock asset (DR-033). */
export function makePexelsLicense(photo: PexelsPhoto): HeroAssetLicense {
  return {
    provider: "pexels",
    terms: PEXELS_LICENSE_TERMS,
    attribution: `Photo by ${photo.photographer} on Pexels`,
    sourceUrl: photo.url,
  };
}

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

/** Injected host-side seams for hero resolution. */
export interface HeroToolDeps {
  /** The imagegen generator. Default: fake (zero spend); live wires the Gateway. */
  generator?: ImageGenerator;
  /** The imagegen store. Default: fail-closed NOT_WIRED (degrade to placeholder). */
  store?: GeneratedImageStore;
  /** Sign a storage key → read URL. Default: a fail-closed throw (no live storage). */
  signUrl?: (args: { key: string; workspaceId: string }) => Promise<string>;
  /** Pexels stock search. Default: the env-keyed v1 search. */
  pexelsSearch?: PexelsSearch;
  /**
   * Whether the LIVE generated path is enabled. Default reads `IMAGEGEN_LIVE==="1"`.
   * OFF by default — no live Gateway spend in tests/SSR. When false, generation
   * is skipped entirely (stock-only; otherwise null → placeholder-strip).
   */
  live?: () => boolean;
}

function defaultLive(): boolean {
  return process.env.IMAGEGEN_LIVE === "1";
}

function failClosedSignUrl(): (args: {
  key: string;
  workspaceId: string;
}) => Promise<string> {
  return async () => {
    throw new Error(
      "hero-image: signUrl is not wired (no live storage). Inject a signUrl or run with the in-memory store.",
    );
  };
}

// ---------------------------------------------------------------------------
// ensureHeroAsset — the GENERATION step (job/route, NEVER inline in page.tsx)
// ---------------------------------------------------------------------------

export interface EnsureHeroArgs {
  /** The `[photo:slug]` slug this asset is for (joins back to the body token). */
  slug: string;
  /** Tenancy — the workspace (cost-cap + RLS axis), enforced host-side. */
  workspaceId: string;
  /** Tenancy — the client/site this image belongs to. */
  clientId: string;
  /**
   * The hero subject/brief (healthcare-appropriate). Used as the Pexels query AND
   * the generation subject. Derived from the page brief by the caller; falls back
   * to the slug words when omitted.
   */
  subject?: string;
  /** Per-request cost cap (USD), enforced pre-spend by `generateHeroImage`. */
  costCapUsd?: number;
  deps?: HeroToolDeps;
}

/**
 * Ensure a hero asset exists for a slug, returning its renderable + LICENSED
 * record — or null when it cannot be produced (then the caller strips the
 * placeholder). This is the GENERATION/ACQUISITION step and is intended to run
 * OUT of the SSR render path (a job or an explicit route), because:
 *   - it may hit the Pexels network, and
 *   - the live branch may call the metered Gateway.
 *
 * Order (DR-033 + F8 Pexels-first):
 *   1. PEXELS STOCK FIRST — a licensed stock hit returns immediately with a
 *      recorded Pexels license + attribution.
 *   2. GENERATE (only if `live()` is true) — `generateHeroImage` with the
 *      injected store/generator; the generated license is recorded by persist.
 *      A moderation refusal or a NOT_WIRED store → null (degrade), never throw.
 *   3. Otherwise null → placeholder-strip.
 *
 * NEVER throws on the not-wired/refusal paths — it returns null so the render
 * degrades gracefully (a 500 would be the wrong failure mode for a homepage).
 */
export async function ensureHeroAsset(
  args: EnsureHeroArgs,
): Promise<ReferencedHeroAsset | null> {
  const deps = args.deps ?? {};
  const subject =
    args.subject ??
    `a warm, respectful senior-living scene about ${args.slug.replace(/[-_]+/g, " ")}`;

  // 1. Pexels stock first (preferred, licensed).
  const search = deps.pexelsSearch ?? makeDefaultPexelsSearch();
  try {
    const photo = await search(subject);
    if (photo) {
      const url = photo.src.large2x ?? photo.src.large ?? photo.src.original ?? null;
      if (url) {
        return {
          slug: args.slug,
          source: "pexels",
          url,
          license: makePexelsLicense(photo),
          alt: photo.alt ?? subject,
        };
      }
    }
  } catch {
    // A stock-fetch failure is non-fatal — fall through to generate / null.
  }

  // 2. Generated fallback — ONLY when the live path is enabled (no SSR/test spend).
  const live = (deps.live ?? defaultLive)();
  if (!live) return null;

  const heroDeps: HeroImageDeps = {
    generator: deps.generator ?? makeFakeImageGenerator(),
    store: deps.store ?? makeNotWiredImageStore(),
    signUrl: deps.signUrl ?? failClosedSignUrl(),
  };

  let result: HeroImageResult | HeroImageRefusal;
  try {
    result = await generateHeroImage({
      subject,
      job: "hero",
      aspect: "16:9",
      workspaceId: args.workspaceId,
      clientId: args.clientId,
      slug: args.slug,
      costCapUsd: args.costCapUsd,
      deps: heroDeps,
    });
  } catch {
    // Fail-closed store (NOT_WIRED), cost-cap, or generate error → degrade.
    return null;
  }

  if (!result.ok) return null; // moderation refusal → degrade (placeholder-strip)

  return {
    slug: args.slug,
    source: "generated",
    url: result.url || null,
    // The generated license is the DR-033 record (model id+version, NOT NULL).
    license: {
      provider: result.license.provider,
      terms: result.license.model,
    },
    alt: subject,
  };
}

// ---------------------------------------------------------------------------
// resolveHeroAsset — the READ step (safe to call from SSR; never generates)
// ---------------------------------------------------------------------------

/**
 * Resolve a slug to its ALREADY-PERSISTED hero asset for SSR render. This is the
 * path `page.tsx` uses: it returns a persisted asset (with its recorded license)
 * or null. It NEVER generates — generation is `ensureHeroAsset` (a job/route), so
 * the SSR homepage never blocks on a live image generation (F8).
 *
 * The persisted-asset lookup is INJECTED (`load`) — in production it is the
 * public seam's `resolveHeroAssets` (workspace-scoped, license-bearing); the
 * homepage applies the RENDER GATE (drop any asset whose `license` is null).
 */
export async function resolveHeroAsset(
  slug: string,
  load: (slug: string) => Promise<ReferencedHeroAsset | null>,
): Promise<ReferencedHeroAsset | null> {
  const asset = await load(slug);
  if (!asset) return null;
  // RENDER GATE (DR-033): refuse to surface an unprovenanced/unlicensed asset.
  if (asset.license == null) return null;
  if (!asset.url) return null;
  return asset;
}
