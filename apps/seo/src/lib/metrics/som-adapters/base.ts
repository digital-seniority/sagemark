/**
 * Shared base for the provider `SomAdapter`s (PR 021 / P1.C.4). RFC §728.
 *
 * Every engine adapter (chatgpt / claude / gemini) is the SAME control flow —
 * only the engine label, the Gateway model id, and whether it uses the web-search
 * tool differ. The base encodes the INERT + rate-limit + channel-selection
 * discipline ONCE so each engine module is a thin config:
 *
 *   1. INERT GATE (the hard constraint). `probe()` consults `adapterActivation()`
 *      FIRST. If it returns `'inert'` (SOM_LIVE unset OR no creds) the adapter
 *      returns a `miss` and makes ZERO live calls — no Gateway resolve, no vendor
 *      fetch, no network. (In practice the cron itself short-circuits on
 *      `somLiveEnabled()` before ever calling `probe`, so this is the defence-in-
 *      depth backstop: even a direct `probe()` call is inert without the flag.)
 *   2. RATE-LIMIT BUDGET. An over-budget probe returns `deferred` (next window) —
 *      never a crash / ban.
 *   3. CHANNEL SELECTION. `'vendor-api'` ⇒ the pre-wired GEO-tracker seam
 *      (injected `VendorApiClient`, default fail-closed). `'direct'` ⇒ the
 *      Gateway model API (DR-013 Gateway-only via `resolveGatewayModel`,
 *      `forceGateway: true` — NO raw provider key path).
 *
 * The DIRECT model call is itself injectable (`directRunner`) so the Tier-1 test
 * drives a fake Gateway response WITHOUT a key and asserts the parse/confidence,
 * while production wires the real `resolveGatewayModel` runner. With no runner
 * injected AND no test override, the base resolves the model through the Gateway
 * seam lazily (import-time network-free).
 *
 * Clean ASCII / UTF-8. No `console.*`. No `server-only` (Tier-1 vitest, plain Node).
 */

import type { ShareOfModelEngine } from "../share-of-model";
import { extractCitation } from "../som-parse";
import {
  type SomAdapter,
  type SomProbeRequest,
  type SomProbeOutcome,
  type SomProbeResult,
  type SomProbeContext,
  type RateLimitBudget,
  type VendorApiClient,
  type SomSourceChannel,
  RateLimiter,
  DEFAULT_PROBE_CONTEXT,
  NOT_WIRED_VENDOR_API,
  adapterActivation,
} from "./types";

/**
 * Runs ONE direct model-API probe through the Gateway and returns the raw answer
 * text. Injectable so a Tier-1 test supplies a fake response (no key, no network);
 * production injects the `resolveGatewayModel`-backed runner. The runner MUST route
 * through the metered Gateway only (DR-013) — it is handed nothing but the prompt.
 */
export type DirectProbeRunner = (args: {
  engine: ShareOfModelEngine;
  modelId: string;
  /** Whether this engine's direct path uses the web-search tool (Claude). */
  useWebSearch: boolean;
  query: string;
  context: SomProbeContext;
}) => Promise<string>;

/** Static per-engine config the base specializes on. */
export interface SomAdapterConfig {
  engine: ShareOfModelEngine;
  /** The Gateway model id (anthropic/openai/google form) for the direct path. */
  modelId: string;
  /** Whether the direct path uses the web-search tool (real cited sources). */
  useWebSearch: boolean;
  /**
   * The LOAD-BEARING source-channel label for THIS engine's DIRECT path (the
   * HYBRID channel decision): `'direct-citation'` for an engine whose direct path
   * returns real cited sources (Claude + web-search), `'direct-proxy'` for an
   * engine whose direct path is a model-answer MENTION proxy (ChatGPT / Gemini).
   * Persisted to `share_of_model.source_channel` so a proxy is never summed into a
   * citation rate unlabeled.
   */
  directChannel: Extract<SomSourceChannel, "direct-citation" | "direct-proxy">;
  budget: RateLimitBudget;
}

