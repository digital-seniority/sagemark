/**
 * failure-codes — the fixed failure-code taxonomy for the SEO non-compensatory
 * gate (`seo-gate.ts`).
 *
 * Ported verbatim from flywheel-main `origin/preview`
 * (`apps/agents/src/lib/content/failure-codes.ts`, PR 003 port) into host-side
 * `@sagemark/core`, with two anchor-mandated deltas (engineering-rfc.md §PR 003):
 *
 *   1. `VETO_YMYL_NO_REVIEW` is REMOVED from the Stage-A taxonomy. The Stage-A
 *      set (draft→review eligibility) checks byline *presence* + faithfulness
 *      only — requiring a recorded review to enter `review` is circular. The
 *      credentialed-reviewer release is enforced in `canPublish()` on
 *      `review→approved` (the `NO_HUMAN_RELEASE` precondition in
 *      `lifecycle-fsm.ts`), never as a Stage-A veto.
 *   2. `VETO_YMYL_MISCLASSIFIED` is ADDED — the YMYL false-negative guard. It
 *      fires when the body-level `ymylSignals` detector finds medical-claim
 *      signals in a piece whose `is_ymyl=false`, so a misclassified piece can
 *      neither reach Stage B nor dodge the YMYL byline veto.
 *
 * Stable codes ONLY — never raw judge prose. The codes (not free text) are what
 * drive any downstream regeneration loop, so we never feed model prose back into
 * generation (PRD §4.4).
 *
 * Two families:
 *   - VETO_*  — Stage-A hard vetoes. Any one short-circuits the gate to
 *               REJECT/REVISE with NO composite (score === null).
 *   - DIM_*   — Stage-B dimension-miss markers. Informational; they annotate a
 *               weak dimension in a composite-scored draft but never short-circuit.
 *
 * Pure constants — no LLM, no network, no Next APIs. Clean ASCII / UTF-8.
 */

// ── Stage-A hard vetoes (non-compensatory; short-circuit) ─────────────────────

export const VETO_CODES = {
  /** Heading-less / context-orphaned section not liftable as a standalone answer. */
  VETO_BROKEN_CHUNK: "VETO_BROKEN_CHUNK",
  /** A statistic/quote not traced to a supplied or attributed source (UNSOURCED/CONTRADICTED). */
  VETO_UNSOURCED_STAT: "VETO_UNSOURCED_STAT",
  /** Keyword density > 4% / unnatural repetition (single source of truth: keyword-density status==='stuffed'). */
  VETO_KEYWORD_STUFF: "VETO_KEYWORD_STUFF",
  /**
   * YMYL false-negative guard — body-level medical-claim signals were detected
   * in a piece whose `is_ymyl=false`. A misclassified piece is bounced back so
   * it cannot reach Stage B or dodge the YMYL byline veto. (Net-new vs. source;
   * engineering-rfc.md §PR 003 criterion 2.)
   */
  VETO_YMYL_MISCLASSIFIED: "VETO_YMYL_MISCLASSIFIED",
  /** YMYL piece missing a named author / credentials / authoritative byline. */
  VETO_YMYL_NO_BYLINE: "VETO_YMYL_NO_BYLINE",
  /** Near-duplicate / thin content (scaled-content-abuse defense). */
  VETO_THIN_CONTENT: "VETO_THIN_CONTENT",
  /** Prohibited terms or anti-AI-slop phrasing per the client voice spec. */
  VETO_BANNED_LEXICON: "VETO_BANNED_LEXICON",
  /** Voice gate returned FAIL (brand-voice contradiction). */
  VETO_VOICE_FAIL: "VETO_VOICE_FAIL",
  /** A deterministic scorer threw or timed out — gate fails closed (fixes NextSchool non-fatal-publish). */
  VETO_EVAL_FAILED: "VETO_EVAL_FAILED",
} as const;

// ── Stage-B dimension-miss markers (informational; non-blocking) ──────────────

export const DIMENSION_CODES = {
  DIM_READABILITY_LOW: "DIM_READABILITY_LOW",
  DIM_KEYWORD_LOW: "DIM_KEYWORD_LOW",
  DIM_STRUCTURE_LOW: "DIM_STRUCTURE_LOW",
  DIM_FAITHFULNESS_LOW: "DIM_FAITHFULNESS_LOW",
  DIM_VOICE_LOW: "DIM_VOICE_LOW",
  DIM_GEO_LOW: "DIM_GEO_LOW",
  DIM_ORIGINALITY_LOW: "DIM_ORIGINALITY_LOW",
  DIM_EEAT_LOW: "DIM_EEAT_LOW",
} as const;

/** The complete fixed taxonomy (vetoes + dimension markers). */
export const FAILURE_CODES = {
  ...VETO_CODES,
  ...DIMENSION_CODES,
} as const;

/** Stable union of every valid failure code. */
export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];

/** A code is a hard veto when it belongs to the VETO_* family. */
export function isVetoCode(code: FailureCode): boolean {
  return Object.prototype.hasOwnProperty.call(VETO_CODES, code);
}
