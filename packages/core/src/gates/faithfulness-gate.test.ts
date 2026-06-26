/**
 * Tests for the cross-model faithfulness gate.
 *
 * Transport: the gate routes through the metered AI Gateway seam
 * (`resolveGatewayModel` + the AI SDK `generateText` + `Output.object`), NOT a
 * raw OpenRouter `fetch`. These tests mock the AI SDK + the Gateway seam, so:
 *   - `generateText` is the single model boundary we drive (success / throw),
 *   - we assert the verifier resolves through `resolveGatewayModel` with the
 *     CANONICAL verifier id (cross-model isolation), and
 *   - fail-closed soft-skip behaviour is preserved (any error → gate-error).
 *
 * Covers:
 *   - No sources → skipped=true, skipReason='no-sources', verdict=PARTIAL
 *   - All claims sourced → FAITHFUL, sourcedPercent=100
 *   - Mix of sourced/unsourced → PARTIAL with correct percentages
 *   - Any contradicted → UNFAITHFUL regardless of percent
 *   - Model call throws → skipped=true, skipReason='gate-error' (soft failure)
 *   - Claim verdict enum: each type tested
 *   - No factual claims → FAITHFUL, sourcedPercent=100
 *   - sourceUrl validation: hallucinated URLs stripped from claims
 *   - Routes through the Gateway seam with the canonical verifier id (NOT the drafter)
 *
 * @vitest-environment node
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";

// ── AI SDK + Gateway-seam mocks ───────────────────────────────────────────────
//
// `generateText` is the single model boundary. We return `{ output }` shaped as
// `Output.object` would (the validated object), or throw to simulate a provider
// / validation / timeout failure. `resolveGatewayModel` is mocked to a sentinel
// so we can assert the gate routes through the Gateway seam (and with which id),
// without importing the real `@ai-sdk/*` providers or hitting the network.

const generateTextMock = vi.fn() as Mock;
const resolveGatewayModelMock = vi.fn(async (modelId: string) => ({
  __sentinel: "gateway-model" as const,
  modelId,
}));

vi.mock("ai", () => ({
  generateText: (args: unknown) => generateTextMock(args),
  // `Output.object({ schema })` — we don't need its runtime behaviour here; the
  // gate only passes its return value straight to the mocked `generateText`.
  Output: { object: (spec: unknown) => ({ __output: "object", ...(spec as object) }) },
}));

vi.mock("../ai/resolve-gateway-model", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../ai/resolve-gateway-model")
  >();
  return {
    ...actual,
    resolveGatewayModel: (modelId: string, context?: "host" | "worker") =>
      resolveGatewayModelMock(modelId, context),
  };
});

import {
  runFaithfulnessGate,
  FAITHFULNESS_WARNING_THRESHOLD,
  GATE_MODEL,
} from "./faithfulness-gate";
import { DRAFTER_MODEL_ID, VERIFIER_MODEL_ID } from "../config/models";

// ── Helpers ───────────────────────────────────────────────────────────────────

type ClaimInput = {
  claim: string;
  verdict: "SOURCED" | "UNSOURCED" | "CONTRADICTED";
  sourceUrl?: string;
  notes?: string;
};

/** Shape the gate expects from `generateText` with `Output.object`. */
function mockGateOutput(claims: ClaimInput[]): void {
  generateTextMock.mockResolvedValue({ output: { claims } });
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

const ORIGINAL_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  generateTextMock.mockReset();
  resolveGatewayModelMock.mockClear();
});

