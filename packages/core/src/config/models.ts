/**
 * Engine model configuration for the SEO Creator deterministic core.
 *
 * This is the single, canonical place the gate composer reads its model
 * assignments from. It does NOT re-declare the model ids — it reconciles with
 * (and re-exports) the ids re-baselined in PR 001
 * (`../ai/resolve-gateway-model`), so the drafter/verifier/judge ids never
 * fork between the provider seam and the gate config.
 *
 * The load-bearing invariant (RFC §2, PR 002 acceptance criterion 3):
 *
 *   ── the faithfulness verifier MUST be a different model from the drafter ──
 *
 * Cross-model verification is the whole point of the faithfulness gate: a
 * verifier that shares the drafter's weights gives a self-consistency check,
 * not an independent second opinion. {@link assertCrossModelInvariant} (run at
 * module load) collapses the build if the two ids are ever made equal, so the
 * gate can never silently degrade to self-checking.
 */

import {
  DRAFTER_MODEL_ID,
  VERIFIER_MODEL_ID,
  JUDGE_MODEL_ID,
} from "../ai/resolve-gateway-model";

/**
 * Raised when the engine model config violates the cross-model faithfulness
 * invariant — i.e. the drafter and the faithfulness verifier resolve to the
 * same model id. Surfaced as a typed, thrown error at module load so a config
 * regression fails the build rather than shipping a self-consistency gate.
 */
export class ModelInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelInvariantError";
  }
}

/**
 * The engine's model assignments. Reconciled with PR 001's re-baselined ids:
 *   - drafter               → claude-sonnet-4-6
 *   - faithfulnessVerifier  → claude-haiku-4-5   (MUST differ from drafter)
 *   - judge                 → claude-opus-4-7
 */
export interface EngineModelConfig {
  /** Composes the grounded draft. */
  readonly drafterModel: string;
  /**
   * Independently verifies the draft's factual claims in the cross-model
   * faithfulness gate. MUST differ from {@link drafterModel}.
   */
  readonly faithfulnessVerifierModel: string;
  /** Scores the Stage-B composite. */
  readonly judgeModel: string;
}

/**
 * The canonical engine model config. Frozen so a caller cannot mutate the
 * verifier to collapse it onto the drafter at runtime.
 */
export const MODELS: EngineModelConfig = Object.freeze({
  drafterModel: DRAFTER_MODEL_ID,
  faithfulnessVerifierModel: VERIFIER_MODEL_ID,
  judgeModel: JUDGE_MODEL_ID,
});

/**
 * Assert the cross-model faithfulness invariant on a config. Throws
 * {@link ModelInvariantError} if the drafter and faithfulness verifier are the
 * same id. Exported so tests can exercise it against a deliberately-collapsed
 * config, and run once at module load against {@link MODELS} below.
 */
export function assertCrossModelInvariant(config: EngineModelConfig): void {
  if (config.drafterModel === config.faithfulnessVerifierModel) {
    throw new ModelInvariantError(
      `cross-model faithfulness invariant violated: drafterModel === faithfulnessVerifierModel ('${config.drafterModel}'). ` +
        "The faithfulness verifier must be a DIFFERENT model from the drafter — a same-model verifier is a self-consistency check, not an independent gate.",
    );
  }
}

// Fail the build at import time if the canonical config ever collapses the two.
assertCrossModelInvariant(MODELS);

// Re-export the ids so downstream callers have one import surface for the
// engine's model assignments without reaching into the provider seam.
export { DRAFTER_MODEL_ID, VERIFIER_MODEL_ID, JUDGE_MODEL_ID };
