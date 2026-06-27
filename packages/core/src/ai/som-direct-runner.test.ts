/**
 * som-direct-runner.test.ts — the live SoM direct probe (Gateway-only, DR-013).
 *
 * Hermetic: `ai`, `@ai-sdk/gateway`, and `@ai-sdk/anthropic` are MOCKED so there is
 * no network and no real key. Proves:
 *
 *   1. GATEWAY-ONLY (DR-013) — the model resolves through the Gateway provider, the
 *      raw-Anthropic branch is NEVER reached, and ANTHROPIC_API_KEY is never read,
 *      because the runner calls resolveGatewayModel(..., { forceGateway: true }).
 *   2. WEB-SEARCH TOOL — the Claude engine (useWebSearch:true) attaches the
 *      anthropic web-search tool; the proxy engines (useWebSearch:false) attach NO
 *      tool.
 *   3. The raw answer text flows back from generateText.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const webSearchFactory = vi.fn((args?: unknown) => ({
  __tool: "web_search" as const,
  args,
}));

const generateTextMock = vi.fn(
  async (opts: { model: unknown; tools?: Record<string, unknown> }) => {
    // Record what was passed for the assertions below.
    lastCall = opts;
    return { text: "ANSWER: Whispering Willows is cited." };
  },
);

let lastCall: { model: unknown; tools?: Record<string, unknown> } | null = null;

vi.mock("ai", () => ({
  generateText: (opts: { model: unknown; tools?: Record<string, unknown> }) =>
    generateTextMock(opts),
}));

vi.mock("@ai-sdk/gateway", () => ({
  gateway: (modelId: string) => gatewayFactory(modelId),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (opts: { apiKey: string }) => createAnthropicFactory(opts),
  anthropic: { tools: { webSearch_20250305: webSearchFactory } },
}));

import { runSomDirectProbe } from "./som-direct-runner";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  gatewayFactory.mockClear();
  createAnthropicFactory.mockClear();
  webSearchFactory.mockClear();
  generateTextMock.mockClear();
  lastCall = null;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

describe("som-direct-runner: Gateway-only (DR-013)", () => {
  it("routes through the Gateway and NEVER the raw-Anthropic branch, even with a key in env", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-leaked-into-env";

    const text = await runSomDirectProbe({
      engine: "Claude",
      modelId: "anthropic/claude-sonnet-4-6",
      useWebSearch: true,
      query: "best assisted living in Mount Vernon",
      context: { locale: "en-US", deviceProfile: "desktop" },
    });

    // forceGateway:true => Gateway provider only; raw-Anthropic branch never reached.
    expect(gatewayFactory).toHaveBeenCalledWith("anthropic/claude-sonnet-4-6");
    expect(createAnthropicFactory).not.toHaveBeenCalled();
    expect(
      (lastCall!.model as { endpoint: string }).endpoint,
    ).toBe("vercel-ai-gateway");
    expect(text).toContain("Whispering Willows");
  });

  it("Claude engine (useWebSearch:true) attaches the web-search tool", async () => {
    await runSomDirectProbe({
      engine: "Claude",
      modelId: "anthropic/claude-sonnet-4-6",
      useWebSearch: true,
      query: "q",
      context: { locale: "en-US", deviceProfile: "desktop" },
    });
    expect(webSearchFactory).toHaveBeenCalledTimes(1);
    expect(lastCall!.tools).toBeDefined();
    expect(lastCall!.tools).toHaveProperty("web_search");
  });

  it("proxy engine (useWebSearch:false) attaches NO tool", async () => {
    await runSomDirectProbe({
      engine: "ChatGPT",
      modelId: "openai/gpt-4o",
      useWebSearch: false,
      query: "q",
      context: { locale: "en-US", deviceProfile: "desktop" },
    });
    expect(webSearchFactory).not.toHaveBeenCalled();
    expect(lastCall!.tools).toBeUndefined();
  });
});