afterEach(() => {
  // Restore any env we may have mutated (defensive — the Gateway path no longer
  // reads OPENROUTER_API_KEY, but keep the restore so a stray mutation can't
  // leak across tests).
  if (ORIGINAL_OPENROUTER_KEY === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = ORIGINAL_OPENROUTER_KEY;
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runFaithfulnessGate", () => {
  // ── skipReason 'no-sources' ────────────────────────────────────────────────

  it("returns skipped=true with skipReason='no-sources' when no sources provided", async () => {
    const result = await runFaithfulnessGate(SAMPLE_DRAFT, { sources: [] });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no-sources");
    expect(result.verdict).toBe("PARTIAL");
    expect(result.totalClaims).toBe(0);
    expect(result.sourcedPercent).toBe(0);
    // Model must NOT be called when sources are empty
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(resolveGatewayModelMock).not.toHaveBeenCalled();
  });

  // ── skipReason 'gate-error' (fail-closed) ──────────────────────────────────

  it("returns skipReason='gate-error' when the model call throws (network/provider error)", async () => {
    generateTextMock.mockRejectedValue(new Error("gateway error"));

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate-error");
    expect(result.verdict).toBe("PARTIAL");
  });

  it("returns skipReason='gate-error' when the model output fails validation (throws)", async () => {
    // `Output.object` validation failure surfaces as a thrown error from
    // generateText — the gate must soft-skip.
    generateTextMock.mockRejectedValue(new Error("response did not match schema"));

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate-error");
  });

  it("returns skipReason='gate-error' when resolving the Gateway model throws", async () => {
    resolveGatewayModelMock.mockRejectedValueOnce(
      new Error("no gateway credential"),
    );

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate-error");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  // ── Successful gate runs ───────────────────────────────────────────────────

  it("returns FAITHFUL when all claims are sourced", async () => {
    mockGateOutput([
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
    ]);

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
    mockGateOutput([
      {
        claim: "70% growth in Q1 2024",
        verdict: "SOURCED",
        sourceUrl: "https://example.com/article",
      },
      { claim: "90% user satisfaction", verdict: "UNSOURCED" },
      { claim: "Market leader since 2020", verdict: "UNSOURCED" },
    ]);

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
    mockGateOutput([
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
      { claim: "90% user satisfaction", verdict: "UNSOURCED" },
      { claim: "Revenue doubled in 2023", verdict: "UNSOURCED" },
    ]);

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
    mockGateOutput([
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
    ]);

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
    mockGateOutput([
      {
        claim: "70% growth",
        verdict: "SOURCED",
        sourceUrl: "https://example.com/article",
      },
      { claim: "90% satisfaction", verdict: "UNSOURCED" },
      { claim: "Doubled revenue", verdict: "UNSOURCED" },
      { claim: "Market leader", verdict: "UNSOURCED" },
    ]);

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
    mockGateOutput([]);

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
    mockGateOutput([{ claim: "70% growth", verdict: "SOURCED", sourceUrl }]);

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.claims[0].sourceUrl).toBe(sourceUrl);
    expect(result.claims[0].verdict).toBe("SOURCED");
  });

  it("attaches notes to CONTRADICTED claims", async () => {
    const notes = "Source says 70%, not 90%";
    mockGateOutput([
      { claim: "90% growth was recorded", verdict: "CONTRADICTED", notes },
    ]);

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.claims[0].verdict).toBe("CONTRADICTED");
    expect(result.claims[0].notes).toBe(notes);
  });

  it("drops malformed claim entries from model output gracefully", async () => {
    // Even though Output.object validates, the gate's own coercion is the
    // defence-in-depth layer — feed it deliberately mixed entries.
    generateTextMock.mockResolvedValue({
      output: {
        claims: [
          {
            claim: "valid claim",
            verdict: "SOURCED",
            sourceUrl: "https://example.com/article",
          },
          { claim: "bad verdict", verdict: "INVALID_VERDICT" },
          null,
          42,
          { verdict: "SOURCED" }, // missing claim field
        ],
      },
    });

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

  // ── Cross-model isolation: routes through the Gateway with the canonical id ─

  it("routes the verifier through the Gateway seam with the canonical verifier id (NOT the drafter)", async () => {
    mockGateOutput([]);

    await runFaithfulnessGate(SAMPLE_DRAFT, { sources: SAMPLE_SOURCES });

    // Routed through the metered Gateway seam (host context).
    expect(resolveGatewayModelMock).toHaveBeenCalledTimes(1);
    const [calledModelId, calledContext] = resolveGatewayModelMock.mock.calls[0];
    // The gate's verifier id is the canonical VERIFIER_MODEL_ID …
    expect(calledModelId).toBe(VERIFIER_MODEL_ID);
    expect(calledModelId).toBe(GATE_MODEL);
    expect(calledContext).toBe("host");
    // … and it must NOT be the drafter (cross-model faithfulness invariant).
    expect(calledModelId).not.toBe(DRAFTER_MODEL_ID);
    expect(calledModelId).not.toBe("anthropic/claude-sonnet-4.5");
    expect(calledModelId).toBe("anthropic/claude-haiku-4-5");
  });

  it("passes the resolved Gateway model + canonical token/temperature budget to generateText", async () => {
    mockGateOutput([]);

    await runFaithfulnessGate(SAMPLE_DRAFT, { sources: SAMPLE_SOURCES });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const args = generateTextMock.mock.calls[0][0] as {
      model: { __sentinel?: string; modelId?: string };
      temperature: number;
      maxOutputTokens: number;
      abortSignal?: AbortSignal;
      system: string;
    };
    // The model handed to the AI SDK is the one resolved by the Gateway seam.
    expect(args.model.__sentinel).toBe("gateway-model");
    expect(args.model.modelId).toBe(VERIFIER_MODEL_ID);
    expect(args.temperature).toBe(0.1);
    expect(args.maxOutputTokens).toBe(2_000);
    // Timeout is wired through an abort signal (fail-closed budget).
    expect(args.abortSignal).toBeDefined();
    // The 25-claim cap is present in the system prompt (load-bearing constant).
    expect(args.system).toContain("25");
  });

  // ── sourceUrl validation ────────────────────────────────────────────────────

  it("strips sourceUrl that is not in brief.sources (hallucination guard)", async () => {
    mockGateOutput([
      {
        claim: "70% growth in Q1 2024",
        verdict: "SOURCED",
        sourceUrl: "https://hallucinated.example.com/made-up",
      },
    ]);

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(false);
    expect(result.claims[0].sourceUrl).toBeUndefined();
  });

  it("keeps sourceUrl that is present in brief.sources", async () => {
    mockGateOutput([
      {
        claim: "70% growth in Q1 2024",
        verdict: "SOURCED",
        sourceUrl: "https://example.com/article",
      },
    ]);

    const result = await runFaithfulnessGate(SAMPLE_DRAFT, {
      sources: SAMPLE_SOURCES,
    });

    expect(result.skipped).toBe(false);
    expect(result.claims[0].sourceUrl).toBe("https://example.com/article");
  });
});
