import { describe, expect, it } from "vitest";

import {
  CostAccountant,
  CostCapExceededError,
  RUN_COST_CAP_USD,
} from "./cost-accountant";

describe("CostAccountant.reserve — fail-closed per-run cap", () => {
  it("reserves calls that fit under the cap and tracks cumulative spend", () => {
    const acc = new CostAccountant(2.0);
    acc.reserve(0.5, "drafter");
    acc.reserve(0.4, "verifier");
    expect(acc.spentUsd).toBeCloseTo(0.9, 10);
    expect(acc.remainingUsd).toBeCloseTo(1.1, 10);
  });

  it("throws CostCapExceededError once the per-run ceiling is exceeded", () => {
    const acc = new CostAccountant(1.0);
    acc.reserve(0.7, "drafter");
    expect(() => acc.reserve(0.4, "judge")).toThrow(CostCapExceededError);
  });

  it("does NOT reserve (no mutation) when a reservation trips the cap", () => {
    const acc = new CostAccountant(1.0);
    acc.reserve(0.9, "drafter");
    expect(() => acc.reserve(0.2, "judge")).toThrow(CostCapExceededError);
    // Fail-closed: the over-budget reservation recorded nothing.
    expect(acc.spentUsd).toBeCloseTo(0.9, 10);
  });

  it("defaults to the RFC §1 $2.00 per-piece ceiling", () => {
    expect(RUN_COST_CAP_USD).toBe(2.0);
    const acc = new CostAccountant();
    expect(acc.capUsd).toBe(2.0);
    acc.reserve(2.0, "exact-cap");
    expect(() => acc.reserve(0.0001, "over")).toThrow(CostCapExceededError);
  });

  it("canAfford predicts the cap without mutating spend", () => {
    const acc = new CostAccountant(1.0);
    acc.reserve(0.8, "drafter");
    expect(acc.canAfford(0.2)).toBe(true);
    expect(acc.canAfford(0.3)).toBe(false);
    expect(acc.spentUsd).toBeCloseTo(0.8, 10);
  });

  it("CostCapExceededError carries the attempted/cap/label context", () => {
    const acc = new CostAccountant(1.0);
    try {
      acc.reserve(1.5, "judge");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CostCapExceededError);
      const e = err as CostCapExceededError;
      expect(e.attemptedUsd).toBeCloseTo(1.5, 10);
      expect(e.capUsd).toBe(1.0);
      expect(e.label).toBe("judge");
    }
  });
});
