/**
 * `generateHeroImage` — the SEO ImageGen orchestrator entry point (`imagegen/1`).
 *
 * MODELLED ON flywheel-main `packages/videogen/imagegen/generate-scene-bg.ts`
 * (`generateSceneBackground`) and ADAPTED for the SEO hero-image use case. The
 * pipeline shape is the same (build spec → route → compile → generate → persist
 * → sign URL); the SEO differences are:
 *
 *   - JOB is "hero" (or "photo"), not "scene-background".
 *   - PRE-SPEND MODERATION is run FIRST (injected `moderator`) → a typed refusal
 *     before any paid generate call (the reference left moderation to the
 *     caller; here it is part of the orchestrator so the worker can't skip it).
 *   - A PER-REQUEST COST CAP is checked PRE-SPEND (`costCapUsd`) → refuse
 *     over-cap before spend.
 *   - The spec carries HEALTHCARE / SENIOR-LIVING constraints (respectful,
 *     photoreal, no text/logos/watermarks, no identifiable faces) — this is a
 *     memory-care / senior-living product.
 *   - TENANCY is `(workspaceId, clientId)`; the provenance row records the
 *     AI-generated license (SEO Never-list #8: unlicensed assets are blocked
 *     from publish, so the record MUST exist).
 *
 * All I/O is INJECTED (`HeroImageDeps`): tests use the in-memory store + the
 * fake generator (zero spend); the live /api/run path wires the Gateway
 * generator (DR-013 metered, no raw key) + (Stage-2) the Supabase store.
 *
 * ── Stage-2 follow-up (DR candidate) ──
 * The live `GeneratedImageStore` (`store-supabase.ts`) + the `generated_images`
 * provenance table + the `seo-generated-images` bucket + workspace-scoped RLS
 * are Stage 2 (schema-tenancy + live infra). Stage 1 ships the injected store
 * INTERFACE + an in-memory fake + a fail-closed NOT_WIRED store (`./store`).
 */

import { createHash } from "node:crypto";

import { compileSpec } from "./compile";
import { routeModel, type RouteOptions } from "./router";
import { getCapability } from "./capability";
import type { ImageGenerator } from "./generate";
import {
  persistGeneratedImage,
  type GeneratedImageStore,
} from "./persist";
import {
  SURCHARGE_CREDITS_PER_IMAGE,
  withinCostCap,
  CostCapExceededError,
  ESTIMATED_USD_PER_IMAGE_BY_TIER,
} from "./cost";
import {
  makeLocalPromptModerator,
  type PromptModerator,
} from "./moderate";
import {
  IMAGE_SPEC_VERSION,
  CanonicalImageSpecSchema,
  type CanonicalImageSpec,
  type ImageAspect,
  type ImageJob,
} from "./spec";
import type { GeneratedAssetLicense } from "./assets";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface HeroImageDeps {
  /** Live: `makeGatewayImageGenerator`; test: `makeFakeImageGenerator`. */
  generator: ImageGenerator;
  /** Live (Stage-2): Supabase store; Stage-1: in-memory or NOT_WIRED store. */
  store: GeneratedImageStore;
  /** Mint a signed read URL for a storage key. Injected (no storage internals here). */
  signUrl: (args: { key: string; workspaceId: string }) => Promise<string>;
  /**
   * Pre-spend prompt moderator. Defaults to the conservative local deny-list
   * (`makeLocalPromptModerator`) when omitted, so callers can't accidentally
   * skip moderation; pass a real moderation-model moderator to override.
   */
  moderator?: PromptModerator;
}

// ---------------------------------------------------------------------------
// Args + result
// ---------------------------------------------------------------------------

export interface GenerateHeroImageArgs {
  /**
   * Human-readable description of the hero/photo subject — becomes the image
   * `subject`. Typically derived from the page brief (e.g. "a warm, sunlit
   * common room in a senior-living community, residents chatting over coffee").
   * MUST NOT contain PII — written verbatim to the provenance log.
   */
  subject: string;
  /** Visual style hint. Defaults to a respectful photoreal style when omitted. */
  style?: string;
  /** Aspect ratio of the hero slot — drives image dimensions. Default "16:9". */
  aspect?: ImageAspect;
  /** Which job to generate for. Default "hero". */
  job?: Extract<ImageJob, "hero" | "photo">;
  /** SEO tenancy — the workspace (Stage-2 RLS axis). */
  workspaceId: string;
  /** SEO tenancy — the client/site this image belongs to. */
  clientId: string;
  /** The page slug / brief id this image is for (joins back to the content). */
  slug: string;
  /**
   * Per-request cost cap in USD (pre-spend). When the tier's conservative
   * estimate exceeds it, the request is REFUSED before any spend
   * (`CostCapExceededError`). Omit to skip the per-request cap.
   */
  costCapUsd?: number;
  /** Routing override (tier or model id). Default: the job's default model. */
  route?: RouteOptions;
  /** Optional seed for reproducibility (dropped for models without seed support). */
  seed?: number;
  /** Optional palette hints from the brand/brief. */
  palette?: CanonicalImageSpec["palette"];
  deps: HeroImageDeps;
}

