/**
 * Live SoM direct-probe runner — the Gateway-only model call for the Share-of-Model
 * ingestion cron's `direct` channel (DR-013 Gateway-only, RFC §728).
 *
 * THE GAP THIS CLOSES. The SoM `BaseSomAdapter`'s direct channel calls an injected
 * `DirectProbeRunner` (apps/seo `som-adapters/base.ts`); its production default is
 * the fail-closed `gatewayDirectRunner` stub (throws NOT_WIRED) because apps/seo
 * does not depend on the `ai` SDK directly. This module — in `@sagemark/core`, which
 * DOES depend on `ai` + `@ai-sdk/gateway` + `@ai-sdk/anthropic` — is the live runner
 * the ACTIVATION PR injects: it routes EVERY model call through the metered AI
 * Gateway and, for the Claude `direct-citation` engine, attaches the Claude
 * web-search tool so the probe returns REAL cited sources.
 *
 * DR-013 (GATEWAY-ONLY, load-bearing). The model is resolved via
 * `resolveGatewayModel(modelId, "host", { forceGateway: true })`. `forceGateway`
 * makes the call structurally Gateway-only: the direct-Anthropic BYOK branch is
 * skipped and `ANTHROPIC_API_KEY` is never read. NO raw provider key / endpoint is
 * touched here — all SoM model spend is metered through the Gateway (the D4 cost
 * ledger is built from live Gateway usage and cannot depend on env hygiene).
 *
 * WEB-SEARCH TOOL (Claude only). When `useWebSearch` is true (the Claude adapter),
 * the runner attaches the Claude web-search server tool (`anthropic.tools.webSearch_*`)
 * so the answer is grounded in REAL cited sources — the one genuinely-citation
 * direct channel (`source_channel = direct-citation`). ChatGPT/Gemini run with NO
 * tool (a model-answer mention proxy → `direct-proxy`). The tool object comes from
 * the `@ai-sdk/anthropic` provider but the MODEL still resolves through the Gateway
 * (the tool is a provider-defined tool block the Gateway forwards to Anthropic).
 *
 * NETWORK-FREE IMPORT. `ai` is a static import (core already depends on it for the
 * gates), but `@ai-sdk/anthropic` is imported DYNAMICALLY so importing this module
 * is network-free and reaches no provider until a probe actually runs.
 *
 * `server-only`: this resolves Gateway creds and must never ship to a client.
 *
 * Clean ASCII / UTF-8. No `console.*`.
 */

import "server-only";

import { generateText, type ToolSet } from "ai";

import { resolveGatewayModel } from "./resolve-gateway-model";

/**
 * The arguments the SoM adapter's `DirectProbeRunner` hands the runner (mirrors the
 * apps/seo `DirectProbeRunner` shape so the activation wiring is a 1:1 inject).
 */
export interface SomDirectRunnerArgs {
  /** The engine being probed (for logging / labeling only). */
  engine: string;
  /** The Gateway model id (anthropic/openai/google form) for the direct path. */
  modelId: string;
  /** Whether to attach the Claude web-search tool (true = direct-citation engine). */
  useWebSearch: boolean;
  /** The NORMALIZED prompt to send. */
  query: string;
  /** The geo/device context (locale qualifies the probe; not sent as a param). */
  context: { locale: string; deviceProfile: string };
}

/**
 * The max number of web searches a single Claude probe may run. A conservative cap
 * (cost + latency); over it the model answers from what it found.
 */
const WEB_SEARCH_MAX_USES = 3;
/** A modest output ceiling — a SoM probe is a short answer, not a long generation. */
const SOM_MAX_OUTPUT_TOKENS = 1024;

/**
 * Build the Claude web-search tool set, or undefined when this engine does not use
 * it. The tool factory lives on the `@ai-sdk/anthropic` provider (imported
 * dynamically); the MODEL still routes through the Gateway. Returns undefined on
 * any import/shape failure so a tool-availability hiccup degrades to a no-tool
 * probe rather than crashing (the cron treats a runner throw as a logged miss
 * anyway — this keeps the citation path resilient).
 */
async function buildWebSearchTools(): Promise<ToolSet | undefined> {
  try {
    const mod = (await import("@ai-sdk/anthropic")) as {
      anthropic?: { tools?: Record<string, (args?: unknown) => unknown> };
    };
    const tools = mod.anthropic?.tools;
    // Prefer the basic web-search variant (broad Gateway/provider availability).
    const factory =
      tools?.webSearch_20250305 ?? tools?.webSearch_20260209;
    if (typeof factory !== "function") return undefined;
    // The factory returns a provider-defined tool; the AI SDK's ToolSet typing is
    // satisfied structurally — cast at this single boundary.
    return { web_search: factory({ maxUses: WEB_SEARCH_MAX_USES }) } as ToolSet;
  } catch {
    return undefined;
  }
}

/**
 * Run ONE live SoM direct probe through the metered Gateway and return the raw
 * answer text. Gateway-only (DR-013): the model is resolved with
 * `forceGateway: true`, so no raw provider key is ever read. The Claude engine
 * additionally gets the web-search tool for real cited sources.
 *
 * Throws on a model/network error — the SoM adapter's `probe()` catches it and
 * surfaces a logged `miss` (the cron never crashes). The returned text is fed to
 * `som-parse` (citation + confidence) by the adapter.
 */
export async function runSomDirectProbe(args: SomDirectRunnerArgs): Promise<string> {
  // DR-013: resolve the model through the metered Gateway ONLY. `forceGateway`
  // skips the direct-Anthropic branch and never reads ANTHROPIC_API_KEY.
  const model = await resolveGatewayModel(args.modelId, "host", {
    forceGateway: true,
  });

  const tools = args.useWebSearch ? await buildWebSearchTools() : undefined;

  const result = await generateText({
    model,
    maxOutputTokens: SOM_MAX_OUTPUT_TOKENS,
    prompt: args.query,
    ...(tools ? { tools } : {}),
  });

  return result.text ?? "";
}

/**
 * The runner bound to the SoM adapter's `DirectProbeRunner` callback shape. The
 * activation wiring injects THIS into `makeDefaultSomAdapters({ directRunner })`.
 * Identity wrapper so the SoM subsystem need not import the AI SDK.
 */
export const somDirectRunner = (args: SomDirectRunnerArgs): Promise<string> =>
  runSomDirectProbe(args);
