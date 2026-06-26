/**
 * constrained-edit-contract — the bounded-diff contract unit tests (PR 012). These
 * pin the "bounded, not a free rewrite" invariant deterministically: region
 * resolution maps each address mode to an exact span, the splice changes ONLY that
 * span, and an oversized replacement / bad region is rejected.
 */

import { describe, it, expect } from "vitest";
import {
  resolveRegion,
  applyBoundedEdit,
  assertWithinBound,
  growthCeiling,
  hashBody,
  EditBoundExceededError,
  type BoundedDiff,
} from "@/lib/edit/constrained-edit-contract";

const BODY =
  "## Intro\n\nWelcome.\n\n## Costs\n\nWe start at $5,000.\n\n## Hours\n\nOpen daily.\n";

describe("resolveRegion", () => {
  it("resolves a section to the heading-through-next-heading span", () => {
    const span = resolveRegion(BODY, { kind: "section", heading: "Costs" });
    expect(span.text.startsWith("## Costs")).toBe(true);
    expect(span.text).toContain("We start at $5,000.");
    expect(span.text).not.toContain("## Hours");
    // The span round-trips: slicing the body by [start,end) reproduces it.
    expect(BODY.slice(span.start, span.end)).toBe(span.text);
  });

  it("resolves the last section to EOF", () => {
    const span = resolveRegion(BODY, { kind: "section", heading: "Hours" });
    expect(span.text).toContain("Open daily.");
    expect(span.end).toBe(BODY.length);
  });

  it("resolves a paragraph by 0-based index", () => {
    const span = resolveRegion(BODY, { kind: "paragraph", index: 1 });
    expect(span.text).toBe("Welcome.");
  });

  it("resolves an explicit span", () => {
    const span = resolveRegion(BODY, { kind: "span", start: 0, end: 8 });
    expect(span.text).toBe("## Intro");
  });

  it("throws region-not-found for a missing heading", () => {
    expect(() => resolveRegion(BODY, { kind: "section", heading: "Nope" })).toThrow(
      EditBoundExceededError,
    );
  });

  it("throws region-out-of-range for a span past EOF", () => {
    expect(() =>
      resolveRegion(BODY, { kind: "span", start: 0, end: BODY.length + 50 }),
    ).toThrow(EditBoundExceededError);
  });
});

describe("applyBoundedEdit — bounded splice", () => {
  it("changes ONLY the addressed region; the rest is byte-identical", () => {
    const diff: BoundedDiff = {
      replacement: "## Costs\n\nWe begin around $5,000.\n",
      summary: "softened cost",
    };
    const applied = applyBoundedEdit(BODY, { kind: "section", heading: "Costs" }, diff);
    expect(applied.body).toContain("## Intro\n\nWelcome.");
    expect(applied.body).toContain("## Hours\n\nOpen daily.");
    expect(applied.body).toContain("We begin around $5,000.");
    expect(applied.body).not.toContain("We start at $5,000.");
    // The hash is the SHA-256 of the new body.
    expect(applied.newHash).toBe(hashBody(applied.body));
  });

  it("rejects an oversized replacement (a free rewrite)", () => {
    const span = resolveRegion(BODY, { kind: "section", heading: "Costs" });
    const big: BoundedDiff = { replacement: "x".repeat(growthCeiling(span.end - span.start) + 1), summary: "big" };
    expect(() => assertWithinBound(big, span)).toThrow(EditBoundExceededError);
    expect(() => applyBoundedEdit(BODY, { kind: "section", heading: "Costs" }, big)).toThrow(
      /not a free rewrite/,
    );
  });

  it("allows a proportionate growth within the ceiling", () => {
    const span = resolveRegion(BODY, { kind: "section", heading: "Costs" });
    const ok: BoundedDiff = { replacement: "y".repeat(growthCeiling(span.end - span.start)), summary: "ok" };
    expect(() => assertWithinBound(ok, span)).not.toThrow();
  });
});

describe("hashBody", () => {
  it("is a stable 64-char hex SHA-256", () => {
    const h = hashBody("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBody("hello")).toBe(h);
    expect(hashBody("hello!")).not.toBe(h);
  });
});
