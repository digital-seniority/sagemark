// @vitest-environment node
/**
 * Tests for detectPassiveVoice — passive voice heuristic using
 * be-verb + past participle pattern.
 *
 * Interface under test:
 *   passiveCount:  number of sentences containing a passive match
 *   totalSentences: sentence count derived from ./?/! splits
 *   ratio:         passiveCount / totalSentences (0–1)
 *   examples:      first 3 matched passive sentences (truncated at 80 chars)
 *   verdict:       "LOW" | "MODERATE" | "HIGH"
 *   tip:           null for LOW, descriptive string for MODERATE / HIGH
 *
 * Thresholds: LOW <10%, MODERATE 10–<20%, HIGH ≥20%
 */
import { describe, it, expect } from "vitest";
import { detectPassiveVoice } from "./passive-voice";

// ── 1. Empty / whitespace ─────────────────────────────────────────────────────

describe("detectPassiveVoice — empty / whitespace", () => {
  it("empty string → passiveCount:0, totalSentences:0, ratio:0, verdict LOW", () => {
    const r = detectPassiveVoice("");
    expect(r.passiveCount).toBe(0);
    expect(r.totalSentences).toBe(0);
    expect(r.ratio).toBe(0);
    expect(r.verdict).toBe("LOW");
    expect(r.tip).toBeNull();
    expect(r.examples).toEqual([]);
  });

  it("whitespace-only body → zero counts, verdict LOW, null tip", () => {
    const r = detectPassiveVoice("   \n\t  ");
    expect(r.passiveCount).toBe(0);
    expect(r.totalSentences).toBe(0);
    expect(r.verdict).toBe("LOW");
    expect(r.tip).toBeNull();
  });
});

// ── 2. All-active voice ───────────────────────────────────────────────────────

describe("detectPassiveVoice — all-active voice", () => {
  it("pure active sentences → verdict LOW, passiveCount 0", () => {
    const body = "She writes the report every Monday. The team ships features quickly. James leads the project.";
    const r = detectPassiveVoice(body);
    expect(r.verdict).toBe("LOW");
    expect(r.passiveCount).toBe(0);
    expect(r.tip).toBeNull();
  });

  it("short body (<3 sentences) all active → LOW vacuously", () => {
    const r = detectPassiveVoice("We build great tools. Our clients trust us.");
    expect(r.verdict).toBe("LOW");
    expect(r.passiveCount).toBe(0);
  });

  it("active voice with 'was' not followed by past participle → NOT passive", () => {
    // "was" as past tense verb, not passive auxiliary
    const r = detectPassiveVoice("He was there yesterday. She was happy about the result. They was [sic] very fast.");
    // none of these are "was + past-participle" in the irregular list
    expect(r.passiveCount).toBe(0);
    expect(r.verdict).toBe("LOW");
  });

  it("'is interesting' → NOT passive (not a past participle)", () => {
    // 'interesting' is present participle / adjective, not in -ed or irregular list
    const r = detectPassiveVoice("The approach is interesting. The method is compelling. Data is revealing.");
    expect(r.passiveCount).toBe(0);
    expect(r.verdict).toBe("LOW");
  });
});

// ── 3. Regular -ed passive constructions ─────────────────────────────────────

describe("detectPassiveVoice — regular -ed past participles", () => {
  it("'was launched' is detected as passive", () => {
    const r = detectPassiveVoice("The product was launched by the team.");
    expect(r.passiveCount).toBe(1);
  });

  it("'is created' is detected as passive", () => {
    const r = detectPassiveVoice("The report is created each quarter.");
    expect(r.passiveCount).toBe(1);
  });

  it("'were established' is detected", () => {
    const r = detectPassiveVoice("New processes were established this year.");
    expect(r.passiveCount).toBe(1);
  });

  it("'are developed' is detected", () => {
    const r = detectPassiveVoice("Features are developed by the core team.");
    expect(r.passiveCount).toBe(1);
  });

  it("'being analyzed' is detected (progressive passive)", () => {
    const r = detectPassiveVoice("The proposal is being analyzed carefully.");
    expect(r.passiveCount).toBe(1);
  });

  it("'been reviewed' is detected (perfect passive)", () => {
    const r = detectPassiveVoice("The document has been reviewed by management.");
    expect(r.passiveCount).toBe(1);
  });
});

