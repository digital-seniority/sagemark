/**
 * Slice 5 — build-project-context (node).
 *
 * The hybrid cross-article context: the operator brief + an auto-assembled fact
 * list of prior articles. Asserts: an empty project carries nothing (null); the
 * brief + prior-piece facts are included with role/stage/keyword tags; and the
 * note is bounded.
 */

import { describe, it, expect } from "vitest";

import { buildProjectContext } from "@/lib/projects/build-project-context";

describe("buildProjectContext", () => {
  it("returns null for an empty project (no brief, no pieces)", () => {
    expect(buildProjectContext({ projectName: "Empty", brief: "", pieces: [] })).toBeNull();
  });

  it("includes the brief and prior-article facts with tags", () => {
    const note = buildProjectContext({
      projectName: "Dementia Care Hub",
      brief: "Warm, non-institutional voice. Pillar is memory care in Skagit County.",
      pieces: [
        {
          title: "Early signs of dementia",
          slug: "early-signs",
          clusterRole: "spoke",
          funnelStage: "decision",
          primaryKeyword: "early signs of dementia",
          excerpt: "What families should watch for.",
        },
        { title: "Memory care costs", slug: "costs", clusterRole: "faq", funnelStage: null, primaryKeyword: "memory care cost", excerpt: null },
      ],
    });
    expect(note).toBeTruthy();
    expect(note!).toContain("Dementia Care Hub");
    expect(note!).toContain("Warm, non-institutional voice");
    expect(note!).toContain("Early signs of dementia");
    expect(note!).toContain("[spoke · decision · early signs of dementia]");
    expect(note!).toContain("[faq · memory care cost]"); // null stage omitted from the tag
    expect(note!).toContain("do NOT");
  });

  it("carries the brief alone when there are no prior pieces", () => {
    const note = buildProjectContext({ projectName: "New Hub", brief: "Start with the pillar.", pieces: [] });
    expect(note).toContain("Start with the pillar.");
  });

  it("bounds the note size and caps the piece count", () => {
    const pieces = Array.from({ length: 50 }, (_, i) => ({
      title: `Article ${i} ${"x".repeat(200)}`,
      slug: `a-${i}`,
      clusterRole: "spoke",
      funnelStage: "awareness",
      primaryKeyword: "kw",
      excerpt: "y".repeat(500),
    }));
    const note = buildProjectContext({ projectName: "Big", brief: "z".repeat(500), pieces }, { maxChars: 1500 });
    expect(note!.length).toBeLessThanOrEqual(1500);
  });
});
