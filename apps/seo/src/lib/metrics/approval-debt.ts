/**
 * approval-debt — the per-client approval-cycle-time + open-thread ("approval
 * debt") KPI (PR 019 / P1.C.2, lane client-review).
 *
 * TWO METRICS, PER CLIENT:
 *
 *   1. APPROVAL-CYCLE TIME — how long each sign-off act took, computed from paired
 *      lifecycle milestones:
 *        - the CLIENT advisory cycle: `link_sent` → `client_signoff` (how long the
 *          client took to respond after the review link went out);
 *        - the CREDENTIALED-RELEASE cycle: `draft_review` → `credentialed_release`
 *          (how long the credentialed reviewer took after the piece entered review).
 *      Each cycle is paired PER PIECE: the FIRST `link_sent` to the FIRST following
 *      `client_signoff`, and the FIRST `draft_review` to the FIRST following
 *      `credentialed_release`. Unpaired starts (no terminal event yet) are OPEN
 *      cycles — counted, but contribute no duration.
 *
 *   2. APPROVAL DEBT — the count of OPEN `request-changes` comment threads across
 *      the client's pieces. An open change request is unresolved review work; the
 *      operator panel surfaces it as the client's "debt".
 *
 * PURE: given the events + threads (read at the seam, scoped by the BOUND client),
 * this computes the rollup with no I/O. Fully unit-testable. Clean ASCII / UTF-8.
 */

import type {
  PersistedApprovalEvent,
  PersistedCommentThread,
} from "@/lib/content/context";

/** The recognized approval-cycle milestone kinds. */
export const APPROVAL_EVENT_KINDS = {
  /** The tokenized review link was sent to the client (starts the advisory cycle). */
  linkSent: "link_sent",
  /** A `client_signoffs` row was written (ends the advisory cycle). */
  clientSignoff: "client_signoff",
  /** The piece entered `review` (starts the credentialed-release cycle). */
  draftReview: "draft_review",
  /** A `credentialed_releases` row was written (ends the credentialed cycle). */
  credentialedRelease: "credentialed_release",
} as const;

/** A single computed cycle (one start→end pairing for one piece). */
export interface ApprovalCycle {
  pieceId: string;
  /** "client" (link_sent→client_signoff) or "credentialed" (draft_review→credentialed_release). */
  kind: "client" | "credentialed";
  /** Milliseconds start→end, or null when the cycle is still OPEN (no terminal event). */
  durationMs: number | null;
}

/** The per-client approval-debt rollup the operator panel renders. */
export interface ApprovalDebt {
  clientId: string;
  /** Open `request-changes` threads across the client's pieces (the "debt"). */
  openThreadCount: number;
  /** Every paired/open cycle (per piece, per kind). */
  cycles: ApprovalCycle[];
  /** Count of CLOSED client-advisory cycles (link_sent→client_signoff). */
  closedClientCycles: number;
  /** Count of CLOSED credentialed-release cycles (draft_review→credentialed_release). */
  closedCredentialedCycles: number;
  /** Mean duration (ms) of CLOSED cycles, or null when none are closed. */
  meanCycleMs: number | null;
  /** Count of OPEN cycles (a start with no terminal event yet). */
  openCycleCount: number;
}

function ms(at: string): number | null {
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Pair the FIRST `start` event with the FIRST `end` event that occurs at or after
 * it, per piece. Returns a cycle with `durationMs` when paired, or an OPEN cycle
 * (`durationMs: null`) when a start exists with no following end. Events with an
 * unparseable timestamp are ignored (fail-closed: never a negative/NaN duration).
 */
function pairCycle(
  pieceId: string,
  kind: ApprovalCycle["kind"],
  events: PersistedApprovalEvent[],
  startKind: string,
  endKind: string,
): ApprovalCycle | null {
  const starts = events
    .filter((e) => e.kind === startKind)
    .map((e) => ms(e.at))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  if (starts.length === 0) return null;
  const start = starts[0]!;

  const ends = events
    .filter((e) => e.kind === endKind)
    .map((e) => ms(e.at))
    .filter((t): t is number => t !== null && t >= start)
    .sort((a, b) => a - b);

  if (ends.length === 0) {
    return { pieceId, kind, durationMs: null }; // OPEN cycle
  }
  return { pieceId, kind, durationMs: ends[0]! - start };
}

/**
 * Compute the per-client approval-debt rollup from the client's approval events
 * (grouped per piece by the caller / the seam) + the client's comment threads.
 *
 * @param clientId  the BOUND client id (the rollup is scoped to it).
 * @param eventsByPiece  approval events grouped by pieceId (each list is one
 *   piece's events). Pairing is per piece so cycles never cross pieces.
 * @param threads  the client's comment threads (the open request-changes count).
 */
export function computeApprovalDebt(
  clientId: string,
  eventsByPiece: Record<string, PersistedApprovalEvent[]>,
  threads: PersistedCommentThread[],
): ApprovalDebt {
  const cycles: ApprovalCycle[] = [];

  for (const [pieceId, events] of Object.entries(eventsByPiece)) {
    const clientCycle = pairCycle(
      pieceId,
      "client",
      events,
      APPROVAL_EVENT_KINDS.linkSent,
      APPROVAL_EVENT_KINDS.clientSignoff,
    );
    if (clientCycle) cycles.push(clientCycle);

    const credCycle = pairCycle(
      pieceId,
      "credentialed",
      events,
      APPROVAL_EVENT_KINDS.draftReview,
      APPROVAL_EVENT_KINDS.credentialedRelease,
    );
    if (credCycle) cycles.push(credCycle);
  }

  const closed = cycles.filter((c) => c.durationMs !== null);
  const closedClientCycles = closed.filter((c) => c.kind === "client").length;
  const closedCredentialedCycles = closed.filter((c) => c.kind === "credentialed").length;
  const openCycleCount = cycles.length - closed.length;
  const meanCycleMs =
    closed.length > 0
      ? Math.round(closed.reduce((s, c) => s + (c.durationMs ?? 0), 0) / closed.length)
      : null;

  const openThreadCount = threads.filter(
    (t) => t.kind === "request-changes" && t.status === "open",
  ).length;

  return {
    clientId,
    openThreadCount,
    cycles,
    closedClientCycles,
    closedCredentialedCycles,
    meanCycleMs,
    openCycleCount,
  };
}
