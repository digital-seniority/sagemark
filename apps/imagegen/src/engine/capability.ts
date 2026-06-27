/**
 * ImageGen — Capability matrix (`imagegen/1`).
 *
 * PORTED from flywheel-main `packages/videogen/imagegen/capability.ts` and
 * ADAPTED for the SEO Creator: every capability ROW is unchanged (the
 * seed/negative-prompt/transparency/resolution FACTS are model-family truths
 * from the ImageGen Bible), but each row's `jobs` array is widened to include
 * `"hero"` and `"photo"` so the SEO hero/photo jobs can route to the same
 * confirmed-live gateway models. `DEFAULT_MODEL_FOR_JOB` gains hero/photo
 * defaults: hero (the page's marquee image) defaults to mid-tier flux-2-flex
 * for a sharper result; photo (inline support) defaults to the cheap draft
 * klein-4b. Model-id correctness is a config detail — these are the
 * IG-0-confirmed gateway ids from the reference; adjust if the gateway's live
 * image-model list differs.
 *
 * The per-model capability table (ImageGen Bible ch.02/03/11). Newer models are
 * NOT feature-supersets of older ones — gpt-image dropped transparency, Recraft
 * V4 dropped custom styles, Imagen dropped negative prompts (its API 400s on
 * `negativePrompt`). So EVERY backend choice and EVERY version bump is gated on
 * this matrix, never on the version number.
 *
 * THE GATE (audit finding A12): `capability.test.ts` freezes this table as a
 * snapshot — any edit to a pinned model's row fails the test until the snapshot
 * is updated in the same commit, forcing a routing review.
 */

import type { ImageAspect, ImageJob } from "./spec";

/** Watermark behaviour of a model's output (ch.10 provenance). */
export type WatermarkMode = "none" | "optional" | "always" | "synthid";

/** Pixel ceiling a model will produce. */
export interface Resolution {
  width: number;
  height: number;
}

/** One model's capabilities. All fields are load-bearing for compile/route. */
export interface ModelCapability {
  /** AI Gateway `"provider/model"` string (confirmed live, IG-0). */
  readonly id: string;
  /** Pinned model version — never "latest" (ch.07). */
  readonly modelVersion: string;
  /** Does the API accept + honour a seed? (GPT-Image: no.) */
  readonly seed: boolean;
  /** Does the API accept a negative prompt? (Imagen: no — 400s.) */
  readonly negativePrompt: boolean;
  /** Can it output transparency? (gpt-image dropped it.) */
  readonly transparency: boolean;
  /** Supported aspect ratios. */
  readonly aspectRatios: readonly ImageAspect[];
  /** Max output resolution; compile clamps requested dims to this. */
  readonly maxResolution: Resolution;
  /** Output watermark behaviour. */
  readonly watermark: WatermarkMode;
  /** License class (ch.10). Coarse; the full chain audit is v2. */
  readonly licenseClass: "commercial-ok" | "non-commercial" | "review";
  /** USD per delivered image, or null if token-priced/unconfirmed (IG-0). */
  readonly priceUsdPerImage: number | null;
  /** Tier — drives router default per job. */
  readonly tier: "draft" | "mid" | "final";
  /** Jobs this model is eligible for. */
  readonly jobs: readonly ImageJob[];
}

/**
 * The matrix. Keyed by the gateway model id. Frozen so callers can't mutate it
 * at runtime; the test snapshot is what enforces review-on-change.
 *
 * SEO ADAPTATION: every row is eligible for `scene-background` (the reference's
 * job, kept for parity) PLUS `hero` + `photo` (the SEO jobs). Hero/photo are
 * photoreal, senior-living-context images — the same models serve them well.
 */
