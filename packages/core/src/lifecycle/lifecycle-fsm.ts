/**
 * lifecycle-fsm — the content-piece lifecycle state machine.
 *
 * Ported from flywheel-main `origin/preview`
 * (`apps/agents/src/lib/content/lifecycle-fsm.ts`, PR 003 port) into host-side
 * `@sagemark/core`.
 *
 * THE PUBLISH GATE THE PRODUCT EXISTS TO PROTECT. This module is the data-layer
 * authority on which lifecycle transitions are legal. It is PURE (no I/O, no
 * Next APIs, no LLM, no DB) so it can be exhaustively unit-tested over the full
 * transition table — every legal AND every illegal cell. The audit/publish
 * routes consult it BEFORE any forward write; an illegal transition is rejected
 * here, at the data layer, not merely in a UI.
 *
 * States (PRD §9.1):  draft → review → approved → published → archived
 *
 * Legal transitions (PRD §9.1 table):
 *   (none)    → draft        a draft is stored (handled by the draft route, PR008)
 *   draft     → review       seo-audit ran the gate (snapshot + scorecard persisted)
 *   review    → approved     operator records a release; verdict ∈ {PUBLISH, REVIEW};
 *                            YMYL → named author + credentials + citations present
 *   review    → draft        revise loop (failure codes drive regeneration)
 *   approved  → published    PUBLISH verdict AND recorded human release AND eval ran
 *                            (fail-closed); YMYL also requires byline+credentials+citations
 *   published → review        unpublish (reverts render)
 *   published → archived      unpublish/retire (reverts render)
 *   any       → archived      retire (snapshot retained, not publicly reachable)
 *
 * THE PRIME DIRECTIVE — FAIL CLOSED. The transition into `published` is reachable
 * ONLY when (verdict === 'PUBLISH') AND (a recorded human release exists) AND
 * (the eval actually ran — a scorecard is present and was not skipped/failed). A
 * YMYL piece ADDITIONALLY requires a named author + credentials + authoritative
 * citations. A missing/thrown/skipped eval BLOCKS — never a silent pass (this is
 * the NextSchool non-fatal-publish bug, ER-4). There is NO autopilot: the only
 * path into `published` requires a recorded human release.
 *
 * SCHEMA CONTRACT (P0.S.1). The human-release precondition is satisfied ONLY by
 * a `credentialed_release` (the `@sagemark/schema-flywheel` `credentialed_releases`
 * shape — D6 credentialed reviewer), NEVER by a `client_signoff` (advisory). A
 * `client_signoff`-shaped input is rejected as NO_HUMAN_RELEASE, so an advisory
 * client approval can never satisfy a (YMYL or any) publish release.
 *
 * Clean ASCII / UTF-8.
 */

import type { Verdict } from "../gate/seo-gate";

// ── States ────────────────────────────────────────────────────────────────────

/** The five lifecycle states (mirrors `content_status` enum in schema-flywheel). */
export type LifecycleState =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "archived";

export const LIFECYCLE_STATES: readonly LifecycleState[] = [
  "draft",
  "review",
  "approved",
  "published",
  "archived",
] as const;

// ── Transition context ──────────────────────────────────────────────────────────

/**
 * The byline an E-E-A-T / YMYL piece must carry. Resolved from the persisted
 * `content_pieces.author_id` joined to the voice-spec author registry. A YMYL
 * publish requires a NAMED author with non-empty credentials.
 */
export interface ReleaseAuthor {
  id?: string;
  name?: string;
  credentials?: string;
}

/**
 * A recorded human release — the ONLY artifact that satisfies the human-release
 * precondition into `approved` / `published` (there is no autopilot).
 *
 * SCHEMA CONTRACT (P0.S.1): this is the `@sagemark/schema-flywheel`
 * `credentialed_releases` shape (D6 credentialed reviewer). The discriminant
 * `releaseType: 'credentialed_release'` plus the credential snapshot +
 * authorization id are what distinguish it from the advisory `client_signoff`
 * (which carries `release_type: 'client_signoff'` and structurally NO credential
 * / authorization_id, and can never satisfy this precondition).
 */
export interface CredentialedRelease {
  /** Structurally fixed discriminant — the credentialed-release marker. */
  releaseType: "credentialed_release";
  /** The credentialed reviewer (D6) who released the piece. */
  actorId: string;
  /** Snapshot {name, credentials} at release — the byline evidence. */
  credential: { name?: string; credentials?: string };
  /** FK → byline_authorizations (§11.5): the consent record backing the byline. */
  authorizationId: string;
  /** When the release was recorded (ISO timestamp). */
  releasedAt?: string;
}

/**
 * The advisory client/agency-contact approval. Structurally CANNOT release
 * (no `credential`, no `authorizationId`) — present here only so the type system
 * documents the shape `canPublish()`/`hasRecordedRelease()` must reject. Mirrors
 * the `@sagemark/schema-flywheel` `client_signoffs` row.
 */
export interface ClientSignoff {
  releaseType: "client_signoff";
  actorId: string;
  releasedAt?: string;
}