/** Injectable seams an adapter needs (all default to fail-closed / Gateway). */
export interface SomAdapterDeps {
  /** Channel B: the contracted GEO-tracker client (default = fail-closed). */
  vendorClient?: VendorApiClient;
  /** Channel A: the direct Gateway runner (default = the real Gateway runner). */
  directRunner?: DirectProbeRunner;
  /** Env override (default = process.env) so the test drives the INERT gate. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Thrown when the direct Gateway runner is reached without a wired live runner.
 * Mirrors the codebase's `NOT_WIRED_*` discipline — the live Gateway runner (which
 * imports the AI SDK + attaches the per-engine web-search tool) is injected by the
 * separate human-reviewed ACTIVATION PR, alongside `SOM_LIVE` + the Gateway creds.
 * Until then the direct channel is inert: this throw is caught by `probe()` and
 * surfaced as a logged `miss` (never a crash, never a raw provider call).
 */
export class DirectRunnerNotWiredError extends Error {
  readonly code = "SOM_DIRECT_RUNNER_NOT_WIRED" as const;
  constructor(engine: ShareOfModelEngine) {
    super(
      `SoM direct Gateway runner is not wired for ${engine}: the live ` +
        "resolveGatewayModel runner (Gateway-only, DR-013) is injected by the " +
        "activation PR with SOM_LIVE + the Gateway credential. Inject a " +
        "DirectProbeRunner to activate Channel A.",
    );
    this.name = "DirectRunnerNotWiredError";
  }
}

/**
 * The default DIRECT runner: FAIL-CLOSED / not-wired (PR 021 scaffolding). The
 * live runner — which routes through the metered AI Gateway ONLY (DR-013,
 * `resolveGatewayModel(modelId, "host", { forceGateway: true })`, the raw provider
 * branch structurally skipped) and attaches the per-engine web-search tool — is
 * injected by the separate activation PR. This throw is unreachable without
 * `SOM_LIVE` + creds (the INERT gate returns a `miss` first) and is itself caught
 * as a `miss`, so a merge triggers ZERO live calls. The AI SDK is intentionally
 * NOT imported here (apps/seo does not depend on `ai` directly; the activation PR
 * wires the runner from a module that does).
 */
export const gatewayDirectRunner: DirectProbeRunner = ({ engine }) => {
  throw new DirectRunnerNotWiredError(engine);
};

/** The shared adapter: one instance per engine, specialized by `SomAdapterConfig`. */
export class BaseSomAdapter implements SomAdapter {
  readonly engine: ShareOfModelEngine;
  readonly budget: RateLimitBudget;

  private readonly limiter: RateLimiter;
  private readonly vendorClient: VendorApiClient;
  private readonly directRunner: DirectProbeRunner;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly config: SomAdapterConfig,
    deps: SomAdapterDeps = {},
  ) {
    this.engine = config.engine;
    this.budget = config.budget;
    this.limiter = new RateLimiter(config.budget);
    this.vendorClient = deps.vendorClient ?? NOT_WIRED_VENDOR_API;
    this.directRunner = deps.directRunner ?? gatewayDirectRunner;
    this.env = deps.env ?? process.env;
  }

  async probe(req: SomProbeRequest, now: number): Promise<SomProbeOutcome> {
    const context = req.context ?? DEFAULT_PROBE_CONTEXT;

    // 1. INERT GATE (hard constraint): no flag / no creds ⇒ zero live calls.
    const activation = adapterActivation(this.env);
    if (activation === "inert") {
      return {
        status: "miss",
        engine: this.engine,
        reason: "inert: SOM_LIVE unset or no channel credentials (no live probe)",
      };
    }

    // 2. RATE-LIMIT BUDGET: over budget ⇒ defer to next window (never a ban).
    if (!this.limiter.tryConsume(now)) {
      return {
        status: "deferred",
        engine: this.engine,
        reason: `over rate-limit budget (${this.budget.maxRequestsPerWindow}/${this.budget.windowMs}ms)`,
      };
    }

    // 3. CHANNEL SELECTION.
    try {
      if (activation === "vendor-api") {
        return await this.probeVendor(req, context);
      }
      return await this.probeDirect(req, context);
    } catch (err) {
      // A degraded engine logs a MISS — it never crashes the cron.
      return {
        status: "miss",
        engine: this.engine,
        reason: `probe error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Channel B — the sanctioned GEO-tracker vendor API (real consumer citations). */
  private async probeVendor(
    req: SomProbeRequest,
    context: SomProbeContext,
  ): Promise<SomProbeOutcome> {
    const v = await this.vendorClient.fetchCitation({
      engine: this.engine,
      query: req.query,
      context,
    });
    // A vendor returns a STRUCTURED citation; we still re-run the parser over its
    // raw payload for a confidence score (and to keep the row shape identical).
    const verdict = extractCitation(v.rawResponse, req.citeTarget);
    const result: SomProbeResult = {
      engine: this.engine,
      rawResponse: v.rawResponse,
      // Trust the vendor's structured `cited`/`position`; the parser confidence
      // qualifies the re-parse, not the vendor's authoritative signal.
      cited: v.cited,
      position: v.position,
      parserConf: verdict.parserConf,
      locale: context.locale,
      deviceProfile: context.deviceProfile,
      // The contracted GEO-tracker reports REAL consumer-engine citations.
      sourceChannel: "vendor",
    };
    return { status: "ok", result };
  }

  /** Channel A — the direct model API through the metered Gateway (DR-013). */
  private async probeDirect(
    req: SomProbeRequest,
    context: SomProbeContext,
  ): Promise<SomProbeOutcome> {
    const rawResponse = await this.directRunner({
      engine: this.engine,
      modelId: this.config.modelId,
      useWebSearch: this.config.useWebSearch,
      query: req.query,
      context,
    });
    const verdict = extractCitation(rawResponse, req.citeTarget);
    const result: SomProbeResult = {
      engine: this.engine,
      rawResponse,
      cited: verdict.cited,
      position: verdict.position,
      parserConf: verdict.parserConf,
      locale: context.locale,
      deviceProfile: context.deviceProfile,
      // Per-engine label (HYBRID decision): 'direct-citation' (Claude+web-search,
      // real cited sources) vs 'direct-proxy' (ChatGPT/Gemini model-answer mention).
      sourceChannel: this.config.directChannel satisfies SomSourceChannel,
    };
    return { status: "ok", result };
  }
}
