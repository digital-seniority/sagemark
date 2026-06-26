/**
 * ImageGen — Spec compiler (`imagegen/1`).
 *
 * PORTED ~verbatim from flywheel-main `packages/videogen/imagegen/compile.ts`.
 * The ONE adaptation: the reference imported `ASPECT_DIMENSIONS` + `AspectRatio`
 * from the videogen `scenes/` module — here they are INLINED so the imagegen
 * engine is fully self-contained (it must not depend on a videogen-only module).
 * The dimension values are identical to the renderer's reference dims.
 *
 * The ADAPTER layer (ImageGen Bible ch.03): compiles one `CanonicalImageSpec`
 * into a model-correct `CompiledRequest`, consulting the capability matrix so
 * the same spec targets different backends without the caller knowing any
 * model's quirks. This is the "one spec, many dialects" seam.
 *
 * What it does per the capability row:
 *   - drops `negativePrompt` for models that 400 on it (e.g. Imagen), folding
 *     the negation into the positive prompt instead so intent survives;
 *   - omits `seed` for models that don't expose one;
 *   - resolves AR → pixel dims and clamps to the model's max resolution;
 *   - rejects an AR the model doesn't support, and an unknown model.
 */

import { getCapability, type ModelCapability } from "./capability";
import type { CanonicalImageSpec, ImageAspect } from "./spec";

/**
 * Reference pixel dims per aspect ratio (INLINED from the videogen renderer's
 * `ASPECT_DIMENSIONS`). compile clamps these to each model's max resolution.
 */
export const ASPECT_DIMENSIONS: Record<
  ImageAspect,
  { width: number; height: number }
> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

/** A model-ready request — everything the generate call needs, nothing it can't take. */
export interface CompiledRequest {
  readonly modelId: string;
  readonly modelVersion: string;
  /** The positive prompt, assembled from the spec (and folded negatives). */
  readonly prompt: string;
  /** Present ONLY when the model supports it; otherwise folded into `prompt`. */
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  /** Present ONLY when the model exposes a seed. */
  readonly seed?: number;
  /** The capability row used, for logging/provenance. */
  readonly capability: ModelCapability;
}

/** Thrown when the spec's aspect ratio isn't supported by the chosen model. */
export class UnsupportedAspectError extends Error {
  constructor(
    public readonly modelId: string,
    public readonly aspectRatio: string,
  ) {
    super(
      `Model "${modelId}" does not support aspect ratio "${aspectRatio}". ` +
        `Route to a model whose capability row lists it.`,
    );
    this.name = "UnsupportedAspectError";
  }
}

/**
 * Compile a canonical spec for a specific model. Throws `UnknownModelError`
 * (unknown model) or `UnsupportedAspectError` (model can't do the AR).
 */
export function compileSpec(
  spec: CanonicalImageSpec,
  modelId: string,
): CompiledRequest {
  const capability = getCapability(modelId);

  if (!capability.aspectRatios.includes(spec.aspectRatio)) {
    throw new UnsupportedAspectError(modelId, spec.aspectRatio);
  }

  const { width, height } = resolveDimensions(spec.aspectRatio, capability);
  const dropNegative = !capability.negativePrompt && !!spec.negativePrompt;

  return {
    modelId: capability.id,
    modelVersion: capability.modelVersion,
    prompt: buildPrompt(spec, { foldNegative: dropNegative }),
    ...(capability.negativePrompt && spec.negativePrompt
      ? { negativePrompt: spec.negativePrompt }
      : {}),
    width,
    height,
    ...(capability.seed && spec.seed !== undefined ? { seed: spec.seed } : {}),
    capability,
  };
}

/** Resolve AR → pixels (from the reference dims), clamped to max. */
function resolveDimensions(
  aspectRatio: ImageAspect,
  capability: ModelCapability,
): { width: number; height: number } {
  const ref = ASPECT_DIMENSIONS[aspectRatio];
  const scale = Math.min(
    1,
    capability.maxResolution.width / ref.width,
    capability.maxResolution.height / ref.height,
  );
  // Even dimensions keep encoders + most models happy.
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(ref.width), height: even(ref.height) };
}

/**
 * Assemble the positive prompt from the spec. Order mirrors ch.03's canonical
 * sections: subject → style → composition → palette → mood → constraints.
 * When `foldNegative` is set, the spec's negative prompt is appended as an
 * explicit avoidance clause so its intent survives on models that can't take a
 * dedicated negative-prompt field.
 */
function buildPrompt(
  spec: CanonicalImageSpec,
  opts: { foldNegative: boolean },
): string {
  const parts: string[] = [spec.subject.trim(), `Style: ${spec.style.trim()}`];

  if (spec.composition.trim()) {
    parts.push(`Composition: ${spec.composition.trim()}`);
  }

  if (spec.palette.length > 0) {
    const pal = spec.palette.map((p) => `${p.role} ${p.hex}`).join(", ");
    parts.push(`Palette: ${pal}`);
  }

  if (spec.mood?.trim()) parts.push(`Mood: ${spec.mood.trim()}`);

  if (spec.constraints.length > 0) {
    parts.push(`Constraints: ${spec.constraints.join(", ")}`);
  }

  if (opts.foldNegative && spec.negativePrompt?.trim()) {
    parts.push(`Avoid: ${spec.negativePrompt.trim()}`);
  }

  return parts.join(". ") + ".";
}