// ── 4. Irregular past participles ─────────────────────────────────────────────

describe("detectPassiveVoice — irregular past participles", () => {
  it("'is known' is detected", () => {
    const r = detectPassiveVoice("The company is known for its innovation.");
    expect(r.passiveCount).toBe(1);
  });

  it("'was found' is detected", () => {
    const r = detectPassiveVoice("A critical bug was found in production.");
    expect(r.passiveCount).toBe(1);
  });

  it("'were built' is detected", () => {
    const r = detectPassiveVoice("These tools were built for scale.");
    expect(r.passiveCount).toBe(1);
  });

  it("'been written' is detected", () => {
    const r = detectPassiveVoice("The spec has been written by the lead.");
    expect(r.passiveCount).toBe(1);
  });

  it("'was given' is detected", () => {
    const r = detectPassiveVoice("Extra time was given to the students.");
    expect(r.passiveCount).toBe(1);
  });

  it("'were shown' is detected", () => {
    const r = detectPassiveVoice("The results were shown to the committee.");
    expect(r.passiveCount).toBe(1);
  });

  it("'was taken' is detected", () => {
    const r = detectPassiveVoice("The data was taken from the server.");
    expect(r.passiveCount).toBe(1);
  });

  it("'was written' is detected", () => {
    const r = detectPassiveVoice("This article was written by a senior editor.");
    expect(r.passiveCount).toBe(1);
  });
});

// ── 5. passiveCount accuracy ──────────────────────────────────────────────────

describe("detectPassiveVoice — passiveCount accuracy", () => {
  it("sentence with multiple passive matches counted once", () => {
    const r = detectPassiveVoice("It was written and was given to the team.");
    expect(r.passiveCount).toBe(1);
    expect(r.totalSentences).toBe(1);
  });

  it("5 passive sentences → passiveCount 5", () => {
    const body = [
      "The report was written by the analyst.",
      "The bug was found in the codebase.",
      "The feature was given to the user.",
      "The data was taken from the server.",
      "The results were shown to the team.",
    ].join(" ");
    const r = detectPassiveVoice(body);
    expect(r.passiveCount).toBe(5);
  });

  it("3 active + 2 passive → passiveCount 2", () => {
    const body = [
      "She writes the report.",
      "The team ships features.",
      "James leads the project.",
      "The bug was found in production.",
      "The feature was given to the user.",
    ].join(" ");
    const r = detectPassiveVoice(body);
    expect(r.passiveCount).toBe(2);
  });
});

// ── 6. totalSentences accuracy ────────────────────────────────────────────────

describe("detectPassiveVoice — totalSentences accuracy", () => {
  it("3-sentence body → totalSentences 3", () => {
    const r = detectPassiveVoice("She writes. He codes. They ship.");
    expect(r.totalSentences).toBe(3);
  });

  it("5-sentence body → totalSentences 5", () => {
    const body = "One. Two. Three. Four. Five.";
    const r = detectPassiveVoice(body);
    expect(r.totalSentences).toBe(5);
  });

  it("single sentence → totalSentences 1", () => {
    const r = detectPassiveVoice("The report was written by the analyst.");
    expect(r.totalSentences).toBe(1);
  });
});

// ── 7. ratio accuracy ─────────────────────────────────────────────────────────

