import { describe, it, expect } from "vitest";
import { lintBrokenChunks } from "./broken-chunk-linter";

// ── Tier 1: crafted bodies ───────────────────────────────────────────────────

describe("lintBrokenChunks — passing (self-contained) bodies", () => {
  it("passes a well-structured 3-section body", () => {
    const body = [
      "## What is composting?",
      "Composting is the natural process of recycling organic matter such as leaves and food scraps into a valuable fertilizer. It happens when microbes break down material in the presence of oxygen.",
      "",
      "## How long does composting take?",
      "A backyard compost pile typically takes three to six months to fully break down. Turning the pile weekly and keeping it moist speeds the process considerably.",
      "",
      "## What can you put in a compost bin?",
      "You can add fruit and vegetable scraps, coffee grounds, eggshells, and yard trimmings. Avoid meat, dairy, and oily foods, which attract pests and slow decomposition.",
    ].join("\n");

    const result = lintBrokenChunks(body);
    expect(result.passed).toBe(true);
    expect(result.brokenSections).toEqual([]);
    expect(result.failureCode).toBeUndefined();
  });

  it("does not flag a self-contained section opening with 'This guide…'", () => {
    const body = [
      "## Getting started",
      "This guide walks you through installing the toolkit on macOS and Linux. Each step includes a copy-pasteable command.",
      "",
      "## Verifying the install",
      "Run the version command to confirm everything is wired up. A healthy install prints the semantic version and the build date.",
    ].join("\n");

    const result = lintBrokenChunks(body);
    expect(result.passed).toBe(true);
  });

  it("does not flag a section using 'this' mid-paragraph", () => {
    const body = [
      "## Caching strategy",
      "We cache responses at the edge for sixty seconds. This dramatically reduces origin load during traffic spikes, and readers never notice the difference.",
      "",
      "## Invalidation",
      "Tags let you purge related entries in a single call. Group entries by resource so a write invalidates exactly what changed.",
    ].join("\n");

    const result = lintBrokenChunks(body);
    expect(result.passed).toBe(true);
  });
});

describe("lintBrokenChunks — failing bodies", () => {
  it("fails a body with a heading-less orphan block", () => {
    const body = [
      "Some intro text that floats with no heading above any structured content and cannot be lifted as an answer to a question.",
      "",
      "## A real section",
      "This section has a proper heading and a self-contained body that answers a clear question for the reader.",
      "",
      "## Another real section",
      "More self-contained content that stands on its own without referring back to anything earlier in the document.",
    ].join("\n");

    const result = lintBrokenChunks(body);
    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("VETO_BROKEN_CHUNK");
    expect(result.brokenSections.length).toBeGreaterThan(0);
    expect(result.brokenSections[0]).toMatch(/orphan/i);
  });

  it("fails a section opening with 'As mentioned above…'", () => {
    const body = [
      "## Setup",
      "Install the dependencies and configure your environment variables before continuing.",
      "",
      "## Troubleshooting",
      "As mentioned above, the environment variables must be set first, otherwise the build fails with a cryptic error.",
    ].join("\n");

    const result = lintBrokenChunks(body);
    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("VETO_BROKEN_CHUNK");
    expect(result.brokenSections).toContain("Troubleshooting");
  });

  it("fails a section opening with a bare 'This is…' back-reference", () => {
    const body = [
      "## The problem",
      "Cold starts add latency to every first request after a function scales to zero.",
      "",
      "## Why it matters",
      "This is the single biggest contributor to tail latency in serverless deployments.",
    ].join("\n");

    const result = lintBrokenChunks(body);
    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("VETO_BROKEN_CHUNK");
    expect(result.brokenSections).toContain("Why it matters");
  });

  it("fails a heading with an empty body (dangling heading)", () => {
    const body = [
      "## Overview",
      "A self-contained overview paragraph that explains the topic for any reader arriving from search.",
      "",
      "## Pricing",
      "",
      "## Conclusion",
      "A self-contained closing paragraph summarizing the key takeaways for the reader.",
    ].join("\n");

    const result = lintBrokenChunks(body);
    expect(result.passed).toBe(false);
    expect(result.failureCode).toBe("VETO_BROKEN_CHUNK");
    expect(result.brokenSections).toContain("Pricing");
  });

  it("flags 'As above' (terse form) and H3 headings too", () => {
    const body = [
      "### Step one",
      "Create the project directory and initialize version control so every change is tracked from the start.",
      "",
      "### Step two",
      "As above, but this time target the staging branch instead of main.",
    ].join("\n");

    const result = lintBrokenChunks(body);
    expect(result.passed).toBe(false);
    expect(result.brokenSections).toContain("Step two");
  });
});

