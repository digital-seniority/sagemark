/**
 * cost.test.ts — surcharge + global cap + per-request cost cap (`imagegen/1`).
 */
import { describe, it, expect } from "vitest";
import {
  imageGenSurcharge,
  withinGlobalCap,
  withinCostCap,
  SURCHARGE_CREDITS_PER_IMAGE,
  ESTIMATED_USD_PER_IMAGE_BY_TIER,
} from "../src/engine/cost";

describe("imagegen/1 — imageGenSurcharge", () => {
  it("charges the per-image surcharge", () => {
    expect(imageGenSurcharge(0)).toBe(0);
    expect(imageGenSurcharge(1)).toBe(SURCHARGE_CREDITS_PER_IMAGE);
    expect(imageGenSurcharge(3)).toBe(3 * SURCHARGE_CREDITS_PER_IMAGE);
  });
  it("rejects negative / non-integer counts", () => {
    expect(() => imageGenSurcharge(-1)).toThrow();
    expect(() => imageGenSurcharge(1.5)).toThrow();
  });
});

describe("imagegen/1 — withinGlobalCap (circuit breaker)", () => {
  it("allows a request that fits under the cap", () => {
    expect(withinGlobalCap({ spentInWindow: 10, cap: 500, requested: 3 })).toBe(
      true,
    );
  });
  it("allows a request that hits the cap exactly", () => {
    expect(
      withinGlobalCap({ spentInWindow: 497, cap: 500, requested: 3 }),
    ).toBe(true);
  });
  it("blocks a request that would exceed the cap", () => {
    expect(
      withinGlobalCap({ spentInWindow: 498, cap: 500, requested: 3 }),
    ).toBe(false);
  });
});

describe("imagegen/1 — withinCostCap (SEO per-request pre-spend cap)", () => {
  it("allows when no cap is supplied (cap is opt-in)", () => {
    expect(withinCostCap({ tier: "final" })).toBe(true);
  });
  it("allows when the tier estimate fits under the cap", () => {
    expect(
      withinCostCap({ tier: "mid", costCapUsd: ESTIMATED_USD_PER_IMAGE_BY_TIER.mid }),
    ).toBe(true);
  });
  it("blocks when the tier estimate exceeds the cap", () => {
    expect(withinCostCap({ tier: "final", costCapUsd: 0.05 })).toBe(false);
    expect(withinCostCap({ tier: "mid", costCapUsd: 0.001 })).toBe(false);
  });
});
