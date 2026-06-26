/**
 * revise-cap — the N=3 self-revision ceiling for the SEO Copywriter chain
 * (PR 014 / P1.W.1, lane worker-runtime).
 *
 * THE LOOP THIS BOUNDS. The full chain self-revises: when `seo-audit` returns a
 * `REVISE` verdict, the auditor sends the piece back (`review -> draft`, the FSM's
 * revise edge) and the writer regenerates against the failure codes. Left
 * unbounded this is an infinite loop — a cheap model that can never clear the gate
 * burns credits forever and never surfaces to a human.
 *
 * THE CAP (acceptance #3). At most N=3 self-revises are permitted. The 4th
 * consecutive `REVISE` is NOT taken as another `review -> draft`; instead the
 * piece is HELD at `review`, flagged `forcedToHumanReview`, and the loop STOPS.
 * The decision is deterministic and pure (no I/O, no LLM, no DB) so it is
 * exhaustively unit-testable, and it can never loop infinitely: the revise count
 * monotonically increases and the (N+1)th revise always force-routes to a human.
 *
 * WHY A SEPARATE MODULE (not the FSM). `lifecycle-fsm` is the data-layer authority
 * on which transitions are *structurally legal* (it knows `review -> draft` is a
 * legal revise edge). It deliberately holds no run state — it is pure over a
 * single transition. The revise *budget* is per-run loop state, owned by the
 * worker, so the cap lives here and CONSULTS the FSM for legality rather than
 * duplicating it. A force-routed hold is the legal "stay at review" no-op (the FSM
 * never transitions out of review on a forced hold), so this module never mints an
 * illegal transition.
 *
 * Clean ASCII / UTF-8.
 */

import {
  canTransition,
  type LifecycleState,
  type TransitionContext,
  type Verdict,
} from "@sagemark/core";

// ── The cap ─────────────────────────────────────────────────────────────────────

/**
 * The maximum number of self-revises before the piece is force-routed to a human.
 * N=3: revises #1, #2, #3 are taken (the writer regenerates); the 4th `REVISE`
 * verdict force-routes to human review instead of looping again.
 */
export const MAX_REVISES = 3 as const;

// ── The next-step decision ───────────────────────────────────────────────────────

/** What the loop should do next after an audit verdict. */
export type ReviseAction =
  /** Take the revise edge (review -> draft); the writer regenerates. */
  | "revise"
  /** Hold at review, flagged for a human; the loop stops (cap reached). */
  | "forcedToHumanReview"
  /** A non-REVISE verdict: the revise loop does not apply (audit/publish proceeds). */
  | "noRevise";

/**
 * The decision the revise-cap returns. `forcedToHumanReview` is the load-bearing
 * flag (acceptance #3): when true the piece is held at `review` for a human and
 * the loop MUST stop. `nextRevisionNumber` is the count AFTER this decision (so
 * the caller persists the new budget); on a forced hold it is clamped at the cap.
 */
export interface ReviseDecision {
  action: ReviseAction;
  /** True only when the cap was hit and the piece is held at review for a human. */
  forcedToHumanReview: boolean;
  /** The lifecycle state the piece lands in after this decision. */
  nextState: LifecycleState;
  /** The revise count after applying this decision (persist as the new budget). */
  nextRevisionNumber: number;
  /** A stable machine reason (never prose) for the decision. */
  reason: ReviseReason;
}

export type ReviseReason =
  /** The verdict was not REVISE — the revise loop does not engage. */
  | "NOT_A_REVISE"
  /** A revise within budget was taken (review -> draft). */
  | "REVISE_WITHIN_CAP"
  /** The cap was reached — held at review for a human. */
  | "REVISE_CAP_REACHED"
  /** The FSM rejected the revise edge — held at review, surfaced to a human. */
  | "REVISE_EDGE_ILLEGAL";

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface ReviseCapInput {
  /** The audit verdict that just came back. */
  verdict: Verdict;
  /**
   * How many self-revises have ALREADY been taken for this piece (the persisted
   * budget). 0 on the first audit; incremented each time a revise edge is taken.
   */
  revisionCount: number;
  /**
   * The current lifecycle state (the piece is at `review` right after an audit).
   * Used to consult the FSM for revise-edge legality. Defaults to `review`.
   */
  currentState?: LifecycleState;
  /**
   * The transition context the FSM needs to confirm the `review -> draft` revise
   * edge is legal. Optional: the revise edge carries no extra guard in the FSM, so
   * a minimal context is synthesized when omitted.
   */
  transitionContext?: TransitionContext;
  /** The cap (defaults to `MAX_REVISES`). Injectable for tests. */
  maxRevises?: number;
}