describe("detectPassiveVoice — ratio calculation", () => {
  it("2 passive of 5 sentences → ratio ≈ 0.4", () => {
    const body = [
      "The report was written by the team.",
      "She ships code every day.",
      "The bug was found in production.",
      "James leads the initiative.",
      "We deliver results fast.",
    ].join(" ");
    const r = detectPassiveVoice(body);
    expect(r.passiveCount).toBe(2);
    expect(r.totalSentences).toBe(5);
    expect(r.ratio).toBeCloseTo(0.4, 5);
  });

  it("1 passive of 7 sentences → ratio ≈ 0.143 → MODERATE", () => {
    const sentences = [
      "She writes the report every Monday.",
      "The team ships features quickly.",
      "James leads the project with focus.",
      "Our clients trust us to deliver.",
      "We build tools that work.",
      "Active voice makes copy clearer.",
      "The document was written by the team.",
    ];
    const r = detectPassiveVoice(sentences.join(" "));
    expect(r.totalSentences).toBe(7);
    expect(r.passiveCount).toBe(1);
    expect(r.ratio).toBeCloseTo(1 / 7, 4);
    expect(r.verdict).toBe("MODERATE");
  });
});

// ── 8. Verdict thresholds ─────────────────────────────────────────────────────

describe("detectPassiveVoice — verdict thresholds", () => {
  it("0% passive → verdict LOW", () => {
    const r = detectPassiveVoice("She writes fast. He ships code. We deliver value.");
    expect(r.verdict).toBe("LOW");
  });

  it("exactly 10% passive (1 of 10) → MODERATE", () => {
    const sentences = [
      "She writes the report every Monday.",
      "The team ships features quickly.",
      "James leads the project well.",
      "Our clients trust us deeply.",
      "We build great tools here.",
      "Active voice makes copy strong.",
      "Direct writing connects with readers.",
      "Action verbs drive engagement fast.",
      "Clear language wins every time.",
      "The document was written by the team.",
    ];
    const r = detectPassiveVoice(sentences.join(" "));
    expect(r.passiveCount).toBe(1);
    expect(r.totalSentences).toBe(10);
    expect(r.ratio).toBeCloseTo(0.1, 5);
    expect(r.verdict).toBe("MODERATE");
  });

  it("exactly 20% passive (2 of 10) → HIGH", () => {
    const sentences = [
      "She writes the report.",
      "The team ships fast.",
      "James leads well.",
      "We deliver great work.",
      "Clear writing wins.",
      "Strong verbs work best.",
      "Action drives results.",
      "Direct voice helps always.",
      "The report was written by the team.",
      "The bug was found in production.",
    ];
    const r = detectPassiveVoice(sentences.join(" "));
    expect(r.passiveCount).toBe(2);
    expect(r.totalSentences).toBe(10);
    expect(r.ratio).toBeCloseTo(0.2, 5);
    expect(r.verdict).toBe("HIGH");
  });

  it("mostly passive (>25%) → HIGH", () => {
    const body = [
      "The report was written by the team.",
      "The bug was found by the tester.",
      "The feature was given to the user.",
      "She ships code fast.",
    ].join(" ");
    const r = detectPassiveVoice(body);
    expect(r.verdict).toBe("HIGH");
    expect(r.passiveCount).toBe(3);
  });

  it("9% passive (9 of 100) → LOW (just below MODERATE threshold)", () => {
    const active = Array.from({ length: 91 }, (_, i) => `She ships feature ${i + 1}.`);
    const passive = Array.from({ length: 9 }, (_, i) => `Result ${i + 1} was shown to the team.`);
    const r = detectPassiveVoice([...active, ...passive].join(" "));
    expect(r.passiveCount).toBe(9);
    expect(r.totalSentences).toBe(100);
    expect(r.verdict).toBe("LOW");
  });
});

// ── 9. tip ────────────────────────────────────────────────────────────────────

