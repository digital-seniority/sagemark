/**
 * Gemini / Google SoM adapter (PR 021 / P1.C.4). RFC §728; spike Channel matrix.
 *
 * Direct path (Channel A): the Gemini model API through the metered AI Gateway
 * (DR-013, Gateway-only — NO raw provider key). Per the spike, Google AI Overviews
 * (the high-traffic surface) has NO official citation API, so the direct path is a
 * LOW-reliability proxy for AIO citations — the `'vendor-api'` GEO-tracker fallback
 * (which captures AI Overviews + Gemini citations) is the HIGH-reliability channel,
 * pre-wired behind the same `SomAdapter` interface. INERT until `SOM_LIVE` + creds.
 *
 * Clean ASCII / UTF-8.
 */

import { BaseSomAdapter, type SomAdapterDeps } from "./base";
import type { RateLimitBudget } from "./types";

/** The Gateway model id for the Gemini direct path (finalized at activation). */
export const GEMINI_MODEL_ID = "google/gemini-2.5-flash";

/** Conservative weekly-cadence per-engine budget. */
export const GEMINI_BUDGET: RateLimitBudget = {
  maxRequestsPerWindow: 60,
  windowMs: 60_000,
};

/** Construct the Gemini adapter (direct = Gemini via Gateway; no web-search tool). */
export function makeGeminiAdapter(deps: SomAdapterDeps = {}): BaseSomAdapter {
  return new BaseSomAdapter(
    {
      engine: "Gemini",
      modelId: GEMINI_MODEL_ID,
      useWebSearch: false,
      // HYBRID decision: Google AI Overviews has NO citation API, so the Gemini
      // model-API answer is a PROXY (model-answer mention), NOT an AIO citation.
      // Labeled 'direct-proxy' so it is never summed as a real citation.
      directChannel: "direct-proxy",
      budget: GEMINI_BUDGET,
    },
    deps,
  );
}
