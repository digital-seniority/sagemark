import { describe, it, expect } from "vitest";
import { scoreGeoCitation } from "./geo-citation";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build N self-contained sentences each carrying a distinct number + context. */
function quotableFactBody(n: number): string {
  const sentences: string[] = [];
  for (let i = 0; i < n; i++) {
    // 8+ words, contains a number, no pipe (not a table row).
    sentences.push(
      `The market grew by ${i + 10} percent across the region last year.`,
    );
  }
  return sentences.join(" ");
}

const SLUG = "remote-work-productivity-trends";

describe("scoreGeoCitation — quotable facts", () => {
  it("passes the quotable_facts check with 5 number-bearing sentences", () => {
    const result = scoreGeoCitation(quotableFactBody(5), SLUG);
    const check = result.checks.find((c) => c.name === "quotable_facts");
    expect(check?.passed).toBe(true);
    expect(check?.penalty).toBe(0);
  });

  it("fails the quotable_facts check with fewer than 5", () => {
    const result = scoreGeoCitation(quotableFactBody(3), SLUG);
    const check = result.checks.find((c) => c.name === "quotable_facts");
    expect(check?.passed).toBe(false);
    expect(check?.penalty).toBeLessThan(0);
    expect(result.failures).toContain(check?.detail);
  });
});

describe("scoreGeoCitation — FAQ self-containment", () => {
  it("passes when all FAQs are self-contained", () => {
    const faqData = [
      {
        question: "What is remote work?",
        answer:
          "Remote work is a model where employees perform their duties outside a central office.",
      },
    ];
    const result = scoreGeoCitation("Some body content here.", SLUG, faqData);
    const check = result.checks.find((c) => c.name === "faq_self_contained");
    expect(check?.passed).toBe(true);
    expect(check?.penalty).toBe(0);
  });

  it("fails when a FAQ says 'as mentioned above'", () => {
    const faqData = [
      {
        question: "How much does it save?",
        answer:
          "As mentioned above, the savings depend on the company size and policy.",
      },
    ];
    const result = scoreGeoCitation("Some body content here.", SLUG, faqData);
    const check = result.checks.find((c) => c.name === "faq_self_contained");
    expect(check?.passed).toBe(false);
    expect(check?.penalty).toBe(-5);
    expect(result.failures.some((f) => f.includes("not self-contained"))).toBe(
      true,
    );
  });

  it("passes when faqData is null or omitted", () => {
    const result = scoreGeoCitation("Body.", SLUG, null);
    const check = result.checks.find((c) => c.name === "faq_self_contained");
    expect(check?.passed).toBe(true);
  });
});

describe("scoreGeoCitation — definition patterns", () => {
  it("passes with 2+ definition patterns", () => {
    const body =
      "**Generative engine optimization** is the practice of optimizing content. " +
      "**A citation** refers to a quoted on-page fact used by an AI answer engine.";
    const result = scoreGeoCitation(body, SLUG);
    const check = result.checks.find((c) => c.name === "definition_patterns");
    expect(check?.passed).toBe(true);
  });

  it("fails with no definition patterns", () => {
    const result = scoreGeoCitation("Just some prose without definitions.", SLUG);
    const check = result.checks.find((c) => c.name === "definition_patterns");
    expect(check?.passed).toBe(false);
    expect(check?.penalty).toBe(-10);
  });
});

describe("scoreGeoCitation — direct answers", () => {
  it("passes when paragraphs surface the slug keywords", () => {
    const body =
      "Remote work has reshaped how teams operate across the globe in measurable ways.\n\n" +
      "Productivity gains from remote setups are now well documented in many studies.";
    const result = scoreGeoCitation(body, SLUG);
    const check = result.checks.find((c) => c.name === "direct_answers");
    expect(check?.passed).toBe(true);
  });

  it("fails when no paragraph surfaces the topic", () => {
    const body =
      "The weather today is sunny and the birds are singing in the trees outside.\n\n" +
      "Lunch will be served at noon in the cafeteria near the back entrance.";
    const result = scoreGeoCitation(body, SLUG);
    const check = result.checks.find((c) => c.name === "direct_answers");
    expect(check?.passed).toBe(false);
  });
});

describe("scoreGeoCitation — structured data", () => {
  it("passes when a markdown table is present", () => {
    const body =
      "| Metric | 2023 | 2024 |\n| --- | --- | --- |\n| Adoption | 40% | 58% |";
    const result = scoreGeoCitation(body, SLUG);
    const check = result.checks.find((c) => c.name === "structured_data");
    expect(check?.passed).toBe(true);
  });

  it("fails without a table", () => {
    const result = scoreGeoCitation("No tables in this body at all.", SLUG);
    const check = result.checks.find((c) => c.name === "structured_data");
    expect(check?.passed).toBe(false);
    expect(check?.penalty).toBe(-10);
  });
});

describe("scoreGeoCitation — attributed source (de-branded signal)", () => {
  it("passes when content cites a study or report", () => {
    const body =
      "According to a 2024 survey, hybrid models outperform office-only setups.";
    const result = scoreGeoCitation(body, SLUG);
    const check = result.checks.find((c) => c.name === "attributed_source");
    expect(check?.passed).toBe(true);
  });

  it("fails when content has no attributed source", () => {
    const result = scoreGeoCitation("Plain content with no sourcing.", SLUG);
    const check = result.checks.find((c) => c.name === "attributed_source");
    expect(check?.passed).toBe(false);
    expect(check?.penalty).toBe(-15);
  });
});

describe("scoreGeoCitation — source attribution phrasing", () => {
  it("passes with 'source:' phrasing", () => {
    const body = "Adoption hit 58%. source: industry benchmark dataset.";
    const result = scoreGeoCitation(body, SLUG);
    const check = result.checks.find((c) => c.name === "source_attribution");
    expect(check?.passed).toBe(true);
  });
});

describe("scoreGeoCitation — output contract", () => {
  it("returns score in 0-100 range", () => {
    const empty = scoreGeoCitation("", "x");
    expect(empty.score).toBeGreaterThanOrEqual(0);
    expect(empty.score).toBeLessThanOrEqual(100);

    const rich = scoreGeoCitation(
      quotableFactBody(8) +
        "\n\n**GEO** is optimization. **A fact** is a datum. According to a study, source: data.\n\n" +
        "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |",
      SLUG,
    );
    expect(rich.score).toBeGreaterThanOrEqual(0);
    expect(rich.score).toBeLessThanOrEqual(100);
  });

  it("exposes only countable on-page checks — no citation outcome promised", () => {
    const result = scoreGeoCitation(quotableFactBody(5), SLUG);
    // The result object must NOT expose any citation-outcome field.
    expect(result).not.toHaveProperty("cited");
    expect(result).not.toHaveProperty("willBeCited");
    expect(result).not.toHaveProperty("citationProbability");
    expect(result).not.toHaveProperty("citationOutcome");
    // It exposes exactly: score, checks, failures.
    expect(Object.keys(result).sort()).toEqual(["checks", "failures", "score"]);
    // Every check is a countable on-page signal with a boolean pass + numeric penalty.
    for (const c of result.checks) {
      expect(typeof c.passed).toBe("boolean");
      expect(typeof c.penalty).toBe("number");
      expect(typeof c.name).toBe("string");
    }
  });

  it("is a pure function — same input yields same output", () => {
    const a = scoreGeoCitation(quotableFactBody(6), SLUG);
    const b = scoreGeoCitation(quotableFactBody(6), SLUG);
    expect(a).toEqual(b);
  });
});
