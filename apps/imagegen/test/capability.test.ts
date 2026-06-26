/**
 * capability.test.ts — the capability matrix AND its review gate (`imagegen/1`).
 *
 * The first test is a FROZEN SNAPSHOT FENCE: the whole matrix is pinned by
 * value, so any edit to a pinned model's row fails this test until the snapshot
 * is updated in the same commit. That turns the matrix from documentation into a
 * GATE — a backend version bump cannot land without a routing review.
 *
 * Adapted for the SEO Creator: every row's `jobs` includes hero + photo, and
 * the hero/photo defaults are pinned in DEFAULT_MODEL_FOR_JOB.
 */
import { describe, it, expect } from "vitest";
import {
  CAPABILITY_MATRIX,
  DEFAULT_MODEL_FOR_JOB,
  getCapability,
  modelsForJob,
  UnknownModelError,
} from "../src/engine/capability";

describe("imagegen/1 — capability matrix review gate", () => {
  it("matches the frozen snapshot (edit a row → update this fence in the same commit)", () => {
    expect(CAPABILITY_MATRIX).toStrictEqual({
      "bfl/flux-2-klein-4b": {
        id: "bfl/flux-2-klein-4b",
        modelVersion: "flux-2-klein-4b",
        seed: true,
        negativePrompt: false,
        transparency: false,
        aspectRatios: ["16:9", "9:16", "1:1"],
        maxResolution: { width: 2048, height: 2048 },
        watermark: "none",
        licenseClass: "commercial-ok",
        priceUsdPerImage: null,
        tier: "draft",
        jobs: ["scene-background", "hero", "photo"],
      },
      "bfl/flux-2-flex": {
        id: "bfl/flux-2-flex",
        modelVersion: "flux-2-flex",
        seed: true,
        negativePrompt: false,
        transparency: false,
        aspectRatios: ["16:9", "9:16", "1:1"],
        maxResolution: { width: 2048, height: 2048 },
        watermark: "none",
        licenseClass: "commercial-ok",
        priceUsdPerImage: null,
        tier: "mid",
        jobs: ["scene-background", "hero", "photo"],
      },
      "recraft/recraft-v3": {
        id: "recraft/recraft-v3",
        modelVersion: "recraft-v3",
        seed: false,
        negativePrompt: true,
        transparency: true,
        aspectRatios: ["16:9", "9:16", "1:1"],
        maxResolution: { width: 2048, height: 2048 },
        watermark: "none",
        licenseClass: "commercial-ok",
        priceUsdPerImage: null,
        tier: "mid",
        jobs: ["scene-background", "hero", "photo"],
      },
      "google/imagen-4.0-generate-001": {
        id: "google/imagen-4.0-generate-001",
        modelVersion: "imagen-4.0-generate-001",
        seed: false,
        negativePrompt: false,
        transparency: false,
        aspectRatios: ["16:9", "9:16", "1:1"],
        maxResolution: { width: 1536, height: 1536 },
        watermark: "synthid",
        licenseClass: "commercial-ok",
        priceUsdPerImage: null,
        tier: "final",
        jobs: ["scene-background", "hero", "photo"],
      },
    });
  });

  it("the matrix is frozen at runtime (no silent mutation)", () => {
    expect(Object.isFrozen(CAPABILITY_MATRIX)).toBe(true);
  });

  it("every model pins a version and never uses 'latest'", () => {
    for (const m of Object.values(CAPABILITY_MATRIX)) {
      expect(m.modelVersion).toBeTruthy();
      expect(m.modelVersion).not.toMatch(/latest/i);
    }
  });

  it("the hero default exists and is the mid tier (marquee sharpness)", () => {
    const id = DEFAULT_MODEL_FOR_JOB.hero;
    expect(CAPABILITY_MATRIX[id]).toBeDefined();
    expect(getCapability(id).tier).toBe("mid");
  });

  it("the photo default exists and is the draft tier (cheap inline support)", () => {
    const id = DEFAULT_MODEL_FOR_JOB.photo;
    expect(CAPABILITY_MATRIX[id]).toBeDefined();
    expect(getCapability(id).tier).toBe("draft");
  });
});

describe("imagegen/1 — capability lookup", () => {
  it("getCapability returns the row for a known model", () => {
    expect(getCapability("bfl/flux-2-klein-4b").tier).toBe("draft");
  });

  it("getCapability throws UnknownModelError for an unknown model (the gate)", () => {
    expect(() => getCapability("acme/imaginator-9000")).toThrow(
      UnknownModelError,
    );
  });

  it("modelsForJob('hero') returns eligible models ordered draft → … → final", () => {
    const tiers = modelsForJob("hero").map((m) => m.tier);
    expect(tiers[0]).toBe("draft");
    expect(tiers[tiers.length - 1]).toBe("final");
    expect(tiers).toContain("mid");
  });
});
