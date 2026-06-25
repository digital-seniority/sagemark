import { describe, it, expect } from "vitest";
import { extractFaqSchema } from "./faq-schema-generator";

// ── Empty draft ───────────────────────────────────────────────────────────────

describe("extractFaqSchema — empty draft", () => {
  it("returns isEmpty true for empty string", () => {
    const result = extractFaqSchema("");
    expect(result.isEmpty).toBe(true);
    expect(result.pairs).toHaveLength(0);
    expect(result.truncatedCount).toBe(0);
  });

  it("returns isEmpty true for whitespace-only draft", () => {
    const result = extractFaqSchema("   \n\n  ");
    expect(result.isEmpty).toBe(true);
  });

  it("returns isEmpty true for draft with no question patterns", () => {
    const result = extractFaqSchema(
      "This is a plain paragraph. No questions here. Just regular content about marketing.",
    );
    expect(result.isEmpty).toBe(true);
  });
});

// ── Q: format ─────────────────────────────────────────────────────────────────

describe("extractFaqSchema — Q: format", () => {
  it("extracts a Q: / answer pair", () => {
    const draft = `
Q: What is content marketing?
Content marketing is a strategy for attracting and retaining audiences.
`;
    const result = extractFaqSchema(draft);
    expect(result.isEmpty).toBe(false);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].question).toBe("What is content marketing?");
    expect(result.pairs[0].answer).toContain("Content marketing");
  });

  it("extracts multiple Q: pairs", () => {
    const draft = `
Q: What is SEO?
SEO stands for Search Engine Optimisation and helps pages rank higher.

Q: Why is keyword research important?
Keyword research identifies what your audience searches for online.
`;
    const result = extractFaqSchema(draft);
    expect(result.pairs.length).toBeGreaterThanOrEqual(2);
    const questions = result.pairs.map((p) => p.question);
    expect(questions).toContain("What is SEO?");
    expect(questions).toContain("Why is keyword research important?");
  });

  it("strips A: prefix from answer if present", () => {
    const draft = `
Q: What is content marketing?
A: Content marketing is a strategy for creating valuable content to attract audiences.
`;
    const result = extractFaqSchema(draft);
    expect(result.pairs[0].answer).not.toMatch(/^A[:.]/);
  });

  it("also works with Q. format", () => {
    const draft = `
Q. How does link building work?
Link building involves getting other websites to link to your content.
`;
    const result = extractFaqSchema(draft);
    expect(result.isEmpty).toBe(false);
    expect(result.pairs[0].question).toBe("How does link building work?");
  });
});

// ── Sentence "?" format ───────────────────────────────────────────────────────

describe("extractFaqSchema — question sentences ending in '?'", () => {
  it("extracts a sentence ending in '?' that is 30-120 chars", () => {
    const draft = `
This article covers content marketing basics.

What are the best ways to grow your blog traffic? Growing blog traffic requires consistent publishing and keyword targeting.
`;
    const result = extractFaqSchema(draft);
    expect(result.isEmpty).toBe(false);
    const questions = result.pairs.map((p) => p.question);
    expect(questions.some((q) => q.includes("grow your blog traffic"))).toBe(true);
  });

  it("ignores question sentences shorter than 30 chars", () => {
    const draft = `
Is it good? Yes it is good for you and your business.
`;
    // "Is it good?" is only 12 chars — should not be extracted
    const result = extractFaqSchema(draft);
    const questions = result.pairs.map((p) => p.question);
    expect(questions.some((q) => q === "Is it good?")).toBe(false);
  });

  it("ignores question sentences longer than 120 chars", () => {
    const draft = `
Can you really expect to grow your organic search traffic significantly and sustainably without doing any keyword research whatsoever at all? Probably not.
`;
    // That question is >120 chars — should not be extracted
    const result = extractFaqSchema(draft);
    const questions = result.pairs.map((p) => p.question);
    expect(questions.every((q) => q.length <= 120)).toBe(true);
  });
});

// ── Heading detection ─────────────────────────────────────────────────────────

