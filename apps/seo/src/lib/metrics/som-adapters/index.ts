/**
 * SoM adapter set barrel + the default engine-adapter factory (PR 021 / P1.C.4).
 *
 * `perplexity` is DEFERRED (DR-038, the 4th engine) — only ChatGPT / Claude /
 * Gemini are built. INERT until `SOM_LIVE` + creds. Clean ASCII / UTF-8.
 */

import type { SomAdapter } from "./types";
import type { SomAdapterDeps } from "./base";
import { makeChatgptAdapter } from "./chatgpt";
import { makeClaudeAdapter } from "./claude";
import { makeGeminiAdapter } from "./gemini";

export * from "./types";
export * from "./base";
export { makeChatgptAdapter, CHATGPT_MODEL_ID, CHATGPT_BUDGET } from "./chatgpt";
export { makeClaudeAdapter, CLAUDE_MODEL_ID, CLAUDE_BUDGET } from "./claude";
export { makeGeminiAdapter, GEMINI_MODEL_ID, GEMINI_BUDGET } from "./gemini";

/**
 * Build the default engine adapter set (ChatGPT · Claude · Gemini — DR-038;
 * perplexity deferred). All share the same injected deps (vendor client / direct
 * runner / env) so the cron + the test wire one set. INERT: each adapter is inert
 * until `SOM_LIVE` + its channel creds (the deps default to fail-closed seams).
 */
export function makeDefaultSomAdapters(deps: SomAdapterDeps = {}): SomAdapter[] {
  return [makeChatgptAdapter(deps), makeClaudeAdapter(deps), makeGeminiAdapter(deps)];
}
