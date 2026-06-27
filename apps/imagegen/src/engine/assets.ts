/**
 * ImageGen — Asset + license types (`imagegen/1`).
 *
 * INLINED from flywheel-main `packages/videogen/assets/types.ts` (only the
 * subset the imagegen persist path needs) so the imagegen engine is fully
 * self-contained — it must not depend on the videogen assets module. The Stage-2
 * Supabase store will map these to the real `generated_images` row shape; for
 * Stage 1 they describe the in-memory + NOT_WIRED store seam.
 *
 * License is the load-bearing compliance rule (SEO Never-list #8 blocks
 * unlicensed assets from publish): every generated image carries a
 * `GeneratedAssetLicense` (provider="generated", the pinned model id+version).
 */

import { z } from "zod";

export const ASSET_KINDS = ["logo", "image", "font", "audio", "video"] as const;
export const ASSET_SOURCES = [
  "upload",
  "unsplash",
  "pexels",
  "mixkit",
  "generated",
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];
export type AssetSource = (typeof ASSET_SOURCES)[number];

/**
 * Generated-image license (ImageGen engine). A generated image has NO provider
 * page or attribution — its provenance is the model that made it + the
 * generation record. `model` is the pinned gateway model id+version.
 */
export const GeneratedAssetLicenseSchema = z.object({
  provider: z.literal("generated"),
  /** Gateway model id + pinned version that produced the image. */
  model: z.string().min(1),
  /** Optional note on the model's output license terms (not necessarily a URL). */
  terms: z.string().optional(),
});
export type GeneratedAssetLicense = z.infer<typeof GeneratedAssetLicenseSchema>;

/** Build the license blob for a generated image (persist path). */
export function makeGeneratedLicense(opts: {
  model: string;
  terms?: string;
}): GeneratedAssetLicense {
  return {
    provider: "generated",
    model: opts.model,
    ...(opts.terms ? { terms: opts.terms } : {}),
  };
}

export class MissingLicenseError extends Error {
  readonly statusCode = 422;
  readonly code = "missing-license";
  constructor(opts: { source: AssetSource; detail: string }) {
    super(
      `imagegen assets: row (source=${opts.source}) requires a complete ` +
        `license blob: ${opts.detail}`,
    );
    this.name = "MissingLicenseError";
  }
}

/**
 * Throws if a generated row's license is missing required fields. Validated
 * BEFORE persist so an unlicensed generated asset can never be written (the
 * SEO Never-list #8 precondition).
 */
export function assertLicensePresentForSource(opts: {
  source: AssetSource;
  license: unknown;
}): void {
  if (opts.source === "upload") return; // upload rows: license optional
  if (opts.source !== "generated") return; // stock handled elsewhere (not used here)
  const parsed = GeneratedAssetLicenseSchema.safeParse(opts.license);
  if (!parsed.success) {
    throw new MissingLicenseError({
      source: opts.source,
      detail: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    });
  }
}

/** Public asset DTO the persist path returns + the store inserts. */
export interface Asset {
  id: string;
  workspaceId: string;
  kind: AssetKind;
  source: AssetSource;
  storageKey: string | null;
  externalUrl: string | null;
  license: GeneratedAssetLicense | null;
  contentHash: string | null;
  bytes: number | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