describe("extractFaqSchema — ## headings with question starters", () => {
  it("extracts ## heading starting with 'How '", () => {
    const draft = `
## How to write a blog post

Writing a great blog post starts with understanding your audience and their needs.
`;
    const result = extractFaqSchema(draft);
    expect(result.isEmpty).toBe(false);
    const questions = result.pairs.map((p) => p.question);
    expect(questions.some((q) => q.startsWith("How to write"))).toBe(true);
  });

  it("extracts ### heading starting with 'What '", () => {
    const draft = `
### What is keyword density

Keyword density refers to how often your target keyword appears in your content relative to total word count.
`;
    const result = extractFaqSchema(draft);
    expect(result.isEmpty).toBe(false);
    const questions = result.pairs.map((p) => p.question);
    expect(questions.some((q) => q.startsWith("What is keyword density"))).toBe(true);
  });

  it("appends '?' to heading question if missing", () => {
    const draft = `
## Why content marketing matters

Content marketing matters because it builds trust and drives organic traffic over time.
`;
    const result = extractFaqSchema(draft);
    const questions = result.pairs.map((p) => p.question);
    expect(questions.some((q) => q.endsWith("?"))).toBe(true);
  });

  it("extracts ## heading ending in '?'", () => {
    const draft = `
## Should you publish daily?

Publishing daily can work if you have the resources, but quality matters more than frequency.
`;
    const result = extractFaqSchema(draft);
    const questions = result.pairs.map((p) => p.question);
    expect(questions.some((q) => q.includes("Should you publish daily"))).toBe(true);
  });
});

// ── Answer extraction ─────────────────────────────────────────────────────────

describe("extractFaqSchema — answer extraction", () => {
  it("takes the next sentence as the answer", () => {
    const draft = `
## How does SEO work?

Search engines crawl and index your content, then rank pages based on relevance and authority signals.
`;
    const result = extractFaqSchema(draft);
    expect(result.pairs[0].answer).toContain("Search engines");
  });

  it("skips question when no answer is found within range", () => {
    // Heading followed immediately by another heading — no body text
    const draft = `
## How does SEO work?

## Another Heading

Some content here that is unrelated.
`;
    const result = extractFaqSchema(draft);
    // The first heading's "answer" search hits another heading — should skip it
    // (second heading is not a question starter so won't be picked up either)
    expect(result.isEmpty).toBe(true);
  });

  it("truncates answer at 200 chars with '...'", () => {
    const longAnswer =
      "This is the answer to your question. ".repeat(8); // well over 200 chars
    const draft = `
Q: What is content marketing?
${longAnswer}
`;
    const result = extractFaqSchema(draft);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].answer.length).toBeLessThanOrEqual(203); // 200 + "..."
    expect(result.pairs[0].answer.endsWith("...")).toBe(true);
  });
});

// ── Cap at 10 pairs ───────────────────────────────────────────────────────────

