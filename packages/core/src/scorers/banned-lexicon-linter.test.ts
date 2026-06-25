import { describe, it, expect } from "vitest";
import { lintBannedLexicon } from "./banned-lexicon-linter";

describe("lintBannedLexicon", () => {
  // ── Clean control ─────────────────────────────────────────────────────────

  it("passes a clean body with no banned terms or slop phrases", () => {
    const body =
      "Our pruning service keeps your orchard healthy through every season. " +
      "We schedule visits around bloom and harvest so trees stay productive.";
    const r = lintBannedLexicon(body, ["synergy", "leverage"]);
    expect(r.passed).toBe(true);
    expect(r.hits).toEqual([]);
    expect(r.failureCode).toBeUndefined();
  });

  // ── Client-specific banned term ───────────────────────────────────────────

  it("detects a client-specific banned term (case-insensitive)", () => {
    const body = "We Leverage best-in-class synergy to delight customers.";
    const r = lintBannedLexicon(body, ["leverage", "synergy"]);
    expect(r.passed).toBe(false);
    expect(r.failureCode).toBe("VETO_BANNED_LEXICON");
    const terms = r.hits.map((h) => h.term);
    expect(terms).toContain("leverage");
    expect(terms).toContain("synergy");
    const leverage = r.hits.find((h) => h.term === "leverage");
    expect(leverage?.source).toBe("client");
    expect(leverage?.count).toBe(1);
  });

  it("counts multiple occurrences of a client term", () => {
    const body = "Synergy here. More synergy there. Synergy everywhere.";
    const r = lintBannedLexicon(body, ["synergy"]);
    const synergy = r.hits.find((h) => h.term === "synergy");
    expect(synergy?.count).toBe(3);
  });

  // ── Built-in slop phrase ──────────────────────────────────────────────────

  it("detects a built-in slop phrase", () => {
    const body =
      "In today's fast-paced world, choosing a care home is hard. " +
      "It's important to note that families have options.";
    const r = lintBannedLexicon(body, []);
    expect(r.passed).toBe(false);
    expect(r.failureCode).toBe("VETO_BANNED_LEXICON");
    const terms = r.hits.map((h) => h.term);
    expect(terms).toContain("in today's fast-paced world");
    expect(terms).toContain("it's important to note");
    for (const h of r.hits) expect(h.source).toBe("builtin");
  });

  it('detects "in conclusion" even when wrapped in markdown bold', () => {
    const body = "**In conclusion**, the orchard thrives with regular care.";
    const r = lintBannedLexicon(body, []);
    expect(r.passed).toBe(false);
    expect(r.hits.map((h) => h.term)).toContain("in conclusion");
  });

  // ── Empty bannedTerms still applies the floor ─────────────────────────────

  it("applies the built-in floor even when bannedTerms[] is empty", () => {
    const body = "At the end of the day, we deliver. In conclusion, we win.";
    const r = lintBannedLexicon(body, []);
    expect(r.passed).toBe(false);
    const terms = r.hits.map((h) => h.term);
    expect(terms).toContain("at the end of the day");
    expect(terms).toContain("in conclusion");
  });

  it("applies the floor when bannedTerms is omitted entirely", () => {
    const body = "Let's face it, this needs work. In conclusion, more work.";
    const r = lintBannedLexicon(body);
    expect(r.passed).toBe(false);
    expect(r.hits.map((h) => h.term)).toContain("in conclusion");
  });

  // ── Word-boundary awareness (no substring false positives) ────────────────

  it("does not flag 'conclusion' inside a longer word", () => {
    // "preconclusionary" contains "conclusion" but is not the slop phrase
    // "in conclusion"; and a bare client term "conclusion" must not match
    // inside a larger word.
    const body = "The preconclusionary remarks were thorough and concrete.";
    const r = lintBannedLexicon(body, ["conclusion"]);
    expect(r.passed).toBe(true);
    expect(r.hits).toEqual([]);
  });

  it("matches a standalone client term but not its superstring", () => {
    const body = "We value craft. Craftsmanship is different from craft itself.";
    const r = lintBannedLexicon(body, ["craft"]);
    const craft = r.hits.find((h) => h.term === "craft");
    // "craft" appears twice as a standalone word; "craftsmanship" excluded.
    expect(craft?.count).toBe(2);
  });

  // ── Em-dash spam (built-in, threshold-based) ──────────────────────────────

  it("flags em-dash spam at or above the threshold", () => {
    const body =
      "We grow — we prune — we harvest — we deliver year-round.";
    const r = lintBannedLexicon(body, []);
    expect(r.passed).toBe(false);
    const emDash = r.hits.find((h) => h.term === "em-dash spam");
    expect(emDash).toBeDefined();
    expect(emDash?.count).toBe(3);
  });

  it("does not flag occasional em-dash use below the threshold", () => {
    const body = "We grow — we prune. A clean, simple operation.";
    const r = lintBannedLexicon(body, []);
    expect(r.hits.find((h) => h.term === "em-dash spam")).toBeUndefined();
  });

  // ── Attribution + dedupe ──────────────────────────────────────────────────

  it("attributes a term shared by client list and floor to the client", () => {
    const body = "In conclusion, we are done.";
    const r = lintBannedLexicon(body, ["in conclusion"]);
    const hit = r.hits.find((h) => h.term === "in conclusion");
    expect(hit?.source).toBe("client");
    // Not double-counted as both client and builtin.
    expect(r.hits.filter((h) => h.term === "in conclusion")).toHaveLength(1);
  });

  it("ignores empty / whitespace-only client terms", () => {
    const body = "A perfectly clean sentence about orchards.";
    const r = lintBannedLexicon(body, ["", "   "]);
    expect(r.passed).toBe(true);
    expect(r.hits).toEqual([]);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("handles an empty body", () => {
    const r = lintBannedLexicon("", ["leverage"]);
    expect(r.passed).toBe(true);
    expect(r.hits).toEqual([]);
  });
});
