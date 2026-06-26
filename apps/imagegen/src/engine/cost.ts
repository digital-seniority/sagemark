/**
 * ImageGen — Cost control (`imagegen/1`).
 *
 * PORTED ~verbatim from flywheel-main `packages/videogen/imagegen/cost.ts`.
 *
 * The cost model is deliberately COARSE (audit A3): a fixed credit surcharge per
 * generated image + a global circuit-breaker cap. The provider-reported
 * per-image cost (`GeneratedImage.costReported`) is still recorded on the
 * provenance row for later analysis, but billing here is the surcharge.
 *
 * SEO ADAPTATION: the orchestrator (`generateHeroImage`) additionally enforces a
 * caller-supplied per-request cost cap (`costCapUsd`) against the
 * provider-reported cost AFTER generation is impossible (pre-spend), so it
 * instead checks a conservative ESTIMATE against the cap BEFORE spend. See
 * `withinCostCap`.
 */

/** Credits charged per generated image (tunable). */
export const SURCHARGE_CREDITS_PER_IMAGE = 1;

/** The credit surcharge for generating `n` images. */
export function imageGenSurcharge(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `imageGenSurcharge: n must be a non-negative integer, got ${n}`,
    );
  }
  return n * SURCHARGE_CREDITS_PER_IMAGE;
}

export interface GlobalCapCheck {
  /** Images already generated in the current window (e.g. today). */
  spentInWindow: number;
  /** The window ceiling (global circuit breaker). */
  cap: number;
  /** Images this request wants to generate. */
  requested: number;
}

/**
 * The global circuit breaker (Bible ch.07 / audit A3). Returns whether the
 * request fits under the cap. A stuck loop is the named pathology; this is the
 * blunt stop.
 */
export function withinGlobalCap(check: GlobalCapCheck): boolean {
  return check.spentInWindow + check.requested <= check.cap;
}

/** Default global daily cap on generated images (tunable; conservative). */
export const DEFAULT_GLOBAL_DAILY_IMAGE_CAP = 500;

// ── SEO per-request cost cap (pre-spend) ────────────────────────────

/**
 * Conservative pre-spend USD estimate for ONE generated image at a tier. The
 * gateway does not return a price BEFORE generation (per-image cost only comes
 * back in `providerMetadata` AFTER the call), so the orchestrator checks this
 * conservative estimate against the caller's `costCapUsd` to refuse over-cap
 * requests WITHOUT spending. Tunable; intentionally pessimistic so the cap
 * never under-counts. (The actual reported cost is recorded on the provenance
 * row for later true-up.)
 */
export const ESTIMATED_USD_PER_IMAGE_BY_TIER: Readonly<
  Record<"draft" | "mid" | "final", number>
> = Object.freeze({
  draft: 0.01,
  mid: 0.04,
  final: 0.08,
});

/**
 * Whether the pre-spend estimate for `tier` fits under the per-request cap.
 * Returns true when no cap is supplied (cap is opt-in per request).
 */
export function withinCostCap(opts: {
  tier: "draft" | "mid" | "final";
  costCapUsd?: number;
}): boolean {
  if (opts.costCapUsd === undefined) return true;
  return ESTIMATED_USD_PER_IMAGE_BY_TIER[opts.tier] <= opts.costCapUsd;
}

/** Thrown (pre-spend) when the estimated cost for a request exceeds its cap. */
export class CostCapExceededError extends Error {
  readonly code = "cost-cap-exceeded";
  constructor(
    public readonly estimateUsd: number,
    public readonly capUsd: number,
  ) {
    super(
      `ImageGen: estimated cost $${estimateUsd} exceeds the per-request cap ` +
        `$${capUsd}; refused before spend.`,
    );
    this.name = "CostCapExceededError";
  }
}
