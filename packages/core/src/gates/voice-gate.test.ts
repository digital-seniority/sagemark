/**
 * Tests for the brand voice gate — runContentVoiceGate.
 *
 * Transport: the gate routes through the metered AI Gateway seam
 * (`resolveGatewayModel` + the AI SDK `generateText` + `Output.object`), NOT a
 * raw OpenRouter `fetch`. These tests mock the AI SDK + the Gateway seam, so we
 * drive `generateText` (success / throw) and assert the verifier resolves
 * through `resolveGatewayModel` with the CANONICAL verifier id.
 *
 * Covers:
 *   - No brandMd → skipped=true, skipReason='no_brand_bible'
 *   - Empty / whitespace brandMd → skipped=true, skipReason='no_brand_bible'
 *   - brandMd < 50 chars → skipped=true, skipReason='brand_bible_too_short'
 *   - Model call throws → skipped=true, skipReason='gate_error'
 *   - Article passes → overallStatus=PASS, sections all PASS
 *   - Article has marketing-speak → WARN with section-level issue
 *   - Article contradicts brand rules → FAIL, passed=false
 *   - passed=false only when overallStatus=FAIL
 *   - passed=true for PASS, WARN, and SKIP
 *   - Model routed through the Gateway seam with the canonical verifier id (not the drafter)
 *   - Article body truncated to 6000 chars when longer
 *   - GATE_TIMEOUT_MS wired through an abort signal
 *   - brandMd over 2000 chars gets sliced to 2000 chars in the prompt
 *   - Section label 'intro' normalizes to 'introduction'
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

const generateTextMock = vi.fn() as Mock;
const resolveGatewayModelMock = vi.fn(async (modelId: string) => ({
  __sentinel: "gateway-model" as const,
  modelId,
}));

vi.mock("ai", () => ({
  generateText: (args: unknown) => generateTextMock(args),
  Output: { object: (spec: unknown) => ({ __output: "object", ...(spec as object) }) },
}));

vi.mock("../ai/resolve-gateway-model", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../ai/resolve-gateway-model")
  >();
  return {
    ...actual,
    resolveGatewayModel: (
      modelId: string,
      context?: "host" | "worker",
      opts?: { forceGateway?: boolean },
    ) => resolveGatewayModelMock(modelId, context, opts),
  };
});

import { runContentVoiceGate, GATE_MODEL } from "./voice-gate";
import { DRAFTER_MODEL_ID, VERIFIER_MODEL_ID } from "../config/models";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SectionInput {
  section: string;
  status: "PASS" | "WARN" | "FAIL";
  issue?: string;
  suggestion?: string;
}

/** Shape the gate expects from `generateText` with `Output.object`. */
function mockGateOutput(
  overallStatus: "PASS" | "WARN" | "FAIL",
  sections: SectionInput[],
): void {
  generateTextMock.mockResolvedValue({ output: { overallStatus, sections } });
}

const SAMPLE_DRAFT = {
  title: "10 Content Marketing Strategies for SaaS",
  body: "## Introduction\n\nContent marketing is the best way to grow your SaaS business. We are the market leader.\n\n## Key Strategies\n\nBuild a content calendar and dominate your niche.\n\n## Conclusion\n\nStart your content marketing journey today and unlock massive growth.",
};

const VALID_BRAND_MD =
  "Brand Voice: Clear, direct, evidence-based. Avoid superlatives. No 'market leader' claims unless cited. Do not use 'dominate', 'massive', or 'unlock'. Write for VP-level SaaS buyers.";

const ORIGINAL_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  generateTextMock.mockReset();
  resolveGatewayModelMock.mockClear();
});