/** A typed moderation refusal — returned (not thrown) so callers branch cleanly. */
export interface HeroImageRefusal {
  ok: false;
  refusal: "moderation";
  reason: string;
}

/** A successful hero-image generation result. */
export interface HeroImageResult {
  ok: true;
  /** Signed (or dry-run) URL the SEO page renders. */
  url: string;
  /** The kept asset id (dedup-stable). */
  assetId: string;
  /** The AI-generated license record (SEO Never-list #8 precondition). */
  license: GeneratedAssetLicense;
  /** Provenance: the model the image was generated with. */
  modelId: string;
  modelVersion: string;
  /** Provider-reported per-image cost, if any (recorded on the provenance row). */
  costReported?: number;
  /** sha256 of the persisted bytes. */
  contentHash: string;
  /** sha256 of the compiled prompt (provenance). */
  promptHash: string;
  /** The seed the model actually used, if reported. */
  seedUsed?: number;
}

/**
 * Healthcare / senior-living hero constraints (memory-care context). Respectful,
 * photoreal, no text/logo/watermark, no identifiable faces (privacy + the
 * Never-list). Folded into the prompt by the compiler.
 */
export const HERO_CONSTRAINTS = [
  "no text",
  "no logos",
  "no watermarks",
  "no UI elements",
  "no identifiable faces",
  "respectful and dignified portrayal of older adults",
  "warm natural lighting",
  "photorealistic",
] as const;

/** The default respectful photoreal style for SEO hero images. */
export const DEFAULT_HERO_STYLE =
  "photoreal editorial photography, warm and respectful, natural light";

// ---------------------------------------------------------------------------
// generateHeroImage
// ---------------------------------------------------------------------------

/**
 * Generate an SEO hero (or photo) image. Pipeline:
 *   1. PRE-SPEND moderate the subject (injected/default moderator) → typed
 *      refusal before any paid call.
 *   2. Build a `CanonicalImageSpec` (job hero/photo, healthcare-appropriate
 *      constraints) and validate it.
 *   3. Route to a model (default per job; tier/model overridable).
 *   4. PRE-SPEND cost-cap check against the routed model's tier estimate →
 *      `CostCapExceededError` before spend.
 *   5. Compile spec → model-correct request.
 *   6. Generate via the injected `ImageGenerator` (live: metered Gateway; test:
 *      fake).
 *   7. Persist bytes + provenance (AI-generated license) via the injected store.
 *   8. Resolve a fresh signed URL.
 *
 * Returns a `HeroImageResult` on success or a `HeroImageRefusal` when moderation
 * blocks the prompt. Throws `CostCapExceededError` (over cap, pre-spend) or any
 * generate/persist error (the route maps these to a typed error response).
 */
