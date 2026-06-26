/**
 * ImageGen engine — public surface (`imagegen/1`).
 *
 * PORTED from flywheel-main `packages/videogen/imagegen/index.ts` and ADAPTED
 * for the SEO Creator: the orchestrator is `generateHeroImage` (not
 * `generateSceneBackground`), the store seams are the Stage-1 in-memory +
 * fail-closed NOT_WIRED stores (not the live Supabase store, which is Stage 2),
 * and the asset/license types are the inlined self-contained ones.
 *
 * `apps/seo` imports from `@sagemark/imagegen` IN-PROCESS (the package `exports`
 * point at this file's `.ts` source — source-consumed like `@sagemark/core`):
 *   import { generateHeroImage, makeGatewayImageGenerator,
 *            makeFakeImageGenerator } from "@sagemark/imagegen";
 */

// ── Spec (durable core) ─────────────────────────────────────────────
export {
  CanonicalImageSpecSchema,
  IMAGE_SPEC_VERSION,
  ImageJobEnum,
  ImageAspectEnum,
  TextRenderEnum,
  PaletteHintSchema,
  TextElementSchema,
  type CanonicalImageSpec,
  type ImageJob,
  type ImageAspect,
  type TextRender,
  type PaletteHint,
  type TextElement,
  type ImageSpecVersion,
} from "./spec";

// ── Capability matrix ───────────────────────────────────────────────
export {
  CAPABILITY_MATRIX,
  DEFAULT_MODEL_FOR_JOB,
  getCapability,
  modelsForJob,
  UnknownModelError,
  type ModelCapability,
  type WatermarkMode,
  type Resolution,
} from "./capability";

// ── Compiler ────────────────────────────────────────────────────────
export {
  compileSpec,
  ASPECT_DIMENSIONS,
  UnsupportedAspectError,
  type CompiledRequest,
} from "./compile";

// ── Router ──────────────────────────────────────────────────────────
export { routeModel, type RouteOptions } from "./router";

// ── Generation boundary ─────────────────────────────────────────────
export {
  makeGatewayImageGenerator,
  makeFakeImageGenerator,
  extractReportedCost,
  extractSeedUsed,
  type ImageGenerator,
  type GeneratedImage,
  type GatewayImageResult,
  type GatewayImageFile,
} from "./generate";

// ── Pre-spend moderation + typed refusal ────────────────────────────
export {
  makeLocalPromptModerator,
  classifyProviderError,
  isRetriable,
  type PromptModerator,
  type ModerationVerdict,
  type GenerationErrorClass,
} from "./moderate";

// ── Persist + URL resolution ────────────────────────────────────────
export {
  persistGeneratedImage,
  resolveGeneratedAssetUrl,
  contentHashOf,
  generatedStorageKey,
  deriveProvenanceFlags,
  GENERATED_IMAGE_BUCKET,
  GENERATED_IMAGE_PREFIX,
  type GeneratedImageStore,
  type GenerationRecord,
  type ProvenanceFlags,
  type RenderableAsset,
  type PersistGeneratedImageArgs,
  type PersistResult,
} from "./persist";

// ── Cost control (surcharge + global cap + per-request cap) ──────────
export {
  imageGenSurcharge,
  withinGlobalCap,
  withinCostCap,
  CostCapExceededError,
  SURCHARGE_CREDITS_PER_IMAGE,
  DEFAULT_GLOBAL_DAILY_IMAGE_CAP,
  ESTIMATED_USD_PER_IMAGE_BY_TIER,
  type GlobalCapCheck,
} from "./cost";

// ── Asset + license types (inlined, self-contained) ─────────────────
export {
  makeGeneratedLicense,
  assertLicensePresentForSource,
  MissingLicenseError,
  GeneratedAssetLicenseSchema,
  ASSET_KINDS,
  ASSET_SOURCES,
  type Asset,
  type AssetKind,
  type AssetSource,
  type GeneratedAssetLicense,
} from "./assets";

// ── Store seams (Stage 1: in-memory + fail-closed NOT_WIRED) ────────
export {
  makeInMemoryImageStore,
  makeNotWiredImageStore,
  makeDryRunSignUrl,
  StoreNotWiredError,
  type InMemoryImageStore,
} from "./store";

// ── Orchestrator: generateHeroImage + [photo:] resolution (P1.R.3) ──
export {
  generateHeroImage,
  resolveHeroPlaceholder,
  parsePhotoToken,
  HERO_CONSTRAINTS,
  DEFAULT_HERO_STYLE,
  type GenerateHeroImageArgs,
  type HeroImageDeps,
  type HeroImageResult,
  type HeroImageRefusal,
} from "./generate-hero-image";
