/**
 * PR 002 acceptance criterion 2:
 *   - Faithfulness gate carries the 12s timeout + 25-claim cap.
 *   - Voice gate carries the 3s timeout.
 *
 * These budgets are the gate-latency floor (RFC §1): 45s draft + 12s
 * faithfulness + 3s voice = 60s maxDuration, and the 25-claim cap stops a long
 * article from overflowing the gate token budget and silently degrading to
 * `skipped: true`. They are asserted directly against the exported constants so
 * a regression (e.g. a revert of "Bug 2"/"Bug 3" to 30s / no cap) fails the
 * build.
 *
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

// The faithfulness gate routes through the metered AI Gateway seam
// (`resolveGatewayModel` + the AI SDK `generateText`), not a raw fetch. Mock the
// AI SDK + the seam so we can capture the system prompt the gate sends to the
// verifier and prove the 25-claim cap is load-bearing.
const generateTextMock = vi.fn() as Mock;

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
    resolveGatewayModel: async (modelId: string) => ({
      __sentinel: "gateway-model" as const,
      modelId,
    }),
  };
});

import {
  GATE_TIMEOUT_MS as FAITHFULNESS_TIMEOUT_MS,
  GATE_MAX_TOKENS as FAITHFULNESS_MAX_TOKENS,
  GATE_CLAIM_CAP,
  runFaithfulnessGate,
} from "./faithfulness-gate";
import {
  GATE_TIMEOUT_MS as VOICE_TIMEOUT_MS,
  runContentVoiceGate,
} from "./voice-gate";

afterEach(() => {
  generateTextMock.mockReset();
});

describe("faithfulness gate budgets (criterion 2)", () => {
  it("carries the 12s timeout (Bug 2 fix: 30s → 12s)", () => {
    expect(FAITHFULNESS_TIMEOUT_MS).toBe(12_000);
  });

  it("carries the 25-claim cap (Bug 3 fix) and the cap is referenced in the verifier prompt", async () => {
    expect(GATE_CLAIM_CAP).toBe(25);

    // Prove the cap is load-bearing, not a dead constant: it appears in the
    // system prompt the gate sends to the verifier via the AI Gateway seam.
    let systemPrompt = "";
    generateTextMock.mockImplementation((args: { system?: string }) => {
      systemPrompt = args.system ?? "";
      return Promise.resolve({ output: { claims: [] } });
    });

    await runFaithfulnessGate(
      { body: "Some draft body with claims." },
      {
        sources: [
          { url: "https://example.com", title: "T", snippet: "fact" },
        ],
      },
    );

    expect(systemPrompt).toContain(String(GATE_CLAIM_CAP));
  });

  it("token budget is bounded (2000) — the headroom the 25-claim cap protects", () => {
    expect(FAITHFULNESS_MAX_TOKENS).toBe(2_000);
  });
});

describe("voice gate budgets (criterion 2)", () => {
  it("carries the 3s timeout (Bug fix: 15s → 3s, keeps 45+12+3 within 60s)", () => {
    expect(VOICE_TIMEOUT_MS).toBe(3_000);
  });

  it("the voice gate's 3s timeout leaves the faithfulness gate's 12s budget intact (3 < 12)", () => {
    expect(VOICE_TIMEOUT_MS).toBeLessThan(FAITHFULNESS_TIMEOUT_MS);
  });

  it("the gate timeouts sum within the 60s route maxDuration with a 45s draft", () => {
    const draftBudgetMs = 45_000;
    expect(draftBudgetMs + FAITHFULNESS_TIMEOUT_MS + VOICE_TIMEOUT_MS).toBe(
      60_000,
    );
  });

  // Touch the gate fns so this budget suite also exercises the import surface.
  it("both gates are callable (smoke)", async () => {
    const voice = await runContentVoiceGate(
      { title: "t", body: "b" },
      undefined,
    );
    expect(voice.skipped).toBe(true);
  });
});
