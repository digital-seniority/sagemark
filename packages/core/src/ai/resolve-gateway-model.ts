/**
 * AI SDK / Vercel AI Gateway model resolution + routing for the SEO Creator.
 *
 * Ported from flywheel-main `apps/trailhead/src/lib/ai.ts` (the
 * `resolveGatewayModel` provider seam + the RFC §6 model-id constants) and
 * adapted for the SEO Creator's **host/worker invariant** (PR 001, RFC §2,
 * PRD §9.3):
 *
 *   ── ALL worker model traffic routes through the metered Gateway. ──
 *
 * `resolveGatewayModel()` exposes a `context: 'host' | 'worker'` parameter:
 *
 *   • `'host'` (host/CI/operator-console runtime) — MAY use the direct-Anthropic
 *     BYOK branch when `ANTHROPIC_API_KEY` is set (the original Trailhead escape
 *     hatch: Gateway free-tier blocks premium models, so a direct provider call
 *     billed to the user's own Anthropic account is the supported fallback).
 *
 *   • `'worker'` (the Vercel Sandbox Agent-SDK worker runtime) — the
 *     direct-Anthropic branch is **unreachable**. The worker is always
 *     provisioned with the Gateway base URL + a per-run bridge JWT as its ONLY
 *     model credential (it never holds a raw provider key). Even if a stray
 *     `ANTHROPIC_API_KEY` leaks into the ambient env, the `'worker'` context
 *     resolves a Gateway provider ONLY and refuses to return a raw-Anthropic
 *     endpoint provider. With no direct branch reachable and no raw key in its
 *     env, a worker launched without the Gateway seam can make no model call at
 *     all — it fails fast (the §3.4-layer-5 egress allowlist enforces the same
 *     property at the network layer; this code path is the in-process backstop).
 *
 * **No network at import time.** Both providers are imported dynamically, so
 * importing this module (and anything that defaults to the real seam) never
 * requires a key — a key is only touched when a model is actually resolved.
 */

import type { LanguageModelV4 } from "@ai-sdk/provider";

// =============================================================
// Model ids (RFC §6) — re-baselined off claude-sonnet-4.5
// =============================================================
//
// PR 001 re-baseline: drafter sonnet-4.5 → 4-6, verifier → haiku-4-5,
// judge → opus-4-7. `budget_tokens` (extended-thinking budget) is dropped for
// 4.6+/Opus — these ids do not take a thinking budget here.

/** Drafter model (RFC §6). Composes the grounded draft. */
export const DRAFTER_MODEL_ID = "anthropic/claude-sonnet-4-6";
/** Faithfulness verifier model (RFC §6). MUST differ from the drafter (cross-model gate). */
export const VERIFIER_MODEL_ID = "anthropic/claude-haiku-4-5";
/** Judge model (RFC §6). Scores the Stage-B composite. */
export const JUDGE_MODEL_ID = "anthropic/claude-opus-4-7";

/**
 * The runtime context a model is being resolved in.
 *
 *  - `'host'`   — host / CI / operator-console: the direct-Anthropic BYOK branch
 *                 is permitted.
 *  - `'worker'` — the Sandbox Agent-SDK worker: Gateway-only; the direct branch
 *                 is unreachable even with a raw key in the ambient env.
 */
export type ResolveContext = "host" | "worker";

/**
 * Raised when a model resolution would violate the worker invariant — i.e. a
 * `'worker'` context tried (or was about to be allowed) to resolve a raw
 * direct-Anthropic provider. Surfacing this as a typed error keeps the failure
 * loud and fail-fast rather than silently falling back to a raw endpoint.
 */
export class WorkerProviderInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerProviderInvariantError";
  }
}

/**
 * Per-call resolution options.
 *
 * DR-013 (Gateway-only-metered gate path): `forceGateway: true` makes the call
 * structurally Gateway-only — the direct-Anthropic BYOK branch is skipped and
 * `ANTHROPIC_API_KEY` is never read, regardless of `context`. The
 * faithfulness/voice gates pass this so gate spend can never escape the metered
 * Gateway (the D4 cost ledger guarantee cannot depend on env hygiene).
 */
export interface ResolveGatewayModelOptions {
  /**
   * When `true`, always route through the Gateway — skip the direct-Anthropic
   * branch entirely and do not even consult `ANTHROPIC_API_KEY`. DR-013.
   */
  forceGateway?: boolean;
}

/**
 * Resolve the AI SDK language model for `modelId` in the given `context`.
 *
 * Routing:
 *   1. **Direct-Anthropic (BYOK)** — `context: 'host'` AND `ANTHROPIC_API_KEY`
 *      set AND NOT `opts.forceGateway` ⇒ call the Anthropic provider directly
 *      (Gateway-form ids have their `anthropic/` prefix stripped for the direct
 *      provider). HOST-ONLY.
 *   2. **Vercel AI Gateway** — otherwise route through the metered Gateway
 *      (reads `AI_GATEWAY_API_KEY` / the per-run bridge JWT, or the Vercel OIDC
 *      token on deploy). This is the ONLY route a `'worker'` context — or any
 *      `opts.forceGateway` call — can take.
 *
 * The `'worker'` context NEVER consults `ANTHROPIC_API_KEY` — the direct branch
 * is structurally unreachable there, so worker traffic is always metered.
 * `opts.forceGateway` extends that same guarantee to host-context callers (the
 * gate path, DR-013): the direct branch is skipped even with a raw key present.
 *
 * Name kept as `resolveGatewayModel` to avoid call-site churn across the port.
 */
export async function resolveGatewayModel(
  modelId: string,
  context: ResolveContext = "worker",
  opts?: ResolveGatewayModelOptions,
): Promise<LanguageModelV4> {
  // DR-013: a forced-Gateway call (the metered gate path) skips the direct
  // branch entirely — we do not even read ANTHROPIC_API_KEY below.
  // Worker invariant: the direct-Anthropic branch is unreachable in the worker
  // runtime. We do not even read ANTHROPIC_API_KEY here — a stray key in the
  // ambient env can never route a worker call to api.anthropic.com.
  if (context === "host" && !opts?.forceGateway) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({ apiKey: anthropicKey });
      const bareId = modelId.startsWith("anthropic/")
        ? modelId.slice("anthropic/".length)
        : modelId;
      return anthropic(bareId);
    }
  }

  const { gateway } = await import("@ai-sdk/gateway");
  return gateway(modelId);
}
