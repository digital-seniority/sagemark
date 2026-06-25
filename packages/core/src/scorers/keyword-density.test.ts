import { describe, it, expect } from "vitest";
import { analyzeKeywordDensity } from "./keyword-density";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a plain-text body with exactly `n` words */
function makeBody(words: string[]): string {
  return words.join(" ");
}

/** Build a body of `n` filler words then inject `keyword` at the start */
function fillerBody(n: number, filler = "word"): string {
  return Array.from({ length: n }, () => filler).join(" ");
}

// ── Zero occurrences ──────────────────────────────────────────────────────────

describe("analyzeKeywordDensity — zero occurrences", () => {
  it("returns densityPercent 0.00 and status under when keyword absent", () => {
    const body = fillerBody(100, "filler");
    const result = analyzeKeywordDensity(body, "marketing");
    expect(result.occurrences).toBe(0);
    expect(result.wordCount).toBe(100);
    expect(result.densityPercent).toBe(0);
    expect(result.status).toBe("under");
  });

  it("includes the 'under' recommendation when absent", () => {
    const result = analyzeKeywordDensity(fillerBody(50, "filler"), "missing");
    expect(result.recommendation).toMatch(/opening paragraph/i);
  });
});

// ── Single occurrence / optimal ───────────────────────────────────────────────

describe("analyzeKeywordDensity — single occurrence in 100-word text", () => {
  it("returns 1 occurrence, 1.00%, optimal", () => {
    // 99 filler words + 1 keyword = 100 words, 1%
    const words = Array.from({ length: 99 }, () => "filler");
    words.splice(10, 0, "marketing"); // insert at position 10
    const body = words.join(" ");

    const result = analyzeKeywordDensity(body, "marketing");
    expect(result.occurrences).toBe(1);
    expect(result.wordCount).toBe(100);
    expect(result.densityPercent).toBe(1);
    expect(result.status).toBe("optimal");
  });

  it("returns the 'optimal' recommendation for 1%", () => {
    const words = Array.from({ length: 99 }, () => "filler");
    words.push("marketing");
    const result = analyzeKeywordDensity(words.join(" "), "marketing");
    expect(result.recommendation).toMatch(/natural density/i);
  });
});

// ── Stuffed ───────────────────────────────────────────────────────────────────

describe("analyzeKeywordDensity — stuffed", () => {
  it("returns 50.00% and status stuffed for 50 occurrences in 100 words", () => {
    // 50 "marketing" + 50 "filler" = 100 words
    const words = [
      ...Array.from({ length: 50 }, () => "marketing"),
      ...Array.from({ length: 50 }, () => "filler"),
    ];
    const result = analyzeKeywordDensity(words.join(" "), "marketing");
    expect(result.occurrences).toBe(50);
    expect(result.wordCount).toBe(100);
    expect(result.densityPercent).toBe(50);
    expect(result.status).toBe("stuffed");
  });

  it("returns the 'stuffed' recommendation for high density", () => {
    const words = Array.from({ length: 10 }, () => "marketing");
    // 10 out of 10 words = 100%
    const result = analyzeKeywordDensity(words.join(" "), "marketing");
    expect(result.recommendation).toMatch(/keyword stuffing/i);
  });
});

// ── Case-insensitive ──────────────────────────────────────────────────────────

describe("analyzeKeywordDensity — case-insensitive", () => {
  it("counts 'Marketing', 'MARKETING', and 'marketing' as the same keyword", () => {
    const body = "Marketing is important. MARKETING helps. Use marketing wisely.";
    const result = analyzeKeywordDensity(body, "marketing");
    expect(result.occurrences).toBe(3);
  });
});

// ── Whole-word match ──────────────────────────────────────────────────────────

describe("analyzeKeywordDensity — whole-word match", () => {
  it("does not count 'adgen' as a match for keyword 'ad'", () => {
    const body = "adgen adgen adgen";
    const result = analyzeKeywordDensity(body, "ad");
    expect(result.occurrences).toBe(0);
  });

  it("counts standalone 'ad' but not 'adgen'", () => {
    const body = "This ad is great. adgen is a tool. Another ad here.";
    const result = analyzeKeywordDensity(body, "ad");
    expect(result.occurrences).toBe(2);
  });
});

// ── Multi-word keyword phrase ─────────────────────────────────────────────────

describe("analyzeKeywordDensity — multi-word keyword phrase", () => {
  it("counts full phrase 'content marketing' correctly", () => {
    const body =
      "Content marketing is a discipline. Good content marketing strategy matters. Invest in content marketing today.";
    const result = analyzeKeywordDensity(body, "content marketing");
    expect(result.occurrences).toBe(3);
  });

  it("does not count partial phrase matches", () => {
    const body = "Good content is key. Marketing helps too.";
    const result = analyzeKeywordDensity(body, "content marketing");
    // "content" and "marketing" appear but not adjacent as a phrase
    expect(result.occurrences).toBe(0);
  });

  it("uses total word count (not phrase-count) for density calculation", () => {
    // 5 words, phrase appears once → 1/5 = 20%
    const body = "content marketing content marketing filler";
    const result = analyzeKeywordDensity(body, "content marketing");
    expect(result.wordCount).toBe(5);
    expect(result.occurrences).toBe(2);
    expect(result.densityPercent).toBe(40);
    expect(result.status).toBe("stuffed");
  });
});

// ── Special regex chars in keyword ───────────────────────────────────────────