export const CAPABILITY_MATRIX: Readonly<Record<string, ModelCapability>> =
  Object.freeze({
    // Klein-4B = BFL's schnell-class: fast, cheap, seedable. The DRAFT/photo
    // default. FLUX is guidance-distilled → no classic negative prompt (folded
    // into the positive prompt by compile.ts).
    "bfl/flux-2-klein-4b": {
      id: "bfl/flux-2-klein-4b",
      modelVersion: "flux-2-klein-4b",
      seed: true,
      negativePrompt: false,
      transparency: false,
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxResolution: { width: 2048, height: 2048 },
      watermark: "none",
      licenseClass: "commercial-ok",
      priceUsdPerImage: null,
      tier: "draft",
      jobs: ["scene-background", "hero", "photo"],
    },
    // Mid-tier FLUX.2 — the HERO default (sharper than draft for the marquee
    // image). Spike-confirmed working (returned seed + cost in providerMetadata).
    // No negative prompt (FLUX family).
    "bfl/flux-2-flex": {
      id: "bfl/flux-2-flex",
      modelVersion: "flux-2-flex",
      seed: true,
      negativePrompt: false,
      transparency: false,
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxResolution: { width: 2048, height: 2048 },
      watermark: "none",
      licenseClass: "commercial-ok",
      priceUsdPerImage: null,
      tier: "mid",
      jobs: ["scene-background", "hero", "photo"],
    },
    // Recraft V3: a raster/vector image model that DOES accept a negative
    // prompt — exercises the compiler's supported-negative dialect branch and
    // is a real routing option. (V4 dropped custom styles — Bible ch.02 — hence
    // pinning V3 here.)
    "recraft/recraft-v3": {
      id: "recraft/recraft-v3",
      modelVersion: "recraft-v3",
      seed: false,
      negativePrompt: true,
      transparency: true,
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxResolution: { width: 2048, height: 2048 },
      watermark: "none",
      licenseClass: "commercial-ok",
      priceUsdPerImage: null,
      tier: "mid",
      jobs: ["scene-background", "hero", "photo"],
    },
    // Imagen-4: NO negative prompt (API 400s), NO seed exposure, SynthID
    // watermark. Final-tier; exercises the no-seed compiler branch.
    "google/imagen-4.0-generate-001": {
      id: "google/imagen-4.0-generate-001",
      modelVersion: "imagen-4.0-generate-001",
      seed: false,
      negativePrompt: false,
      transparency: false,
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxResolution: { width: 1536, height: 1536 },
      watermark: "synthid",
      licenseClass: "commercial-ok",
      priceUsdPerImage: null,
      tier: "final",
      jobs: ["scene-background", "hero", "photo"],
    },
  });

/**
 * The default model for a job. SEO ADAPTATION: hero → mid-tier flux-2-flex
 * (marquee sharpness), photo → cheap draft klein-4b (inline support). The
 * reference's scene-background default (draft klein-4b) is kept for parity.
 */
export const DEFAULT_MODEL_FOR_JOB: Readonly<Record<ImageJob, string>> =
  Object.freeze({
    "scene-background": "bfl/flux-2-klein-4b",
    hero: "bfl/flux-2-flex",
    photo: "bfl/flux-2-klein-4b",
  });

/** Look up a model's capability row. Throws if the model is not in the matrix. */
export function getCapability(modelId: string): ModelCapability {
  const cap = CAPABILITY_MATRIX[modelId];
  if (!cap) {
    throw new UnknownModelError(modelId);
  }
  return cap;
}

/** All models eligible for a given job, draft → final. */
export function modelsForJob(job: ImageJob): ModelCapability[] {
  const order = { draft: 0, mid: 1, final: 2 } as const;
  return Object.values(CAPABILITY_MATRIX)
    .filter((m) => m.jobs.includes(job))
    .sort((a, b) => order[a.tier] - order[b.tier]);
}

/** Thrown when a model id is absent from the capability matrix (ch.03 gate). */
export class UnknownModelError extends Error {
  constructor(public readonly modelId: string) {
    super(
      `Model "${modelId}" is not in the ImageGen capability matrix. Add a ` +
        `capability row (and update the snapshot test) before routing to it.`,
    );
    this.name = "UnknownModelError";
  }
}
