import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The provider seam is tested with the two AI-SDK provider modules MOCKED, so
 * the test is hermetic (no network, no real `@ai-sdk/*` install needed) and so
 * we can assert *which provider branch* a given (context, env) pair resolves.
 *
 * Each mock returns a tagged sentinel so the assertions can tell a Gateway
 * provider apart from a raw-Anthropic-endpoint provider by inspection.
 */

const gatewayFactory = vi.fn((modelId: string) => ({
  __provider: "gateway" as const,
  endpoint: "vercel-ai-gateway",
  modelId,
}));

const createAnthropicFactory = vi.fn((opts: { apiKey: string }) => {
  const fn = (modelId: string) => ({
    __provider: "anthropic-direct" as const,
    endpoint: "https://api.anthropic.com",
    apiKey: opts.apiKey,
    modelId,
  });
  return fn;
});

vi.mock("@ai-sdk/gateway", () => ({
  gateway: (modelId: string) => gatewayFactory(modelId),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (opts: { apiKey: string }) => createAnthropicFactory(opts),
}));

import {
  DRAFTER_MODEL_ID,
  JUDGE_MODEL_ID,
  VERIFIER_MODEL_ID,
  resolveGatewayModel,
} from "./resolve-gateway-model";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  gatewayFactory.mockClear();
  createAnthropicFactory.mockClear();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

describe("resolveGatewayModel — worker invariant", () => {
  it("worker context resolves ONLY a Gateway provider even with ANTHROPIC_API_KEY present", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-leaked-into-worker-env";

    const model = (await resolveGatewayModel(
      DRAFTER_MODEL_ID,
      "worker",
    )) as unknown as { __provider: string; endpoint: string };

    expect(model.__provider).toBe("gateway");
    expect(model.endpoint).toBe("vercel-ai-gateway");
    // The direct-Anthropic branch must never be reached from a worker.
    expect(createAnthropicFactory).not.toHaveBeenCalled();
    expect(model.endpoint).not.toContain("api.anthropic.com");
    expect(gatewayFactory).toHaveBeenCalledWith(DRAFTER_MODEL_ID);
  });

  it("worker context refuses the raw Anthropic endpoint for every model id", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-present";
    for (const id of [DRAFTER_MODEL_ID, VERIFIER_MODEL_ID, JUDGE_MODEL_ID]) {
      const model = (await resolveGatewayModel(id, "worker")) as unknown as {
        __provider: string;
        endpoint: string;
      };
      expect(model.__provider).toBe("gateway");
      expect(model.endpoint).not.toContain("api.anthropic.com");
    }
    expect(createAnthropicFactory).not.toHaveBeenCalled();
  });

  it("worker context defaults when no context is passed (Gateway-only)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-present";
    const model = (await resolveGatewayModel(DRAFTER_MODEL_ID)) as unknown as {
      __provider: string;
    };
    expect(model.__provider).toBe("gateway");
    expect(createAnthropicFactory).not.toHaveBeenCalled();
  });
});

describe("resolveGatewayModel — host context (BYOK escape hatch)", () => {
  it("host context uses the direct-Anthropic provider when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-host-byok";
    const model = (await resolveGatewayModel(DRAFTER_MODEL_ID, "host")) as unknown as {
      __provider: string;
      modelId: string;
    };
    expect(model.__provider).toBe("anthropic-direct");
    // `anthropic/` prefix stripped for the direct provider.
    expect(model.modelId).toBe("claude-sonnet-4-6");
    expect(createAnthropicFactory).toHaveBeenCalledWith({
      apiKey: "sk-ant-host-byok",
    });
  });

  it("host context falls back to the Gateway when no key is present", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const model = (await resolveGatewayModel(JUDGE_MODEL_ID, "host")) as unknown as {
      __provider: string;
    };
    expect(model.__provider).toBe("gateway");
    expect(createAnthropicFactory).not.toHaveBeenCalled();
  });
});

describe("re-baselined model ids (RFC §6)", () => {
  it("drafter = sonnet-4-6, verifier = haiku-4-5, judge = opus-4-7", () => {
    expect(DRAFTER_MODEL_ID).toBe("anthropic/claude-sonnet-4-6");
    expect(VERIFIER_MODEL_ID).toBe("anthropic/claude-haiku-4-5");
    expect(JUDGE_MODEL_ID).toBe("anthropic/claude-opus-4-7");
  });

  it("drafter !== verifier (cross-model faithfulness invariant)", () => {
    expect(DRAFTER_MODEL_ID).not.toBe(VERIFIER_MODEL_ID);
  });
});
