/**
 * Per-run cost accounting (fail-closed) for the SEO Creator engine.
 *
 * Ported from flywheel-main `apps/trailhead/src/lib/ai.ts` (the
 * `CostAccountant` / `CostCapExceededError` seam) and adapted to the SEO
 * Creator's RFC §1 budget: a **≤ $2.00 per-piece hard cap** enforced by a
 * pre-flight `reserve()` rather than optimistic post-hoc charging.
 *
 * Fail-closed discipline (RFC §1, PRD §9.x): we never optimistically spend and
 * then apologize — every model call is *reserved* BEFORE it is made, and a
 * reservation that would push the run over its USD ceiling throws
 * {@link CostCapExceededError} and authorizes nothing. A run with a tripped
 * reservation aborts rather than silently over-spending.
 */

/** Per-run hard ceiling across ALL model calls, in USD (RFC §1 — ≤ $2.00/piece). */
export const RUN_COST_CAP_USD = 2.0;

/** Thrown when a model call would push run spend over the cap. */
export class CostCapExceededError extends Error {
  constructor(
    readonly attemptedUsd: number,
    readonly capUsd: number,
    readonly label: string,
  ) {
    super(
      `cost cap exceeded: '${label}' would bring run spend to $${attemptedUsd.toFixed(
        4,
      )}, over the $${capUsd.toFixed(2)} ceiling — aborting (fail-closed)`,
    );
    this.name = "CostCapExceededError";
  }
}

/** Small tolerance so float sums (e.g. 0.005*n) don't spuriously trip the cap. */
const EPSILON = 1e-9;

/**
 * Tracks cumulative model spend for ONE run and refuses to authorize a call
 * that would exceed the cap. Fail-closed: we check BEFORE the call (`reserve`)
 * and abort if over budget — we never spend first and reconcile later.
 */
export class CostAccountant {
  private _spentUsd = 0;

  constructor(readonly capUsd: number = RUN_COST_CAP_USD) {}

  /** Total USD reserved so far this run. */
  get spentUsd(): number {
    return this._spentUsd;
  }

  /** Remaining headroom under the cap, in USD. */
  get remainingUsd(): number {
    return this.capUsd - this._spentUsd;
  }

  /** Would reserving `costUsd` more stay within the cap? (No mutation.) */
  canAfford(costUsd: number): boolean {
    return this._spentUsd + costUsd <= this.capUsd + EPSILON;
  }

  /**
   * Reserve (authorize + record) a call of `costUsd` labelled `label`. Throws
   * {@link CostCapExceededError} — WITHOUT reserving — if it would exceed the
   * cap. This is the fail-closed pre-flight: callers reserve before issuing the
   * model call, so the call never happens if the run is out of budget.
   */
  reserve(costUsd: number, label = "model-call"): void {
    const attempted = this._spentUsd + costUsd;
    if (attempted > this.capUsd + EPSILON) {
      throw new CostCapExceededError(attempted, this.capUsd, label);
    }
    this._spentUsd = attempted;
  }
}