/**
 * The human-release input the FSM accepts. A `CredentialedRelease` satisfies the
 * precondition; a `ClientSignoff` (or any non-credentialed shape) is rejected as
 * NO_HUMAN_RELEASE. Nullable until a human releases.
 */
export type HumanRelease =
  | CredentialedRelease
  | ClientSignoff
  | null
  | undefined;

/**
 * Everything the FSM needs to evaluate a transition. All fields are read from
 * the PERSISTED `content_pieces` row (never re-derived) so a draft that skipped
 * the brief stage cannot bypass the YMYL vetoes.
 */
export interface TransitionContext {
  /** The gate verdict persisted on the row (null when no audit has run). */
  verdict: Verdict | null;
  /**
   * Whether the eval actually RAN and produced a usable scorecard. False when
   * the audit was never run, threw, timed out, or was skipped. A false value
   * BLOCKS any advance toward `published` (fail-closed).
   */
  evalRan: boolean;
  /**
   * A recorded human release artifact (absent until a human approves). ONLY a
   * `credentialed_release` satisfies the precondition; a `client_signoff` is
   * rejected (SCHEMA CONTRACT P0.S.1).
   */
  humanRelease?: HumanRelease;
  /** YMYL classification, read from the PERSISTED `is_ymyl` column. */
  isYmyl: boolean;
  /** The resolved byline author (for the YMYL byline/credentials check). */
  author?: ReleaseAuthor | null;
  /** Whether the piece carries authoritative citations (YMYL requirement). */
  hasCitations?: boolean;
  /**
   * Global publish kill switch. When false, NO transition into `published` is
   * permitted regardless of any other signal (rollback path — RFC §4 PR009).
   * Default-off is enforced by the route, not here; the FSM only honors it.
   */
  publishEnabled: boolean;
}

// ── Legal transition adjacency (structural legality, before guards) ────────────

/**
 * The structurally-legal forward/lateral edges. A pair NOT in this map is
 * illegal by construction (e.g. draft→published, draft→approved, review→published,
 * approved→review). Guards (verdict/release/eval/YMYL) tighten further on top.
 */
const LEGAL_EDGES: Record<LifecycleState, readonly LifecycleState[]> = {
  draft: ["review", "archived"],
  review: ["approved", "draft", "archived"],
  approved: ["published", "review", "archived"],
  published: ["review", "archived"],
  // Terminal for forward motion; a re-open is out of scope for v1.
  archived: [],
};

/** True when `to` is a structurally-legal successor of `from` (before guards). */
export function isLegalEdge(from: LifecycleState, to: LifecycleState): boolean {
  return LEGAL_EDGES[from]?.includes(to) ?? false;
}

/** Forward moves that REQUIRE a version snapshot be written first (PRD §9.1). */
const FORWARD_MOVES: ReadonlySet<string> = new Set<string>([
  "draft->review",
  "review->approved",
  "approved->published",
]);

/** True when the transition is a forward move that must snapshot before it lands. */
export function requiresSnapshot(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  return FORWARD_MOVES.has(`${from}->${to}`);
}

// ── Guard predicates ───────────────────────────────────────────────────────────

/**
 * A recorded human release exists AND is a `credentialed_release` (SCHEMA
 * CONTRACT P0.S.1). A `client_signoff`-shaped input (or any non-credentialed
 * shape, or a credentialed release with an empty actor) returns false → the
 * caller resolves NO_HUMAN_RELEASE. An advisory client approval can NEVER
 * satisfy the human-release precondition.
 */
export function hasRecordedRelease(release: HumanRelease): boolean {
  return (
    !!release &&
    release.releaseType === "credentialed_release" &&
    typeof release.actorId === "string" &&
    release.actorId.trim().length > 0 &&
    typeof release.authorizationId === "string" &&
    release.authorizationId.trim().length > 0
  );
}

/** A named author with non-empty credentials (the YMYL byline requirement). */
export function hasNamedByline(author: ReleaseAuthor | null | undefined): boolean {
  return (
    !!author &&
    typeof author.name === "string" &&
    author.name.trim().length > 0 &&
    typeof author.credentials === "string" &&
    author.credentials.trim().length > 0
  );
}

/**
 * The publish guard predicate — the load-bearing fail-closed check.
 *
 * `published` is reachable ONLY when ALL hold:
 *   1. the global `publishEnabled` flag is on (off = no publish, fail-safe);
 *   2. verdict === 'PUBLISH';
 *   3. a recorded human release exists (a `credentialed_release`, never a
 *      `client_signoff` — SCHEMA CONTRACT P0.S.1);
 *   4. the eval actually ran (scorecard present, not skipped/failed);
 *   5. (YMYL only) a named author + credentials + authoritative citations.
 *
 * Any missing/false clause BLOCKS. Pure — no I/O.
 */
export function canPublish(ctx: TransitionContext): boolean {
  if (!ctx.publishEnabled) return false; // fail-safe: off = no publish
  if (ctx.verdict !== "PUBLISH") return false;
  if (!ctx.evalRan) return false; // fail-closed: a gate that did not run says no
  if (!hasRecordedRelease(ctx.humanRelease)) return false; // no autopilot / no client_signoff
  if (ctx.isYmyl) {
    // Tier-4: named author + credentials + authoritative citations, all required.
    if (!hasNamedByline(ctx.author)) return false;
    if (ctx.hasCitations !== true) return false;
  }
  return true;
}