// ── The decision ─────────────────────────────────────────────────────────────────

/**
 * Decide the next loop step for an audit verdict under the N=3 revise cap.
 *
 *   - Non-REVISE verdict        -> `noRevise` (audit/publish proceeds; cap unused).
 *   - REVISE, count < cap       -> `revise` (review -> draft; count incremented).
 *   - REVISE, count >= cap      -> `forcedToHumanReview` (held at review; STOP).
 *   - REVISE but FSM rejects the
 *     review -> draft edge        -> `forcedToHumanReview` (held at review; STOP).
 *
 * Pure + total: returns a decision for every input. The (count >= cap) branch is
 * what guarantees termination — once `revisionCount` reaches the cap, no further
 * revise edge is ever taken, so the loop cannot run forever.
 */
export function decideRevise(input: ReviseCapInput): ReviseDecision {
  const cap = input.maxRevises ?? MAX_REVISES;
  const currentState: LifecycleState = input.currentState ?? "review";
  const count = input.revisionCount;

  // A non-REVISE verdict does not engage the revise loop at all.
  if (input.verdict !== "REVISE") {
    return {
      action: "noRevise",
      forcedToHumanReview: false,
      nextState: currentState,
      nextRevisionNumber: count,
      reason: "NOT_A_REVISE",
    };
  }

  // The cap: revises #1..#cap are taken; the (cap+1)th REVISE force-routes.
  if (count >= cap) {
    return {
      action: "forcedToHumanReview",
      forcedToHumanReview: true,
      // Held at review for a human — NOT transitioned back to draft.
      nextState: "review",
      // Clamp at the cap (the budget is exhausted; do not run past it).
      nextRevisionNumber: cap,
      reason: "REVISE_CAP_REACHED",
    };
  }

  // Within budget: confirm the FSM permits the review -> draft revise edge before
  // taking it. The revise edge carries no extra guard, so a minimal context
  // suffices when the caller did not supply one.
  const ctx: TransitionContext =
    input.transitionContext ??
    ({
      verdict: input.verdict,
      evalRan: true,
      isYmyl: false,
      publishEnabled: false,
    } satisfies TransitionContext);

  const decision = canTransition(currentState, "draft", ctx);
  if (!decision.allowed) {
    // The FSM rejected the revise edge — do not force a regenerate; hold at review
    // and surface to a human (fail-safe; never loop on an illegal transition).
    return {
      action: "forcedToHumanReview",
      forcedToHumanReview: true,
      nextState: "review",
      nextRevisionNumber: count,
      reason: "REVISE_EDGE_ILLEGAL",
    };
  }

  return {
    action: "revise",
    forcedToHumanReview: false,
    nextState: "draft",
    nextRevisionNumber: count + 1,
    reason: "REVISE_WITHIN_CAP",
  };
}

/**
 * Drive the revise loop to a terminal decision over a SEQUENCE of audit verdicts.
 * Returns the per-step decisions plus the final forced-hold flag. This is the
 * deterministic, no-I/O model of the whole loop — the worker uses `decideRevise`
 * per turn; this helper proves the loop terminates (a run of all-`REVISE` verdicts
 * always ends in `forcedToHumanReview` within `cap + 1` steps).
 *
 * Guards against an unbounded caller too: it stops at the first
 * `forcedToHumanReview` OR `noRevise`, and hard-caps the iteration at
 * `cap + 1` steps so a malformed verdict stream can never spin.
 */
export function runReviseLoop(
  verdicts: readonly Verdict[],
  opts?: { maxRevises?: number; transitionContext?: TransitionContext },
): { decisions: ReviseDecision[]; forcedToHumanReview: boolean } {
  const cap = opts?.maxRevises ?? MAX_REVISES;
  const decisions: ReviseDecision[] = [];
  let count = 0;
  // The loop can take at most `cap` revises, then one forced hold -> cap + 1 steps.
  const hardStop = cap + 1;

  for (let i = 0; i < verdicts.length && decisions.length < hardStop; i++) {
    const verdict = verdicts[i];
    if (verdict === undefined) break; // unreachable (i < length) — satisfies noUncheckedIndexedAccess
    const decision = decideRevise({
      verdict,
      revisionCount: count,
      maxRevises: cap,
      transitionContext: opts?.transitionContext,
    });
    decisions.push(decision);
    count = decision.nextRevisionNumber;
    if (decision.action === "forcedToHumanReview" || decision.action === "noRevise") {
      break;
    }
  }

  const last = decisions[decisions.length - 1];
  return {
    decisions,
    forcedToHumanReview: !!last && last.forcedToHumanReview,
  };
}
