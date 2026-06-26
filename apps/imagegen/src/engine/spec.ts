/**
 * ImageGen — Canonical image spec (`imagegen/1`).
 *
 * PORTED from flywheel-main `packages/videogen/imagegen/spec.ts` (DR-001 port
 * pattern) and ADAPTED for the SEO hero-image use case: the `job` enum gains
 * `"hero"` and `"photo"` (the SEO Creator's hero/photo asset jobs) alongside the
 * reference's `"scene-background"`. Everything else is ~verbatim — the durable
 * core stays identical so a later spec migration is shared.
 *
 * The DURABLE CORE of the image-generation harness (ImageGen Bible ch.03):
 * one internal artifact that describes WHAT to generate, compiled per backend
 * by `compile.ts`. Inference models are swapped quarterly; this spec is the
 * part we keep. The whole point of the harness is that callers produce a
 * `CanonicalImageSpec` and never speak any model's prompt dialect directly.
 *
 * Validation runs at every boundary: derive → `CanonicalImageSpecSchema.parse`
 * → compile.
 */

import { z } from "zod";

// ── Spec version ────────────────────────────────────────────────────
//
// Bump when the shape changes incompatibly; pair with a migration that reads
// old shapes. Persisted on the generation record so a re-render replays the
// exact spec (prerequisite for the v2 exact-match cache).
export const IMAGE_SPEC_VERSION = 1 as const;
export type ImageSpecVersion = typeof IMAGE_SPEC_VERSION;

// ── Enums ───────────────────────────────────────────────────────────

/**
 * Use-case / job (ch.03 requires a first-class job field). ADAPTED for the SEO
 * Creator: `"hero"` (the page hero image, the P1.R.3 `[photo:slug]` use) and
 * `"photo"` (an inline photoreal supporting image) are added next to the
 * reference's `"scene-background"`. Routing + the capability matrix branch on
 * this without a schema change.
 */
export const ImageJobEnum = z.enum(["scene-background", "hero", "photo"]);
export type ImageJob = z.infer<typeof ImageJobEnum>;

/**
 * Aspect ratio is part of the SPEC, decided at routing time (ch.03/13: "AR is
 * part of the spec," never a post-hoc resize). Kept as a local enum so the
 * imagegen engine is self-contained (no dependency on a planning/brief module).
 */
export const ImageAspectEnum = z.enum(["16:9", "9:16", "1:1"]);
export type ImageAspect = z.infer<typeof ImageAspectEnum>;

/**
 * How a piece of text in the image is produced (ch.03's load-bearing
 * text-render decision): `model` = rendered by the image model (OCR-gated),
 * `composite` = overlaid in code for pixel-perfect, localizable text. SEO hero
 * images carry NO text (constraints include "no text"); the field is built now
 * so future title-card jobs can use it without a migration.
 */
export const TextRenderEnum = z.enum(["model", "composite"]);
export type TextRender = z.infer<typeof TextRenderEnum>;

// ── Sub-schemas ─────────────────────────────────────────────────────

/** A 6-digit hex colour bound to a role (ch.03: palette-as-hex-bound-to-objects). */
export const PaletteHintSchema = z
  .object({
    /** Semantic role this colour fills, e.g. "background", "accent". */
    role: z.string().min(1).max(60),
    /** `#rrggbb` (lowercase or uppercase). */
    hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb hex colour"),
  })
  .strict();
export type PaletteHint = z.infer<typeof PaletteHintSchema>;

/** A text element with an explicit render mode (ch.03 text-in-quotes + render). */
export const TextElementSchema = z
  .object({
    value: z.string().min(1).max(200),
    render: TextRenderEnum,
  })
  .strict();
export type TextElement = z.infer<typeof TextElementSchema>;

// ── Canonical image spec ────────────────────────────────────────────

/**
 * `.strict()` is intentional — an unknown key is a bug (a caller speaking a
 * dialect the spec doesn't model), not a silently-dropped extra.
 */
export const CanonicalImageSpecSchema = z
  .object({
    schemaVersion: z.literal(IMAGE_SPEC_VERSION),

    job: ImageJobEnum,

    /** What the image is of. The primary semantic content. */
    subject: z.string().min(1).max(2_000),

    /** Visual style: "photoreal", "flat-illustration", "abstract-gradient", … */
    style: z.string().min(1).max(500),

    /**
     * Compositional guidance, e.g. "wide establishing, negative space upper
     * third". Advisory: it nudges the model.
     */
    composition: z.string().max(500).default(""),

    /** Hex-bound palette hints, fed from the brand/brief theme. */
    palette: z.array(PaletteHintSchema).max(12).default([]),

    /** Optional mood keyword(s). */
    mood: z.string().max(200).optional(),

    /**
     * Text elements to render. SEO hero images are ALWAYS `[]` (constraints
     * include "no text"); the field exists for future title-card jobs.
     */
    text: z.array(TextElementSchema).max(12).default([]),

    /** BCP-47 locale (ch.03 first-class). v1 defaults; multi-locale is v2. */
    locale: z.string().min(2).max(35).default("en"),

    /** Hard constraints, e.g. ["no text","no logos","no recognizable faces"]. */
    constraints: z.array(z.string().min(1).max(200)).max(20).default([]),

    /**
     * Negative prompt. NOTE: compiled away by `compile.ts` for models whose
     * capability row says `negativePrompt:false` (e.g. Imagen 400s on it).
     */
    negativePrompt: z.string().max(2_000).optional(),

    /** Routing-time aspect ratio = the composition's AR. */
    aspectRatio: ImageAspectEnum,

    /**
     * Optional seed. Compiled away for models that don't expose a seed
     * (e.g. GPT-Image). Not portable across model versions/hardware (ch.07).
     */
    seed: z.number().int().nonnegative().optional(),
  })
  .strict();

export type CanonicalImageSpec = z.infer<typeof CanonicalImageSpecSchema>;
