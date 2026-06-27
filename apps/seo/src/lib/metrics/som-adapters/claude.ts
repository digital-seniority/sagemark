/**
 * Claude / Anthropic SoM adapter (PR 021 / P1.C.4). RFC §728; spike Channel matrix.
 *
 * Direct path (Channel A): the Claude model API + the WEB-SEARCH TOOL through the
 * metered AI Gateway (DR-013, Gateway-only — NO raw provider key). Per the spike
 * this is the ONE genuinely-citation direct channel — the web-search tool returns
 * REAL cited sources (MEDIUM-HIGH reliability), so `useWebSearch: true`. The
 * `'vendor-api'` GEO-tracker fallback is still pre-wired behind the same interface
 * for parity / ToS resilience. INERT until `SOM_LIVE` + creds.
 *
 * Clean ASCII / UTF-8.
 */

import { BaseSomAdapter, type SomAdapterDeps } from "./base";
import type { RateLimitBudget } from "./types";

/** The Gateway model id for the Claude direct path (finalized at activation). */
export const CLAUDE_MODEL_ID = "anthropic/claude-sonnet-4-6";

/** Conservative per-engine budget (web-search probes are heavier — lower cap). */
export const CLAUDE_BUDGET: RateLimitBudget = {
  maxRequestsPerWindow: 30,
  windowMs: 60_000,
};

/**
 * Construct the Claude adapter. `useWebSearch: true` — the web-search tool is what
 * makes the direct Claude probe return real cited sources (the spike's MEDIUM-HIGH
 * reliability direct channel); the activation PR attaches the tool to the runner.
 */
export function makeClaudeAdapter(deps: SomAdapterDeps = {}): BaseSomAdapter {
  return new BaseSomAdapter(
    {
      engine: "Claude",
      modelId: CLAUDE_MODEL_ID,
      useWebSearch: true,
      // HYBRID decision: Claude + the web-search tool returns REAL cited sources
      // — the one genuinely-citation direct channel. Labeled 'direct-citation'.
      directChannel: "direct-citation",
      budget: CLAUDE_BUDGET,
    },
    deps,
  );
}
