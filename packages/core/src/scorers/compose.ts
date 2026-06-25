/**
 * Fail-closed scorer composition.
 *
 * The deterministic scorers are pure and normally do not throw, but the gate's
 * safety contract (RFC §1, PRD §9.x) is **fail-closed**: if a scorer ever does
 * throw (a bug, an unexpected input, an OOM), the gate must surface a VETO —
 * never silently treat the missing score as a pass. A swallowed scorer error
 * that defaulted to "ok" would let unscored content slip through the gate,
 * which is the exact failure mode the moat exists to prevent.
 *
 * {@link runScorersFailClosed} runs a set of named scorer thunks and, the
 * instant one throws, short-circuits to a `passed: false` veto carrying the
 * offending scorer's name and the error message. The downstream gate composer
 * (PR 003 `seo-gate`) consumes this result: a `VETO_SCORER_THREW` is a hard
 * block, identical in effect to any other Stage-A veto.
 *
 * This is the host-side backstop that makes "a thrown scorer is a veto, not a
 * silent pass" an enforced property rather than a convention.
 */

/** Stable veto code emitted when a composed scorer throws. */
export const VETO_SCORER_THREW = "VETO_SCORER_THREW" as const;

/** One named scorer to run as part of a composition. `run` may throw. */
export interface NamedScorer<T = unknown> {
  name: string;
  run: () => T;
}

export type ScorerCompositionResult<T = unknown> =
  | {
      /** Every scorer ran without throwing. */
      passed: true;
      results: Array<{ name: string; result: T }>;
    }
  | {
      /** A scorer threw — fail-closed veto. */
      passed: false;
      failureCode: typeof VETO_SCORER_THREW;
      /** Which scorer threw. */
      scorer: string;
      /** The thrown error's message (never the scored content — PII rule). */
      reason: string;
    };

/**
 * Run `scorers` in order. If any scorer's `run()` throws, short-circuit to a
 * fail-closed veto ({@link VETO_SCORER_THREW}) naming the offending scorer.
 * A throw is NEVER swallowed into a passing result.
 *
 * @returns `{ passed: true, results }` only if every scorer ran cleanly;
 *          otherwise `{ passed: false, failureCode: VETO_SCORER_THREW, ... }`.
 */
export function runScorersFailClosed<T = unknown>(
  scorers: Array<NamedScorer<T>>,
): ScorerCompositionResult<T> {
  const results: Array<{ name: string; result: T }> = [];

  for (const scorer of scorers) {
    let result: T;
    try {
      result = scorer.run();
    } catch (err) {
      // Fail-closed: a thrown scorer is a hard veto, never a silent pass.
      return {
        passed: false,
        failureCode: VETO_SCORER_THREW,
        scorer: scorer.name,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    results.push({ name: scorer.name, result });
  }

  return { passed: true, results };
}