afterEach(() => {
  // Restore any env we may have mutated (defensive — the Gateway path no longer
  // reads OPENROUTER_API_KEY).
  if (ORIGINAL_OPENROUTER_KEY === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = ORIGINAL_OPENROUTER_KEY;
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runContentVoiceGate", () => {
  // ── Skip conditions ──────────────────────────────────────────────────────────

  it("skipped=true, skipReason='no_brand_bible' when brandMd is undefined", async () => {
    const result = await runContentVoiceGate(SAMPLE_DRAFT, undefined);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no_brand_bible");
    expect(result.overallStatus).toBe("SKIP");
    expect(result.passed).toBe(true);
    expect(result.sections).toHaveLength(0);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(resolveGatewayModelMock).not.toHaveBeenCalled();
  });

  it("skipped=true, skipReason='no_brand_bible' when brandMd is empty string", async () => {
    const result = await runContentVoiceGate(SAMPLE_DRAFT, "");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no_brand_bible");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("skipped=true, skipReason='no_brand_bible' when brandMd is whitespace only", async () => {
    const result = await runContentVoiceGate(SAMPLE_DRAFT, "   \n  ");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no_brand_bible");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("skipped=true, skipReason='brand_bible_too_short' when brandMd < 50 chars", async () => {
    const result = await runContentVoiceGate(SAMPLE_DRAFT, "Be friendly.");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("brand_bible_too_short");
    expect(result.overallStatus).toBe("SKIP");
    expect(result.passed).toBe(true);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("skipped=true, skipReason='brand_bible_too_short' at exactly 49 chars", async () => {
    const brandMd = "a".repeat(49);
    const result = await runContentVoiceGate(SAMPLE_DRAFT, brandMd);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("brand_bible_too_short");
  });

  it("does NOT skip at exactly 50 chars (calls the model)", async () => {
    const brandMd = "a".repeat(50);
    mockGateOutput("PASS", [
      { section: "introduction", status: "PASS" },
      { section: "body", status: "PASS" },
      { section: "conclusion", status: "PASS" },
    ]);
    const result = await runContentVoiceGate(SAMPLE_DRAFT, brandMd);
    expect(result.skipped).toBe(false);
    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  // ── Fail-closed (gate_error) ────────────────────────────────────────────────

  it("skipped=true, skipReason='gate_error' when the model call throws", async () => {
    generateTextMock.mockRejectedValue(new Error("gateway error"));
    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate_error");
    expect(result.passed).toBe(true);
  });

  it("skipped=true, skipReason='gate_error' when the model output fails validation (throws)", async () => {
    generateTextMock.mockRejectedValue(new Error("response did not match schema"));
    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate_error");
  });

  it("skipped=true, skipReason='gate_error' when resolving the Gateway model throws", async () => {
    resolveGatewayModelMock.mockRejectedValueOnce(
      new Error("no gateway credential"),
    );
    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gate_error");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  // ── PASS result ───────────────────────────────────────────────────────────────

  it("returns PASS when article aligns with brand bible", async () => {
    mockGateOutput("PASS", [
      { section: "introduction", status: "PASS" },
      { section: "body", status: "PASS" },
      { section: "conclusion", status: "PASS" },
      { section: "overall", status: "PASS" },
    ]);

    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    expect(result.skipped).toBe(false);
    expect(result.overallStatus).toBe("PASS");
    expect(result.passed).toBe(true);
    expect(result.sections).toHaveLength(4);
    expect(result.sections.every((s) => s.status === "PASS")).toBe(true);
  });

  // ── WARN result ───────────────────────────────────────────────────────────────

  it("returns WARN with section-level issue when article has marketing-speak", async () => {
    mockGateOutput("WARN", [
      { section: "introduction", status: "PASS" },
      {
        section: "body",
        status: "WARN",
        issue: '"dominate your niche" is borderline aggressive — brand uses collaborative language',
        suggestion: 'Replace "dominate your niche" with "lead in your category"',
      },
      { section: "conclusion", status: "PASS" },
    ]);

    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    expect(result.skipped).toBe(false);
    expect(result.overallStatus).toBe("WARN");
    // WARN is non-blocking
    expect(result.passed).toBe(true);
    const warnSection = result.sections.find((s) => s.status === "WARN");
    expect(warnSection).toBeDefined();
    expect(warnSection!.section).toBe("body");
    expect(warnSection!.issue).toContain("dominate");
    expect(warnSection!.suggestion).toBeDefined();
  });

  // ── FAIL result ───────────────────────────────────────────────────────────────

  it("returns FAIL when article directly contradicts brand rules — passed=false", async () => {
    mockGateOutput("FAIL", [
      {
        section: "introduction",
        status: "FAIL",
        issue: '"market leader" is a prohibited claim — brand forbids uncited competitive claims',
        suggestion: "Remove 'market leader' or cite the source",
      },
      { section: "body", status: "PASS" },
      { section: "conclusion", status: "PASS" },
    ]);

    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    expect(result.skipped).toBe(false);
    expect(result.overallStatus).toBe("FAIL");
    // FAIL blocks passed
    expect(result.passed).toBe(false);
    const failSection = result.sections.find((s) => s.status === "FAIL");
    expect(failSection).toBeDefined();
    expect(failSection!.section).toBe("introduction");
    expect(failSection!.issue).toContain("market leader");
  });

  // ── passed invariant ──────────────────────────────────────────────────────────

  it("passed=true for PASS", async () => {
    mockGateOutput("PASS", [{ section: "overall", status: "PASS" }]);
    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);
    expect(result.passed).toBe(true);
  });

  it("passed=true for WARN (non-blocking)", async () => {
    mockGateOutput("WARN", [
      { section: "body", status: "WARN", issue: "minor tone issue" },
    ]);
    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);
    expect(result.passed).toBe(true);
  });

  it("passed=false ONLY when overallStatus=FAIL", async () => {
    mockGateOutput("FAIL", [
      { section: "introduction", status: "FAIL", issue: "prohibited term used" },
    ]);
    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);
    expect(result.passed).toBe(false);
    expect(result.overallStatus).toBe("FAIL");
  });

  it("passed=true for SKIP", async () => {
    const result = await runContentVoiceGate(SAMPLE_DRAFT, undefined);
    expect(result.passed).toBe(true);
    expect(result.overallStatus).toBe("SKIP");
  });

  // ── Cross-model isolation: routes through the Gateway with the canonical id ─

  it("routes the verifier through the Gateway seam with the canonical verifier id (NOT the drafter)", async () => {
    mockGateOutput("PASS", [{ section: "overall", status: "PASS" }]);

    await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    expect(resolveGatewayModelMock).toHaveBeenCalledTimes(1);
    const [calledModelId, calledContext, calledOpts] =
      resolveGatewayModelMock.mock.calls[0];
    expect(calledModelId).toBe(VERIFIER_MODEL_ID);
    expect(calledModelId).toBe(GATE_MODEL);
    expect(calledContext).toBe("host");
    // Forced Gateway-only (DR-013): the direct-Anthropic branch is unreachable.
    expect(calledOpts).toMatchObject({ forceGateway: true });
    // Must NOT be the drafter (the voice gate uses the smaller verifier).
    expect(calledModelId).not.toBe(DRAFTER_MODEL_ID);
    expect(calledModelId).not.toBe("anthropic/claude-sonnet-4.5");
    expect(calledModelId).toBe("anthropic/claude-haiku-4-5");
  });

  // ── DR-013 negative property: the gate path forces the Gateway and never ──
  // ── relies on a process.env provider key (locks §C17 at the gate layer).  ──

  it("forces Gateway-only resolution even with ANTHROPIC_API_KEY set (no raw-provider escape)", async () => {
    const ORIGINAL = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-leaked-into-host-env";
    try {
      mockGateOutput("PASS", [{ section: "overall", status: "PASS" }]);
      await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

      expect(resolveGatewayModelMock).toHaveBeenCalledTimes(1);
      const [, calledContext, calledOpts] =
        resolveGatewayModelMock.mock.calls[0];
      expect(calledContext).toBe("host");
      expect(calledOpts).toEqual({ forceGateway: true });
    } finally {
      if (ORIGINAL === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = ORIGINAL;
    }
  });

  it("passes the resolved Gateway model + canonical budget to generateText", async () => {
    mockGateOutput("PASS", [{ section: "overall", status: "PASS" }]);

    await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const args = generateTextMock.mock.calls[0][0] as {
      model: { __sentinel?: string; modelId?: string };
      temperature: number;
      maxOutputTokens: number;
      abortSignal?: AbortSignal;
    };
    expect(args.model.__sentinel).toBe("gateway-model");
    expect(args.model.modelId).toBe(VERIFIER_MODEL_ID);
    expect(args.temperature).toBe(0.1);
    expect(args.maxOutputTokens).toBe(1_500);
    expect(args.abortSignal).toBeDefined();
  });

  // ── Truncation ────────────────────────────────────────────────────────────────

  it("truncates article body to 6000 chars in the prompt", async () => {
    let capturedUserMessage: string | undefined;
    generateTextMock.mockImplementation((args: { prompt: string }) => {
      capturedUserMessage = args.prompt;
      return Promise.resolve({
        output: { overallStatus: "PASS", sections: [{ section: "overall", status: "PASS" }] },
      });
    });

    const longBody = "x".repeat(8000);
    await runContentVoiceGate({ title: "Test", body: longBody }, VALID_BRAND_MD);

    expect(capturedUserMessage).toBeDefined();
    expect(capturedUserMessage).toContain("article truncated for review");
    const bodyInPrompt = capturedUserMessage!.match(/x+/)?.[0] ?? "";
    expect(bodyInPrompt.length).toBeLessThanOrEqual(6000);
  });

  it("does NOT truncate body at exactly 6000 chars", async () => {
    let capturedUserMessage: string | undefined;
    generateTextMock.mockImplementation((args: { prompt: string }) => {
      capturedUserMessage = args.prompt;
      return Promise.resolve({
        output: { overallStatus: "PASS", sections: [{ section: "overall", status: "PASS" }] },
      });
    });

    const exactBody = "y".repeat(6000);
    await runContentVoiceGate({ title: "Test", body: exactBody }, VALID_BRAND_MD);

    expect(capturedUserMessage).toBeDefined();
    expect(capturedUserMessage).not.toContain("article truncated for review");
  });

  // ── Timeout budget ────────────────────────────────────────────────────────────

  it("GATE_TIMEOUT_MS is wired through an abort signal (not yet aborted on a fast resolve)", async () => {
    let abortSignal: AbortSignal | undefined;
    generateTextMock.mockImplementation((args: { abortSignal?: AbortSignal }) => {
      abortSignal = args.abortSignal;
      return Promise.resolve({
        output: { overallStatus: "PASS", sections: [{ section: "overall", status: "PASS" }] },
      });
    });

    await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    // The abort signal must be defined (timeout is wired up) …
    expect(abortSignal).toBeDefined();
    // … and not already aborted (we resolved fast).
    expect(abortSignal!.aborted).toBe(false);
  });

  // ── Brand bible truncation ────────────────────────────────────────────────────

  it("slices brandMd to 2000 chars in the prompt", async () => {
    let capturedUserMessage: string | undefined;
    generateTextMock.mockImplementation((args: { prompt: string }) => {
      capturedUserMessage = args.prompt;
      return Promise.resolve({
        output: { overallStatus: "PASS", sections: [{ section: "overall", status: "PASS" }] },
      });
    });

    const longBrandMd = "Brand rule: ".repeat(300); // ~3600 chars
    await runContentVoiceGate(SAMPLE_DRAFT, longBrandMd);

    expect(capturedUserMessage).toBeDefined();
    const brandSection = capturedUserMessage!.split("---")[1] ?? "";
    expect(brandSection.trim().length).toBeLessThanOrEqual(2000);
  });

  // ── Section label normalization ───────────────────────────────────────────────

  it("normalizes section label 'intro' → 'introduction'", async () => {
    mockGateOutput("WARN", [
      { section: "intro", status: "WARN", issue: "tone mismatch in opening" },
      { section: "body", status: "PASS" },
      { section: "closing", status: "PASS" },
    ]);

    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    expect(result.skipped).toBe(false);
    const introSection = result.sections.find((s) => s.status === "WARN");
    expect(introSection).toBeDefined();
    expect(introSection!.section).toBe("introduction");
  });

  it("normalizes section label 'closing' → 'conclusion'", async () => {
    mockGateOutput("PASS", [
      { section: "introduction", status: "PASS" },
      { section: "main", status: "PASS" },
      { section: "outro", status: "PASS" },
    ]);

    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    const sections = result.sections.map((s) => s.section);
    expect(sections).toContain("body"); // 'main' → 'body'
    expect(sections).toContain("conclusion"); // 'outro' → 'conclusion'
  });

  // ── Malformed section entries ─────────────────────────────────────────────────

  it("drops malformed section entries from model output gracefully", async () => {
    generateTextMock.mockResolvedValue({
      output: {
        overallStatus: "WARN",
        sections: [
          { section: "introduction", status: "PASS" },
          { section: "body", status: "INVALID_STATUS" }, // invalid — dropped
          null, // null — dropped
          42, // wrong type — dropped
          { status: "WARN" }, // missing section field — dropped
        ],
      },
    });

    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    expect(result.skipped).toBe(false);
    // Only the valid section survives
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].section).toBe("introduction");
    expect(result.sections[0].status).toBe("PASS");
  });

  // ── Issue + suggestion fields ─────────────────────────────────────────────────

  it("attaches issue and suggestion to non-PASS sections", async () => {
    mockGateOutput("WARN", [
      {
        section: "conclusion",
        status: "WARN",
        issue: '"unlock massive growth" uses forbidden superlative',
        suggestion: 'Replace with "accelerate sustainable growth"',
      },
    ]);

    const result = await runContentVoiceGate(SAMPLE_DRAFT, VALID_BRAND_MD);

    expect(result.sections).toHaveLength(1);
    const section = result.sections[0];
    expect(section.issue).toBe('"unlock massive growth" uses forbidden superlative');
    expect(section.suggestion).toBe('Replace with "accelerate sustainable growth"');
  });
});