describe("lintBrokenChunks — empty / whitespace", () => {
  it("returns passed:true for an empty body without throwing", () => {
    expect(lintBrokenChunks("").passed).toBe(true);
    expect(lintBrokenChunks("").failureCode).toBeUndefined();
  });

  it("returns passed:true for a whitespace-only body", () => {
    expect(lintBrokenChunks("   \n\n  \t ").passed).toBe(true);
  });

  it("does not flag a fully heading-less body (different concern)", () => {
    // A doc with no headings at all is a structure/length problem handled
    // elsewhere — this linter should not veto it as a broken chunk.
    const body =
      "A single flowing paragraph with no headings at all. It still reads fine and is not an information island in the heading sense.";
    expect(lintBrokenChunks(body).passed).toBe(true);
  });
});

// ── Tier 2: realistic well-structured posts (no false-positive veto) ─────────

describe("lintBrokenChunks — Tier 2: real-world good content passes", () => {
  const POST_A = [
    "## What is a content delivery network?",
    "A content delivery network, or CDN, is a geographically distributed group of servers that cache content close to end users. By serving assets from a nearby location, a CDN reduces latency and speeds up page loads for visitors around the world.",
    "",
    "## How does a CDN improve performance?",
    "When a visitor requests a page, the CDN serves cached copies of images, scripts, and stylesheets from the nearest edge location instead of the origin server. Shorter network distance means faster delivery and less load on your infrastructure.",
    "",
    "## Do small websites need a CDN?",
    "Even modest sites benefit from a CDN once they attract visitors from multiple regions. Most providers offer free tiers that cover typical small-business traffic, making the performance gains essentially cost-free.",
  ].join("\n");

  const POST_B = [
    "## Why sourdough needs a starter",
    "A sourdough starter is a living culture of flour and water that captures wild yeast and bacteria. This culture leavens the bread and gives sourdough its signature tang, replacing the commercial yeast used in most recipes.",
    "",
    "## How to feed your starter",
    "Feed the starter daily by discarding half and stirring in equal parts fresh flour and water. Regular feeding keeps the yeast active and the culture strong enough to raise a loaf.",
    "",
    "## Signs your starter is ready to bake",
    "A ready starter doubles in size within four to six hours of feeding and smells pleasantly sour. Drop a spoonful in water: if it floats, the culture has enough gas to leaven your dough.",
  ].join("\n");

  const POST_C = [
    "## Setting up your first Git repository",
    "Initialize a repository by running the init command inside your project folder. Git then begins tracking every file you choose to stage, recording a full history of your changes.",
    "",
    "### Staging and committing changes",
    "Stage the files you want to save, then commit them with a short descriptive message. Each commit becomes a permanent snapshot you can return to later.",
    "",
    "### Pushing to a remote",
    "Add a remote that points to a hosted repository, then push your commits to share them. Collaborators can now pull your work and contribute their own changes.",
  ].join("\n");

  it("POST_A (CDN explainer) passes with no veto", () => {
    const r = lintBrokenChunks(POST_A);
    expect(r.passed).toBe(true);
    expect(r.brokenSections).toEqual([]);
  });

  it("POST_B (sourdough guide) passes with no veto", () => {
    const r = lintBrokenChunks(POST_B);
    expect(r.passed).toBe(true);
    expect(r.brokenSections).toEqual([]);
  });

  it("POST_C (Git tutorial with H3s) passes with no veto", () => {
    const r = lintBrokenChunks(POST_C);
    expect(r.passed).toBe(true);
    expect(r.brokenSections).toEqual([]);
  });
});