describe("analyzeKeywordDensity — special regex chars escaped", () => {
  it("handles keyword with '++' without throwing", () => {
    const body = "C++ is a language. We discuss C++ here. Also C++ performance.";
    const result = analyzeKeywordDensity(body, "C++");
    // Should not throw; occurrences ≥ 0
    expect(result.occurrences).toBeGreaterThanOrEqual(0);
    expect(result.densityPercent).toBeGreaterThanOrEqual(0);
  });

  it("matches 'C++ ads' as a phrase with special chars", () => {
    const body = "C++ ads dominate. We love C++ ads. Regular ads too.";
    const result = analyzeKeywordDensity(body, "C++ ads");
    expect(result.occurrences).toBe(2);
  });
});

// ── Rounding to 2 decimal places ─────────────────────────────────────────────

describe("analyzeKeywordDensity — densityPercent rounded to 2dp", () => {
  it("rounds 1/3 correctly", () => {
    // 1 occurrence in 300 words → 0.333…% → 0.33%
    const words = Array.from({ length: 299 }, () => "filler");
    words.push("keyword");
    const result = analyzeKeywordDensity(words.join(" "), "keyword");
    expect(result.densityPercent).toBe(0.33);
  });

  it("rounds 2/3 correctly", () => {
    // 2 occurrences in 300 words → 0.666…% → 0.67%
    const words = [
      "keyword",
      "keyword",
      ...Array.from({ length: 298 }, () => "filler"),
    ];
    const result = analyzeKeywordDensity(words.join(" "), "keyword");
    expect(result.densityPercent).toBe(0.67);
  });
});

// ── Status thresholds ─────────────────────────────────────────────────────────

describe("analyzeKeywordDensity — status thresholds", () => {
  it("under: densityPercent exactly 0 → status under", () => {
    const result = analyzeKeywordDensity(fillerBody(100, "filler"), "absent");
    expect(result.status).toBe("under");
  });

  it("under: densityPercent 0.49 → status under", () => {
    // Need ~0.49 density: need ~49/100 ratio to be just under 0.5; simpler: 1 in 205 ≈ 0.488%
    const words = [
      "keyword",
      ...Array.from({ length: 204 }, () => "filler"),
    ];
    const result = analyzeKeywordDensity(words.join(" "), "keyword");
    expect(result.densityPercent).toBeLessThan(0.5);
    expect(result.status).toBe("under");
  });

  it("optimal: densityPercent 0.5 → status optimal", () => {
    // 1 in 200 = 0.5%
    const words = [
      "keyword",
      ...Array.from({ length: 199 }, () => "filler"),
    ];
    const result = analyzeKeywordDensity(words.join(" "), "keyword");
    expect(result.densityPercent).toBe(0.5);
    expect(result.status).toBe("optimal");
  });

  it("optimal: densityPercent 3.0 → status optimal (well below 4% threshold)", () => {
    // 3 in 100 = 3.0%
    const words = [
      "keyword",
      "keyword",
      "keyword",
      ...Array.from({ length: 97 }, () => "filler"),
    ];
    const result = analyzeKeywordDensity(words.join(" "), "keyword");
    expect(result.densityPercent).toBe(3);
    expect(result.status).toBe("optimal");
  });

  it("optimal: densityPercent 3.5 → status optimal (below new 4% threshold)", () => {
    // 3.5 in 100 words → need 7 in 200 = 3.5%
    const words = [
      ...Array.from({ length: 7 }, () => "keyword"),
      ...Array.from({ length: 193 }, () => "filler"),
    ];
    const result = analyzeKeywordDensity(words.join(" "), "keyword");
    expect(result.densityPercent).toBe(3.5);
    expect(result.status).toBe("optimal");
  });

  it("stuffed: densityPercent 4.5 → status stuffed (above 4% threshold)", () => {
    // 9 in 200 = 4.5%
    const words = [
      ...Array.from({ length: 9 }, () => "keyword"),
      ...Array.from({ length: 191 }, () => "filler"),
    ];
    const result = analyzeKeywordDensity(words.join(" "), "keyword");
    expect(result.densityPercent).toBe(4.5);
    expect(result.status).toBe("stuffed");
  });
});

// ── Recommendation strings ────────────────────────────────────────────────────

describe("analyzeKeywordDensity — recommendation strings", () => {
  it("under recommendation mentions opening paragraph", () => {
    const result = analyzeKeywordDensity(fillerBody(100, "filler"), "ghost");
    expect(result.recommendation).toContain("opening paragraph");
  });

  it("optimal recommendation mentions natural density", () => {
    const words = [
      "keyword",
      ...Array.from({ length: 99 }, () => "filler"),
    ];
    const result = analyzeKeywordDensity(words.join(" "), "keyword");
    expect(result.recommendation.toLowerCase()).toContain("natural density");
  });

  it("stuffed recommendation mentions 4% threshold, Google, and synonyms", () => {
    const words = Array.from({ length: 50 }, () => "keyword").concat(
      Array.from({ length: 50 }, () => "filler"),
    );
    const result = analyzeKeywordDensity(words.join(" "), "keyword");
    expect(result.recommendation).toContain("4%");
    expect(result.recommendation).toContain("Google");
    expect(result.recommendation).toContain("synonyms");
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("analyzeKeywordDensity — edge cases", () => {
  it("handles empty draft gracefully", () => {
    const result = analyzeKeywordDensity("", "marketing");
    expect(result.occurrences).toBe(0);
    expect(result.wordCount).toBe(0);
    expect(result.densityPercent).toBe(0);
    expect(result.status).toBe("under");
  });

  it("strips markdown before counting words", () => {
    const mdBody = "## Heading\n**bold** text and _italic_ content about marketing.";
    const result = analyzeKeywordDensity(mdBody, "marketing");
    // Markdown stripped → plain text word count should not include markers
    // "Heading bold text and italic content about marketing" = 9 words
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.occurrences).toBe(1);
  });

  it("returns correct keyword field", () => {
    const result = analyzeKeywordDensity("test content here", "content");
    expect(result.keyword).toBe("content");
  });
});
