/**
 * ImageGen — Generation boundary (`imagegen/1`).
 *
 * PORTED ~verbatim from flywheel-main `packages/videogen/imagegen/generate.ts`.
 *
 * The single seam where the harness calls an inference model (ImageGen Bible:
 * inference is the replaceable middle). `ImageGenerator` is an INJECTED
 * interface so the orchestrator and tests never touch the live gateway —
 * `makeFakeImageGenerator` runs in CI (zero spend), `makeGatewayImageGenerator`
 * runs live via the Vercel AI Gateway (`@ai-sdk/gateway`). DR-013: image spend
 * goes through the metered Gateway; the worker/app never holds a raw provider
 * key — the gateway functions are INJECTED, not imported at module top.
 *
 * Per-image COST is read from the provider metadata the gateway returns
 * (e.g. BFL: `providerMetadata.blackForestLabs.images[].cost`), NOT from the
 * static capability matrix.
 */

import type { CompiledRequest } from "./compile";

/** The result of one generation — bytes + the provenance fields persist records. */
export interface GeneratedImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** Seed the model actually used (when it reports one). */
  readonly seedUsed?: number;
  /** Per-image cost the provider reported, if any (provider's own units). */
  readonly costReported?: number;
  /** Raw provider metadata, for the provenance record. */
  readonly providerMetadata?: unknown;
  readonly modelId: string;
  readonly modelVersion: string;
}

/** The injected generation boundary. */
export interface ImageGenerator {
  generate(req: CompiledRequest): Promise<GeneratedImage>;
}

/**
 * Pull the provider-reported per-image cost out of the AI SDK's
 * `providerMetadata`. Providers nest it differently; we look for the common
 * `<provider>.images[0].cost` shape (BFL/others) and fall back to a top-level
 * `cost`. Returns undefined when nothing is reported.
 */
export function extractReportedCost(
  providerMetadata: unknown,
): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== "object")
    return undefined;
  for (const value of Object.values(
    providerMetadata as Record<string, unknown>,
  )) {
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      const images = v.images;
      if (Array.isArray(images) && images[0] && typeof images[0] === "object") {
        const c = (images[0] as Record<string, unknown>).cost;
        if (typeof c === "number") return c;
      }
      if (typeof v.cost === "number") return v.cost;
    }
  }
  return undefined;
}

/** Pull the seed the provider used, same nesting shape as cost. */
export function extractSeedUsed(providerMetadata: unknown): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== "object")
    return undefined;
  for (const value of Object.values(
    providerMetadata as Record<string, unknown>,
  )) {
    if (value && typeof value === "object") {
      const images = (value as Record<string, unknown>).images;
      if (Array.isArray(images) && images[0] && typeof images[0] === "object") {
        const s = (images[0] as Record<string, unknown>).seed;
        if (typeof s === "number") return s;
      }
    }
  }
  return undefined;
}

/**
 * Live generator backed by the Vercel AI Gateway. The `generateImage` +
 * `gatewayImageModel` functions are INJECTED (rather than imported at module
 * top) so this module — and everything that imports the orchestrator — never
 * statically pulls the AI SDK into the bundle, and tests can drive it without
 * the dependency. The live wiring (the /api/run route) passes the real
 * `experimental_generateImage` from `ai` + `gateway.imageModel` from
 * `@ai-sdk/gateway` in.
 */
/**
 * The loose shape the AI SDK's image-generation result exposes (just the fields
 * this module reads). The injected `generateImage` is typed against this so the
 * gateway adapter needs no `any`.
 */
export interface GatewayImageFile {
  uint8Array?: Uint8Array;
  base64?: string;
  mediaType?: string;
  mimeType?: string;
}
export interface GatewayImageResult {
  image?: GatewayImageFile;
  images?: GatewayImageFile[];
  providerMetadata?: unknown;
}

export function makeGatewayImageGenerator(deps: {
  /** The AI SDK's `generateImage` (v7) / `experimental_generateImage` (v6). */
  generateImage: (args: Record<string, unknown>) => Promise<GatewayImageResult>;
  /** `gateway.imageModel`. */
  gatewayImageModel: (id: string) => unknown;
}): ImageGenerator {
  return {
    async generate(req: CompiledRequest): Promise<GeneratedImage> {
      const result = await deps.generateImage({
        model: deps.gatewayImageModel(req.modelId),
        prompt: req.prompt,
        size: `${req.width}x${req.height}`,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
        ...(req.negativePrompt
          ? { providerOptions: { negativePrompt: req.negativePrompt } }
          : {}),
      });
      const img = result.image ?? result.images?.[0];
      if (!img)
        throw new Error(`generateImage returned no image for ${req.modelId}`);
      const bytes: Uint8Array =
        img.uint8Array ??
        (img.base64 ? Buffer.from(img.base64, "base64") : new Uint8Array());
      if (bytes.length === 0) {
        throw new Error(
          `generateImage produced empty bytes for ${req.modelId}`,
        );
      }
      const providerMetadata = result.providerMetadata;
      return {
        bytes,
        contentType: img.mediaType ?? img.mimeType ?? "image/png",
        seedUsed: extractSeedUsed(providerMetadata) ?? req.seed,
        costReported: extractReportedCost(providerMetadata),
        providerMetadata,
        modelId: req.modelId,
        modelVersion: req.modelVersion,
      };
    },
  };
}

/**
 * Deterministic fake for tests + the orchestrator dry-run path. Produces a tiny
 * valid byte payload and echoes the request — NO network, NO spend.
 */
export function makeFakeImageGenerator(
  opts: { costReported?: number } = {},
): ImageGenerator {
  return {
    async generate(req: CompiledRequest): Promise<GeneratedImage> {
      // 1x1 transparent PNG, enough to be "non-empty bytes".
      const onePx = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      );
      return {
        bytes: new Uint8Array(onePx),
        contentType: "image/png",
        seedUsed: req.seed,
        costReported: opts.costReported,
        providerMetadata: { fake: true },
        modelId: req.modelId,
        modelVersion: req.modelVersion,
      };
    },
  };
}
