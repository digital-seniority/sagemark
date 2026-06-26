/**
 * spec.test.ts — the canonical image spec contract (`imagegen/1`).
 *
 * Ported from flywheel-main + adapted for the SEO `hero`/`photo` jobs.
 */
import { describe, it, expect } from "vitest";
import {
  CanonicalImageSpecSchema,
  IMAGE_SPEC_VERSION,
  type CanonicalImageSpec,
} from "../src/engine/spec";

/** A minimal valid hero spec (only required fields). */
function minimalSpec(): Record<string, unknown> {
  return {
    schemaVersion: IMAGE_SPEC_VERSION,
    job: "hero",
    subject: "a warm sunlit common room in a senior-living community",
    style: "photoreal",
    aspectRatio: "16:9",
  };
}

describe("imagegen/1 — CanonicalImageSpec", () => {
  it("parses a minimal spec and applies all defaults", () => {
    const parsed = CanonicalImageSpecSchema.parse(minimalSpec());
    expect(parsed).toStrictEqual({
      schemaVersion: 1,
      job: "hero",
      subject: "a warm sunlit common room in a senior-living community",
      style: "photoreal",
      aspectRatio: "16:9",
      composition: "",
      palette: [],
      text: [],
      locale: "en",
      constraints: [],
    } satisfies CanonicalImageSpec);
  });

  it("accepts the new SEO jobs (hero + photo) and the reference job", () => {
    for (const job of ["hero", "photo", "scene-background"]) {
      expect(
        CanonicalImageSpecSchema.parse({ ...minimalSpec(), job }).job,
      ).toBe(job);
    }
  });

  it("rejects an unknown job", () => {
    expect(() =>
      CanonicalImageSpecSchema.parse({ ...minimalSpec(), job: "banner" }),
    ).toThrow();
  });

  it("rejects an unknown key (strict — a caller speaking an unmodelled dialect)", () => {
    const bad = { ...minimalSpec(), styleHint: "extra" };
    expect(() => CanonicalImageSpecSchema.parse(bad)).toThrow();
  });

  it("rejects a malformed palette hex", () => {
    const bad = {
      ...minimalSpec(),
      palette: [{ role: "background", hex: "blue" }],
    };
    expect(() => CanonicalImageSpecSchema.parse(bad)).toThrow();
  });

  it("accepts a #rrggbb palette hint", () => {
    const ok = {
      ...minimalSpec(),
      palette: [{ role: "background", hex: "#1f2937" }],
    };
    expect(CanonicalImageSpecSchema.parse(ok).palette).toStrictEqual([
      { role: "background", hex: "#1f2937" },
    ]);
  });

  it("rejects an unsupported aspect ratio", () => {
    const bad = { ...minimalSpec(), aspectRatio: "4:3" };
    expect(() => CanonicalImageSpecSchema.parse(bad)).toThrow();
  });

  it("rejects the wrong schema version (forces a migration signal)", () => {
    const bad = { ...minimalSpec(), schemaVersion: 2 };
    expect(() => CanonicalImageSpecSchema.parse(bad)).toThrow();
  });
});
