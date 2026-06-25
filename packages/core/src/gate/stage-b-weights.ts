/**
 * stage-b-weights — the 8 Stage-B composite dimension weights.
 *
 * Split out of `seo-gate.ts` into its own module per the PR 003 write-scope
 * (engineering-rfc.md §PR 003). Ported verbatim from flywheel-main
 * `origin/preview` (`apps/agents/src/lib/content/seo-gate.ts` → `STAGE_B_WEIGHTS`).
 *
 * The 8 Stage-B dimension weights MUST sum to exactly 1.0 and faithfulness MUST
 * carry the strictly greatest weight (no ties) — the confident-but-wrong failure
 * is the costliest (the CNET lesson, PRD §4.4).
 *
 * OQ-3 (NEEDS-INPUT): the final tuned magnitudes are pending the Q3 tech-spike.
 * Only the *invariant* (sum === 1.0, faithfulness strictly max) is fixed; the
 * exact values here are swappable without touching the gate logic.
 *
 * Pure constants — no LLM, no network, no Next APIs. Clean ASCII / UTF-8.
 */

/**
 * The 8 Stage-B dimension weights. They MUST sum to exactly 1.0 and
 * faithfulness MUST carry the strictly greatest weight (no ties).
 */
export const STAGE_B_WEIGHTS = {
  readability: 0.1,
  keyword: 0.1,
  structure: 0.1,
  faithfulness: 0.2,
  voice: 0.15,
  geo: 0.15,
  originality: 0.1,
  eeat: 0.1,
} as const;

/** The 8 Stage-B dimension keys (stable order mirrors `STAGE_B_WEIGHTS`). */
export type StageBDimension = keyof typeof STAGE_B_WEIGHTS;