export async function generateHeroImage(
  args: GenerateHeroImageArgs,
): Promise<HeroImageResult | HeroImageRefusal> {
  const job: Extract<ImageJob, "hero" | "photo"> = args.job ?? "hero";
  const aspect: ImageAspect = args.aspect ?? "16:9";

  // 1. PRE-SPEND moderation — before any paid call.
  const moderator = args.deps.moderator ?? makeLocalPromptModerator();
  const verdict = await moderator.moderate(args.subject);
  if (!verdict.allowed) {
    return {
      ok: false,
      refusal: "moderation",
      reason: verdict.reason ?? "moderation-blocked",
    };
  }

  // 2. Build + validate the SEO hero spec.
  const spec: CanonicalImageSpec = CanonicalImageSpecSchema.parse({
    schemaVersion: IMAGE_SPEC_VERSION,
    job,
    subject: args.subject,
    style: args.style ?? DEFAULT_HERO_STYLE,
    composition: "",
    palette: args.palette ?? [],
    text: [],
    locale: "en",
    constraints: [...HERO_CONSTRAINTS],
    aspectRatio: aspect,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
  });

  // 3. Route to a model.
  const modelId = routeModel(job, args.route);
  const capability = getCapability(modelId);

  // 4. PRE-SPEND cost-cap check (refuse over-cap before spend).
  if (!withinCostCap({ tier: capability.tier, costCapUsd: args.costCapUsd })) {
    throw new CostCapExceededError(
      ESTIMATED_USD_PER_IMAGE_BY_TIER[capability.tier],
      args.costCapUsd!,
    );
  }

  // 5. Compile.
  const compiled = compileSpec(spec, modelId);

  // 6. Generate (injected boundary).
  const image = await args.deps.generator.generate(compiled);

  // 7. Persist (+ AI-generated license, provenance row).
  const promptHash = createHash("sha256").update(compiled.prompt).digest("hex");
  const { asset, license, contentHash } = await persistGeneratedImage({
    store: args.deps.store,
    workspaceId: args.workspaceId,
    clientId: args.clientId,
    slug: args.slug,
    spec,
    promptHash,
    generated: image,
    costCredits: SURCHARGE_CREDITS_PER_IMAGE,
  });

  // 8. Resolve a fresh signed URL at call time (mirrors generate-scene-bg). If
  //    the asset already has an externalUrl, keep it; otherwise sign the key.
  let url = asset.externalUrl;
  if (!url && asset.storageKey) {
    url = await args.deps.signUrl({
      key: asset.storageKey,
      workspaceId: args.workspaceId,
    });
  }

  return {
    ok: true,
    url: url ?? "",
    assetId: asset.id,
    license,
    modelId: image.modelId,
    modelVersion: image.modelVersion,
    costReported: image.costReported,
    contentHash,
    promptHash,
    seedUsed: image.seedUsed,
  };
}

// ---------------------------------------------------------------------------
// [photo:slug] resolution (P1.R.3)
// ---------------------------------------------------------------------------

/**
 * Parse a `[photo:slug]` placeholder token. Returns the slug (the token's
 * payload) or null when the token is not a photo placeholder. P1.R.3 scans
 * rendered content for these tokens and replaces each with a generated hero
 * image.
 *
 * Accepts `[photo:some-slug]` and `[photo: some slug]` (trimmed). The slug is
 * the brief/page identifier the subject is derived from.
 */
export function parsePhotoToken(token: string): string | null {
  const m = /^\[photo:\s*([^\]]+?)\s*\]$/i.exec(token.trim());
  return m?.[1] ?? null;
}

/**
 * Resolve a `[photo:slug]` placeholder to a generated hero image (P1.R.3's
 * use). Maps the token's slug → a `generateHeroImage` call whose `subject` is
 * derived from the slug (or an explicit brief, when P1.R.3 has one).
 *
 * P1.R.3 will call this per placeholder it finds in the rendered page, passing
 * the tenancy `(workspaceId, clientId)`, the resolved subject/brief for the
 * slug, and the same injected deps as the route. The result's `url` replaces the
 * token; the `license` is recorded so the Never-list #8 publish gate passes.
 *
 * Stage-1 derives a minimal subject from the slug when no brief is supplied
 * (`"a senior-living hero image about <slug words>"`). P1.R.3 SHOULD pass a
 * richer `subject` from the page brief instead — the slug fallback is only so
 * this path is callable end-to-end today.
 */
export async function resolveHeroPlaceholder(args: {
  /** The placeholder token, e.g. "[photo:sunlit-common-room]" — or a bare slug. */
  token: string;
  /** Tenancy. */
  workspaceId: string;
  clientId: string;
  /**
   * Optional explicit subject/brief for the slug. When omitted, a minimal
   * subject is derived from the slug words (P1.R.3 SHOULD supply this).
   */
  subject?: string;
  aspect?: ImageAspect;
  costCapUsd?: number;
  route?: RouteOptions;
  deps: HeroImageDeps;
}): Promise<HeroImageResult | HeroImageRefusal | null> {
  const slug = parsePhotoToken(args.token) ?? args.token.trim();
  if (!slug) return null;

  const subject =
    args.subject ??
    `a warm, respectful senior-living scene about ${slug.replace(/[-_]+/g, " ")}`;

  return generateHeroImage({
    subject,
    aspect: args.aspect,
    job: "hero",
    workspaceId: args.workspaceId,
    clientId: args.clientId,
    slug,
    costCapUsd: args.costCapUsd,
    route: args.route,
    deps: args.deps,
  });
}