/**
 * The approve guard predicate (review → approved). A release is recorded and the
 * verdict is at least REVIEW-grade (∈ {PUBLISH, REVIEW}); a REVISE/REJECT verdict
 * cannot be approved. YMYL additionally requires the named byline + credentials +
 * citations even at the approve step (so the publish step is never the first to
 * surface a missing byline). The eval must have run.
 */
export function canApprove(ctx: TransitionContext): boolean {
  if (!ctx.evalRan) return false;
  if (ctx.verdict !== "PUBLISH" && ctx.verdict !== "REVIEW") return false;
  if (!hasRecordedRelease(ctx.humanRelease)) return false;
  if (ctx.isYmyl) {
    if (!hasNamedByline(ctx.author)) return false;
    if (ctx.hasCitations !== true) return false;
  }
  return true;
}

// ── The transition decision ────────────────────────────────────────────────────

export interface TransitionDecision {
  allowed: boolean;
  /** A stable machine reason (never prose) when rejected. */
  reason?: TransitionRejection;
}

export type TransitionRejection =
  | "ILLEGAL_EDGE"
  | "PUBLISH_DISABLED"
  | "NOT_PUBLISH_VERDICT"
  | "NO_HUMAN_RELEASE"
  | "EVAL_DID_NOT_RUN"
  | "YMYL_NO_BYLINE"
  | "YMYL_NO_CITATIONS"
  | "VERDICT_NOT_APPROVABLE";

/**
 * Decide whether `from → to` is permitted under `ctx`. Pure + total: returns a
 * decision for every state pair (illegal edges resolve to ILLEGAL_EDGE). This is
 * the single authority the routes consult before any forward write.
 */
export function canTransition(
  from: LifecycleState,
  to: LifecycleState,
  ctx: TransitionContext,
): TransitionDecision {
  // Structural legality first — an edge not in the adjacency map is illegal.
  if (!isLegalEdge(from, to)) {
    return { allowed: false, reason: "ILLEGAL_EDGE" };
  }

  // The publish transition — the fail-closed gate.
  if (to === "published") {
    if (!ctx.publishEnabled) {
      return { allowed: false, reason: "PUBLISH_DISABLED" };
    }
    if (!ctx.evalRan) {
      return { allowed: false, reason: "EVAL_DID_NOT_RUN" };
    }
    if (ctx.verdict !== "PUBLISH") {
      return { allowed: false, reason: "NOT_PUBLISH_VERDICT" };
    }
    if (!hasRecordedRelease(ctx.humanRelease)) {
      return { allowed: false, reason: "NO_HUMAN_RELEASE" };
    }
    if (ctx.isYmyl) {
      if (!hasNamedByline(ctx.author)) {
        return { allowed: false, reason: "YMYL_NO_BYLINE" };
      }
      if (ctx.hasCitations !== true) {
        return { allowed: false, reason: "YMYL_NO_CITATIONS" };
      }
    }
    return { allowed: true };
  }

  // The approve transition — release + approvable verdict (+ YMYL byline).
  if (from === "review" && to === "approved") {
    if (!ctx.evalRan) {
      return { allowed: false, reason: "EVAL_DID_NOT_RUN" };
    }
    if (ctx.verdict !== "PUBLISH" && ctx.verdict !== "REVIEW") {
      return { allowed: false, reason: "VERDICT_NOT_APPROVABLE" };
    }
    if (!hasRecordedRelease(ctx.humanRelease)) {
      return { allowed: false, reason: "NO_HUMAN_RELEASE" };
    }
    if (ctx.isYmyl) {
      if (!hasNamedByline(ctx.author)) {
        return { allowed: false, reason: "YMYL_NO_BYLINE" };
      }
      if (ctx.hasCitations !== true) {
        return { allowed: false, reason: "YMYL_NO_CITATIONS" };
      }
    }
    return { allowed: true };
  }

  // draft→review (audit), review→draft (revise), and any →archived / published→review
  // are legal by edge with no further guard here (the audit route guarantees the
  // snapshot+scorecard for draft→review; archive/unpublish are reversible Tier-2).
  return { allowed: true };
}

/** Thrown by `assertTransition` when a transition is rejected. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly from: LifecycleState,
    readonly to: LifecycleState,
    readonly rejection: TransitionRejection,
  ) {
    super(`illegal transition ${from} -> ${to}: ${rejection}`);
    this.name = "IllegalTransitionError";
  }
}

/**
 * Assert a transition is legal; throw `IllegalTransitionError` otherwise. The
 * routes call this immediately before persisting a forward move so an illegal
 * transition can never reach the data layer.
 */
export function assertTransition(
  from: LifecycleState,
  to: LifecycleState,
  ctx: TransitionContext,
): void {
  const decision = canTransition(from, to, ctx);
  if (!decision.allowed) {
    throw new IllegalTransitionError(from, to, decision.reason ?? "ILLEGAL_EDGE");
  }
}
