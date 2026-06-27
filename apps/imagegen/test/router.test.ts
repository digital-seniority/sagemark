/**
 * router.test.ts — model routing (`imagegen/1`).
 */
import { describe, it, expect } from "vitest";
import { routeModel } from "../src/engine/router";
import {
  DEFAULT_MODEL_FOR_JOB,
  UnknownModelError,
} from "../src/engine/capability";

describe("imagegen/1 — routeModel", () => {
  it("defaults hero to the mid model (flux-2-flex)", () => {
    expect(routeModel("hero")).toBe(DEFAULT_MODEL_FOR_JOB.hero);
    expect(routeModel("hero")).toBe("bfl/flux-2-flex");
  });

  it("defaults photo to the draft model (klein-4b)", () => {
    expect(routeModel("photo")).toBe("bfl/flux-2-klein-4b");
  });

  it("honours a tier override", () => {
    expect(routeModel("hero", { tier: "final" })).toBe(
      "google/imagen-4.0-generate-001",
    );
  });

  it("honours a valid model-id override", () => {
    expect(routeModel("hero", { modelId: "recraft/recraft-v3" })).toBe(
      "recraft/recraft-v3",
    );
  });

  it("throws UnknownModelError for an override not in the matrix", () => {
    expect(() => routeModel("hero", { modelId: "acme/nope" })).toThrow(
      UnknownModelError,
    );
  });
});
