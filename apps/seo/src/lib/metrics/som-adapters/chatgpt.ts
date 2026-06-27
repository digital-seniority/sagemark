/**
 * ChatGPT / OpenAI SoM adapter (PR 021 / P1.C.4). RFC §728; spike Channel matrix.
 *
 * Direct path (Channel A): the OpenAI model API through the metered AI Gateway
 * (DR-013, Gateway-only — NO raw provider key). Per the feasibility spike the
 * direct API answer is a PROXY ("API-answer mention rate"), NOT the ChatGPT-app's
 * cited sources, and scraping the consumer product is ToS-forbidden — so the
 * `'vendor-api'` fallback (a contracted GEO-tracker: Profound / AthenaHQ / Peec)
 * is the HIGH-reliability consumer-citation channel, pre-wired behind the same
 * `SomAdapter` interface. James selects A/B/C; this adapter activates whichever
 * channel's credential is present.
 *
 * INERT until `SOM_LIVE` + creds (see base / types). Clean ASCII / UTF-8.
 */

import { BaseSomAdapter, type SomAdapterDeps } from "./base";
import type { RateLimitBudget } from "./types";

/** The Gateway model id for the OpenAI direct path (finalized at activation). */
export const CHATGPT_MODEL_ID = "openai/gpt-4o";

/** Conservative weekly-cadence per-engine budget (deferred over-budget probes). */
export const CHATGPT_BUDGET: RateLimitBudget = {
  maxRequestsPerWindow: 60,
  windowMs: 60_000,
};

/** Construct the ChatGPT adapter (direct = OpenAI via Gateway; no web-search tool). */
export function makeChatgptAdapter(deps: SomAdapterDeps = {}): BaseSomAdapter {
  return new BaseSomAdapter(
    {
      engine: "ChatGPT",
      modelId: CHATGPT_MODEL_ID,
      useWebSearch: false,
      // HYBRID decision: the OpenAI model-API answer is a PROXY (model-answer
      // mention), NOT a ChatGPT-app citation — scraping the consumer product is
      // ToS-forbidden. Labeled so it is never summed as a real citation.
      directChannel: "direct-proxy",
      budget: CHATGPT_BUDGET,
    },
    deps,
  );
}
