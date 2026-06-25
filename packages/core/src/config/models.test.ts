/**
 * PR 002 acceptance criterion 3:
 *   A unit test asserts `config.drafterModel !== config.faithfulnessVerifierModel`
 *   and fails the build if they collapse.
 *
 * The cross-model faithfulness gate is only meaningful if the verifier is a
 * DIFFERENT model from the drafter. If a future edit re-baselines both ids to
 * the same model, this test (and the module-load guard it exercises) fails —
 * the build does not ship a self-consistency gate masquerading as an
 * independent one.
 */

import { describe, expect, it } from "vitest";

import {
  MODELS,
  ModelInvariantError,
  assertCrossModelInvariant,
  DRAFTER_MODEL_ID,
  VERIFIER_MODEL_ID,
  JUDGE_MODEL_ID,
  type EngineModelConfig,
} from "./models";

describe("engine model config — cross-model faithfulness invariant", () => {
  it("drafterModel !== faithfulnessVerifierModel (the load-bearing invariant)", () => {
    expect(MODELS.drafterModel).not.toBe(MODELS.faithfulnessVerifierModel);
  });

  it("reconciles with PR 001's re-baselined ids (drafter 4-6 / verifier haiku-4-5 / judge opus-4-7)", () => {
    // Consistency check: the config must not fork the provider-seam ids.
    expect(MODELS.drafterModel).toBe(DRAFTER_MODEL_ID);
    expect(MODELS.faithfulnessVerifierModel).toBe(VERIFIER_MODEL_ID);
    expect(MODELS.judgeModel).toBe(JUDGE_MODEL_ID);

    expect(MODELS.drafterModel).toBe("anthropic/claude-sonnet-4-6");
    expect(MODELS.faithfulnessVerifierModel).toBe("anthropic/claude-haiku-4-5");
    expect(MODELS.judgeModel).toBe("anthropic/claude-opus-4-7");
  });

  it("assertCrossModelInvariant passes the canonical config", () => {
    expect(() => assertCrossModelInvariant(MODELS)).not.toThrow();
  });

  it("assertCrossModelInvariant THROWS when drafter and verifier collapse to the same id", () => {
    const collapsed: EngineModelConfig = {
      drafterModel: "anthropic/claude-sonnet-4-6",
      faithfulnessVerifierModel: "anthropic/claude-sonnet-4-6", // collapsed!
      judgeModel: "anthropic/claude-opus-4-7",
    };
    expect(() => assertCrossModelInvariant(collapsed)).toThrow(
      ModelInvariantError,
    );
    expect(() => assertCrossModelInvariant(collapsed)).toThrow(
      /drafterModel === faithfulnessVerifierModel/,
    );
  });

  it("MODELS is frozen so the verifier cannot be mutated to collapse onto the drafter at runtime", () => {
    expect(Object.isFrozen(MODELS)).toBe(true);
  });

  it("the faithfulness verifier matches the gate's actual GATE_MODEL (config and gate do not drift)", async () => {
    const { GATE_MODEL } = await import("../gates/faithfulness-gate");
    expect(GATE_MODEL).toBe(MODELS.faithfulnessVerifierModel);
    // And the gate model is never the drafter.
    expect(GATE_MODEL).not.toBe(MODELS.drafterModel);
  });
});
