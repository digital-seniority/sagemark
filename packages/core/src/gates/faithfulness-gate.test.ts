/**
 * Tests for the cross-model faithfulness gate.
 *
 * Covers:
 *   - No sources → skipped=true, skipReason='no-sources', verdict=PARTIAL
 *   - All claims sourced → FAITHFUL, sourcedPercent=100
 *   - Mix of sourced/unsourced → PARTIAL with correct percentages
 *   - Any contradicted → UNFAITHFUL regardless of percent
 *   - LLM throws → skipped=true, skipReason='gate-error' (soft failure)
 *   - LLM returns non-JSON → skipped=true, skipReason='gate-error'
 *   - LLM returns 500 → skipped=true, skipReason='gate-error'
 *   - Claim verdict enum: each type tested
 *   - No factual claims → FAITHFUL, sourcedPercent=100
 *   - Missing OPENROUTER_API_KEY → skipped=true, skipReason='gate-error'
 *   - sourceUrl validation: hallucinated URLs stripped from claims
 *   - Bug 2: GATE_TIMEOUT_MS reduced to 12s (prompt cap for Bug 3 tested implicitly)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { runFaithfulnessGate, FAITHFULNESS_WARNING_THRESHOLD } from "./faithfulness-gate";

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn() as Mock;
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

type ClaimInput = {
  claim: string;
  verdict: "SOURCED" | "UNSOURCED" | "CONTRADICTED";
  sourceUrl?: string;
  notes?: string;
};

function buildLLMResponse(claims: ClaimInput[]): Response {
  const body = JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({ claims }),
        },
      },
    ],
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function buildErrorResponse(status: number): Response {
  return new Response("upstream error", { status });
}

const SAMPLE_SOURCES = [
  {
    url: "https://example.com/article",
    title: "Example Article",
    snippet: "SaaS companies saw 70% growth in Q1 2024.",
  },
];

const SAMPLE_DRAFT = {
  body: "SaaS companies saw 70% growth in Q1 2024. Also, 90% of users reported satisfaction.",
};

function reset() {
  mockFetch.mockReset();
  process.env.OPENROUTER_API_KEY = "fake-key";
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runFaithfulnessGate", () => {
  beforeEach(() => reset());

  // ── Bug 4: skipReason 'no-sources' ─────────────────────────────────────────

  it("returns skipped=true with skipReason='no-sources' when no sources provided", async () => {
    const result = await runFaithfulnessGate(SAMPLE_DRAFT, { sources: [] });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no-sources");
    expect(result.verdict).toBe("PARTIAL");
    expect(result.totalClaims).toBe(0);
    expect(result.sourcedPercent).toBe(0);
    // LLM must NOT be called when sources are empty
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Bug 4: skipReason 'gate-error' ─────────────────────────────────────────

  it("returns skipReason='gate-error' when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate-error");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns skipReason='gate-error' when LLM call throws (network error)", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate-error");
    expect(result.verdict).toBe("PARTIAL");
  });

  it("returns skipReason='gate-error' when LLM returns non-200", async () => {
    mockFetch.mockResolvedValue(buildErrorResponse(500));

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate-error");
    expect(result.verdict).toBe("PARTIAL");
  });

  it("returns skipReason='gate-error' when LLM returns malformed JSON", async () => {
    const body = JSON.stringify({
      choices: [{ message: { content: "not valid json at all {{{" } }],
    });
    mockFetch.mockResolvedValue(
      new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate-error");
  });

  it("returns skipReason='gate-error' when LLM response missing choices", async () => {
    const body = JSON.stringify({ error: "model overloaded" });
    mockFetch.mockResolvedValue(
      new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate-error");
  });

  // ── Successful gate runs ───────────────────────────────────────────────────

  it("returns FAITHFUL when all claims are sourced", async () => {
    mockFetch.mockResolvedValue(
      buildLLMResponse([
        {
          claim: "SaaS companies saw 70% growth",
          verdict: "SOURCED",
          sourceUrl: "https://example.com/article",
        },
        {
          claim: "Q1 2024 was a strong quarter",
          verdict: "SOURCED",
          sourceUrl: "https://example.com/article",
        },
      ]),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(false);
    expect(result.skipReason).toBeUndefined();
    expect(result.verdict).toBe("FAITHFUL");
    expect(result.sourcedPercent).toBe(100);
    expect(result.sourcedCount).toBe(2);
    expect(result.unsourcedCount).toBe(0);
    expect(result.contradictedCount).toBe(0);
    expect(result.totalClaims).toBe(2);
  });

  it("returns UNFAITHFUL when sourced < 50% (1/3 = 33%) and no contradicted", async () => {
    mockFetch.mockResolvedValue(
      buildLLMResponse([
        {
          claim: "70% growth in Q1 2024",
          verdict: "SOURCED",
          sourceUrl: "https://example.com/article",
        },
        {
          claim: "90% user satisfaction",
          verdict: "UNSOURCED",
        },
        {
          claim: "Market leader since 2020",
          verdict: "UNSOURCED",
        },
      ]),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    // 1/3 ≈ 33% → UNFAITHFUL (<50%)
    expect(result.skipped).toBe(false);
    expect(result.verdict).toBe("UNFAITHFUL");
    expect(result.sourcedPercent).toBe(33);
    expect(result.sourcedCount).toBe(1);
    expect(result.unsourcedCount).toBe(2);
    expect(result.contradictedCount).toBe(0);
    expect(result.totalClaims).toBe(3);
  });

  it("returns PARTIAL when sourced 60% and no contradicted", async () => {
    mockFetch.mockResolvedValue(
      buildLLMResponse([
        {
          claim: "70% growth in Q1 2024",
          verdict: "SOURCED",
          sourceUrl: "https://example.com/article",
        },
        {
          claim: "Products launched in Q2",
          verdict: "SOURCED",
          sourceUrl: "https://example.com/article",
        },
        {
          claim: "Market leader since 2010",
          verdict: "SOURCED",
          sourceUrl: "https://example.com/article",
        },
        {
          claim: "90% user satisfaction",
          verdict: "UNSOURCED",
        },
        {
          claim: "Revenue doubled in 2023",
          verdict: "UNSOURCED",
        },
      ]),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(false);
    expect(result.verdict).toBe("PARTIAL");
    expect(result.sourcedPercent).toBe(60); // 3/5 = 60% → PARTIAL (50-79%)
    expect(result.sourcedCount).toBe(3);
    expect(result.unsourcedCount).toBe(2);
    expect(result.contradictedCount).toBe(0);
    expect(result.totalClaims).toBe(5);
  });

  it("returns UNFAITHFUL when any claim is CONTRADICTED", async () => {
    mockFetch.mockResolvedValue(
      buildLLMResponse([
        {
          claim: "70% growth in Q1 2024",
          verdict: "SOURCED",
          sourceUrl: "https://example.com/article",
        },
        {
          claim: "90% growth was recorded",
          verdict: "CONTRADICTED",
          notes: "Source says 70%, not 90%",
        },
      ]),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(false);
    expect(result.verdict).toBe("UNFAITHFUL");
    expect(result.contradictedCount).toBe(1);
    // Even though sourcedPercent is 50%, any CONTRADICTED → UNFAITHFUL
    expect(result.claims).toHaveLength(2);
  });

  it("returns UNFAITHFUL when sourcedPercent < 50%", async () => {
    mockFetch.mockResolvedValue(
      buildLLMResponse([
        {
          claim: "70% growth",
          verdict: "SOURCED",
          sourceUrl: "https://example.com/article",
        },
        {
          claim: "90% satisfaction",
          verdict: "UNSOURCED",
        },
        {
          claim: "Doubled revenue",
          verdict: "UNSOURCED",
        },
        {
          claim: "Market leader",
          verdict: "UNSOURCED",
        },
      ]),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(false);
    expect(result.verdict).toBe("UNFAITHFUL");
    expect(result.sourcedPercent).toBe(25); // 1/4 = 25%
    expect(result.sourcedCount).toBe(1);
    expect(result.unsourcedCount).toBe(3);
  });

  it("returns FAITHFUL when no factual claims identified (empty array)", async () => {
    mockFetch.mockResolvedValue(buildLLMResponse([]));

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(false);
    expect(result.verdict).toBe("FAITHFUL");
    expect(result.sourcedPercent).toBe(100);
    expect(result.totalClaims).toBe(0);
  });

  it("attaches sourceUrl to SOURCED claims", async () => {
    const sourceUrl = "https://example.com/article";
    mockFetch.mockResolvedValue(
      buildLLMResponse([
        { claim: "70% growth", verdict: "SOURCED", sourceUrl },
      ]),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.claims[0].sourceUrl).toBe(sourceUrl);
    expect(result.claims[0].verdict).toBe("SOURCED");
  });

  it("attaches notes to CONTRADICTED claims", async () => {
    const notes = "Source says 70%, not 90%";
    mockFetch.mockResolvedValue(
      buildLLMResponse([
        {
          claim: "90% growth was recorded",
          verdict: "CONTRADICTED",
          notes,
        },
      ]),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.claims[0].verdict).toBe("CONTRADICTED");
    expect(result.claims[0].notes).toBe(notes);
  });

  it("drops malformed claim entries from LLM output gracefully", async () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              claims: [
                { claim: "valid claim", verdict: "SOURCED", sourceUrl: "https://example.com/article" },
                { claim: "bad verdict", verdict: "INVALID_VERDICT" },
                null,
                42,
                { verdict: "SOURCED" }, // missing claim field
              ],
            }),
          },
        },
      ],
    });
    mockFetch.mockResolvedValue(
      new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    // Only the valid claim survives
    expect(result.skipped).toBe(false);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].claim).toBe("valid claim");
  });

  it("FAITHFULNESS_WARNING_THRESHOLD is exported and equals 70", () => {
    expect(FAITHFULNESS_WARNING_THRESHOLD).toBe(70);
  });

  it("uses a different model from the draft model", async () => {
    let capturedModel: string | undefined;
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      try {
        const body = JSON.parse(init?.body as string) as { model?: string };
        capturedModel = body.model;
      } catch {
        // ignore
      }
      return Promise.resolve(buildLLMResponse([]));
    });

    await runFaithfulnessGate(SAMPLE_DRAFT, { sources: SAMPLE_SOURCES });

    // Gate model must NOT be the draft model
    expect(capturedModel).toBeDefined();
    expect(capturedModel).not.toBe("anthropic/claude-sonnet-4.5");
    // And it must be the haiku model
    expect(capturedModel).toBe("anthropic/claude-haiku-4-5");
  });

  // ── Minor fix: sourceUrl validation ─────────────────────────────────────────

  it("strips sourceUrl that is not in brief.sources (hallucination guard)", async () => {
    // LLM returns a sourceUrl that is NOT in SAMPLE_SOURCES
    mockFetch.mockResolvedValue(
      buildLLMResponse([
        {
          claim: "70% growth in Q1 2024",
          verdict: "SOURCED",
          sourceUrl: "https://hallucinated.example.com/made-up",
        },
      ]),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    // sourceUrl should be stripped because it is not in brief.sources
    expect(result.skipped).toBe(false);
    expect(result.claims[0].sourceUrl).toBeUndefined();
  });

  it("keeps sourceUrl that is present in brief.sources", async () => {
    // LLM returns a sourceUrl that IS in SAMPLE_SOURCES
    mockFetch.mockResolvedValue(
      buildLLMResponse([
        {
          claim: "70% growth in Q1 2024",
          verdict: "SOURCED",
          sourceUrl: "https://example.com/article",
        },
      ]),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    // sourceUrl should be preserved
    expect(result.skipped).toBe(false);
    expect(result.claims[0].sourceUrl).toBe("https://example.com/article");
  });
});