describe("extractFaqSchema — 10-pair cap", () => {
  function buildDraftWithNPairs(n: number): string {
    return Array.from(
      { length: n },
      (_, i) =>
        `Q: What is step number ${i + 1} of the process?\nStep ${i + 1} involves doing the specific action described here carefully.\n`,
    ).join("\n");
  }

  it("returns exactly 10 pairs when 12 are found", () => {
    const draft = buildDraftWithNPairs(12);
    const result = extractFaqSchema(draft);
    expect(result.pairs).toHaveLength(10);
  });

  it("sets truncatedCount to 2 when 12 pairs are found", () => {
    const draft = buildDraftWithNPairs(12);
    const result = extractFaqSchema(draft);
    expect(result.truncatedCount).toBe(2);
  });

  it("returns all 10 pairs when exactly 10 are found", () => {
    const draft = buildDraftWithNPairs(10);
    const result = extractFaqSchema(draft);
    expect(result.pairs).toHaveLength(10);
    expect(result.truncatedCount).toBe(0);
  });

  it("truncatedCount is 0 when ≤10 pairs are found", () => {
    const draft = buildDraftWithNPairs(5);
    const result = extractFaqSchema(draft);
    expect(result.truncatedCount).toBe(0);
    expect(result.pairs.length).toBeLessThanOrEqual(10);
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe("extractFaqSchema — deduplication", () => {
  it("keeps only first occurrence when same question appears twice", () => {
    const draft = `
Q: What is content marketing?
Content marketing is a strategy for attracting audiences.

Q: What is content marketing?
This is a duplicate question with a different answer.
`;
    const result = extractFaqSchema(draft);
    const matched = result.pairs.filter(
      (p) => p.question.toLowerCase() === "what is content marketing?",
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].answer).toContain("Content marketing is a strategy");
  });

  it("deduplication is case-insensitive", () => {
    const draft = `
Q: What is content marketing?
Content marketing is a strategy for creating valuable content.

Q: WHAT IS CONTENT MARKETING?
Another answer here for the same question.
`;
    const result = extractFaqSchema(draft);
    const matched = result.pairs.filter(
      (p) => p.question.toLowerCase() === "what is content marketing?",
    );
    expect(matched).toHaveLength(1);
  });
});

// ── Source field ──────────────────────────────────────────────────────────────

describe("extractFaqSchema — source field", () => {
  it("marks Q:/Q. format pairs as source 'explicit'", () => {
    const draft = `
Q: What is content marketing?
Content marketing is a strategy for attracting and retaining audiences.
`;
    const result = extractFaqSchema(draft);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].source).toBe("explicit");
  });

  it("marks heading-based pairs as source 'inferred'", () => {
    const draft = `
## How to write a blog post

Writing a great blog post starts with understanding your audience and their needs.
`;
    const result = extractFaqSchema(draft);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].source).toBe("inferred");
  });

  it("marks question-sentence pairs as source 'inferred'", () => {
    const draft = `
What are the best ways to grow your blog traffic? Growing blog traffic requires consistent publishing and keyword targeting.
`;
    const result = extractFaqSchema(draft);
    expect(result.isEmpty).toBe(false);
    const inferred = result.pairs.filter((p) => p.source === "inferred");
    expect(inferred.length).toBeGreaterThan(0);
  });

  it("returns both explicit and inferred pairs in mixed draft", () => {
    const draft = `
Q: What is SEO?
SEO stands for Search Engine Optimisation and helps pages rank higher.

## How does content marketing work?

Content marketing works by creating valuable content that attracts and retains audiences.
`;
    const result = extractFaqSchema(draft);
    const sources = result.pairs.map((p) => p.source);
    expect(sources).toContain("explicit");
    expect(sources).toContain("inferred");
  });

  it("Q. format (dot) also produces source 'explicit'", () => {
    const draft = `
Q. How does link building work?
Link building involves getting other websites to link to your content.
`;
    const result = extractFaqSchema(draft);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].source).toBe("explicit");
  });
});

// ── JSON-LD output ────────────────────────────────────────────────────────────

describe("extractFaqSchema — jsonLd output", () => {
  const draft = `
Q: What is content marketing?
Content marketing is a strategy for attracting and retaining audiences through valuable content.
`;

  it("jsonLd contains @context https://schema.org", () => {
    const result = extractFaqSchema(draft);
    expect(result.jsonLd).toContain('"@context": "https://schema.org"');
  });

  it("jsonLd contains @type FAQPage", () => {
    const result = extractFaqSchema(draft);
    expect(result.jsonLd).toContain('"@type": "FAQPage"');
  });

  it("jsonLd contains @type Question", () => {
    const result = extractFaqSchema(draft);
    expect(result.jsonLd).toContain('"@type": "Question"');
  });

  it("jsonLd contains @type Answer", () => {
    const result = extractFaqSchema(draft);
    expect(result.jsonLd).toContain('"@type": "Answer"');
  });

  it("jsonLd is wrapped in a <script type='application/ld+json'> tag", () => {
    const result = extractFaqSchema(draft);
    expect(result.jsonLd).toMatch(/^<script type="application\/ld\+json">/);
    expect(result.jsonLd).toMatch(/<\/script>$/);
  });

  it("jsonLd for empty result still has valid schema structure", () => {
    const result = extractFaqSchema("");
    expect(result.jsonLd).toContain('"@context": "https://schema.org"');
    expect(result.jsonLd).toContain('"@type": "FAQPage"');
  });
});