describe("detectPassiveVoice — tip field", () => {
  it("verdict LOW → tip is null", () => {
    const r = detectPassiveVoice("She writes fast. He ships code. We deliver value.");
    expect(r.tip).toBeNull();
  });

  it("verdict MODERATE → tip is a non-null string", () => {
    const sentences = [
      "She writes the report every Monday.",
      "The team ships features quickly.",
      "James leads the project with focus.",
      "Our clients trust us to deliver.",
      "We build tools that work.",
      "Active voice makes copy clearer.",
      "The document was written by the team.",
    ];
    const r = detectPassiveVoice(sentences.join(" "));
    expect(r.verdict).toBe("MODERATE");
    expect(r.tip).not.toBeNull();
    expect(typeof r.tip).toBe("string");
  });

  it("verdict HIGH → tip is a non-null string", () => {
    const body = [
      "The report was written by the team.",
      "The bug was found by the tester.",
      "The feature was given to the user.",
    ].join(" ");
    const r = detectPassiveVoice(body);
    expect(r.verdict).toBe("HIGH");
    expect(r.tip).not.toBeNull();
  });
});

// ── 10. examples (passiveSamples) ────────────────────────────────────────────

describe("detectPassiveVoice — examples", () => {
  it("examples capped at 3 even when more passive sentences exist", () => {
    const body = [
      "The report was written by the analyst.",
      "The bug was found in the codebase.",
      "The feature was given to the user.",
      "The data was taken from the server.",
      "The results were shown to the team.",
    ].join(" ");
    const r = detectPassiveVoice(body);
    expect(r.examples).toHaveLength(3);
  });

  it("examples truncated at 80 chars with '…' when sentence is longer", () => {
    const longSentence =
      "The comprehensive quarterly financial report was written by the senior analyst team at headquarters.";
    expect(longSentence.length).toBeGreaterThan(80);
    const r = detectPassiveVoice(longSentence);
    expect(r.examples).toHaveLength(1);
    expect(r.examples[0].endsWith("…")).toBe(true);
    expect(r.examples[0].slice(0, -1).length).toBe(80);
  });

  it("examples are empty when no passive constructions found", () => {
    const r = detectPassiveVoice("She writes fast. He ships code. We deliver.");
    expect(r.examples).toEqual([]);
  });

  it("examples include first 3 passive sentences in order", () => {
    const sentences = [
      "The report was written by the team.",
      "The bug was found in the codebase.",
      "The feature was given to the user.",
      "The data was taken from the archive.",
    ];
    const r = detectPassiveVoice(sentences.join(" "));
    // First 3 should come from the first 3 passive sentences
    expect(r.examples.length).toBe(3);
    expect(r.examples[0]).toContain("was written");
    expect(r.examples[1]).toContain("was found");
    expect(r.examples[2]).toContain("was given");
  });
});

// ── 11. Scale / stress ────────────────────────────────────────────────────────

describe("detectPassiveVoice — scale", () => {
  it("100-sentence body with 20 passive sentences → HIGH, ratio 0.2", () => {
    const active = Array.from({ length: 80 }, (_, i) => `She writes section ${i + 1}.`);
    const passive = Array.from({ length: 20 }, (_, i) => `Report ${i + 1} was written by the analyst.`);
    const r = detectPassiveVoice([...active, ...passive].join(" "));
    expect(r.verdict).toBe("HIGH");
    expect(r.passiveCount).toBe(20);
    expect(r.totalSentences).toBe(100);
    expect(r.ratio).toBeCloseTo(0.2, 5);
  });

  it("100-sentence all-active body → LOW, passiveCount 0", () => {
    const sentences = Array.from({ length: 100 }, (_, i) => `She ships feature ${i + 1} today.`);
    const r = detectPassiveVoice(sentences.join(" "));
    expect(r.verdict).toBe("LOW");
    expect(r.passiveCount).toBe(0);
  });

  it("examples capped at 3 for 100-passive-sentence body", () => {
    const sentences = Array.from({ length: 100 }, (_, i) => `File ${i + 1} was taken from the archive.`);
    const r = detectPassiveVoice(sentences.join(" "));
    expect(r.examples.length).toBeLessThanOrEqual(3);
  });
});
