/**
 * Lock-row CONDITIONAL-UPDATE cost reservation (PR 020 / P1.C.3, lane
 * worker-runtime).
 *
 * THE RACE THIS GUARDS (RFC §668 risk). The classic ledger bug is
 * sum-then-check: read SUM(reserved_usd) for a run, compare to the cap in
 * application code, then INSERT a new reservation. Two concurrent runs both read
 * the same pre-spend sum, both see headroom, both insert — and the run is
 * silently OVER the $2 cap. Read-then-write is not atomic.
 *
 * THE GUARD. We reserve with a SINGLE lock-row conditional UPDATE against a
 * per-run accumulator row:
 *
 *     UPDATE seo_cost_run_budget
 *        SET reserved_usd = reserved_usd + $cost
 *      WHERE run_id = $run
 *        AND workspace_id = $ws AND client_id = $client   -- tenancy (service role bypasses RLS)
 *        AND reserved_usd + $cost <= cap_usd               -- the conditional guard
 *  RETURNING reserved_usd;
 *
 * The `WHERE reserved_usd + $cost <= cap_usd` predicate is evaluated by the DB
 * under the row lock the UPDATE takes: the row is read, the predicate checked,
 * and the write applied as ONE atomic, serialized operation. Two concurrent
 * over-cap reservations cannot both match — the second blocks on the row lock,
 * re-reads the (now-incremented) `reserved_usd`, and its predicate is false, so
 * it updates ZERO rows. Zero rows updated ⇒ REJECTED (fail-closed), never a
 * silent over-spend. This is the SAME atomic-update discipline as a SQL
 * `UPDATE ... WHERE balance >= amount` debit.
 *
 * The actual per-stage `seo_cost_ledger` rows (reserved_usd / actual_usd /
 * latency_ms) are the audit trail; THIS module owns the accumulator + the
 * atomic guard. The accumulator is modeled as a `cap`-bearing per-run row; the
 * Tier-1 test uses the deterministic in-memory store below to PROVE the
 * concurrency property (only one of two over-cap reservations wins) without a
 * live Postgres — the store models the exact lock-row-conditional-UPDATE
 * semantics (serialized compare-and-set under the row lock).
 *
 * DR-026 / DR-006: the live pipeline (ContentDataAccess) is not wired; the live
 * accumulator store is a fail-closed NOT_WIRED stub, mirrored by the C.021.2
 * service-role pattern when a live writer lands. The concurrency proof is the
 * load-bearing Tier-1 test against the in-memory store.
 *
 * Clean ASCII / UTF-8. No `console.*`. No `server-only` marker (imported by
 * plain-Node vitest).
 */

import { RUN_COST_CAP_USD } from "@sagemark/core";

/** Float tolerance so summed reservations (e.g. 0.005*n) don't spuriously trip. */
const EPSILON = 1e-9;

/** The bound tenancy + run identity every reservation is scoped by. */
export interface ReservationScope {
  workspaceId: string;
  clientId: string;
  runId: string;
}

/** One pre-flight reservation request. */
export interface ReservationRequest {
  scope: ReservationScope;
  /** USD to reserve for this stage's model call (must be finite, >= 0). */
  costUsd: number;
  /** The pipeline stage label (drafter | verifier | judge | ...). */
  stage: string;
}

/** The discriminated result of an atomic reservation attempt. */
export type ReservationResult =
  | {
      ok: true;
      /** The run's cumulative reserved spend AFTER this reservation. */
      reservedUsd: number;
      /** Remaining headroom under the cap, in USD. */
      remainingUsd: number;
    }
  | {
      ok: false;
      reason: "OVER_CAP" | "INVALID_COST";
      /** What the run's reserved spend WOULD have been (for diagnostics). */
      attemptedUsd: number;
      capUsd: number;
    };

/**
 * The atomic reservation seam. `reserve` MUST be implemented as a lock-row
 * conditional UPDATE (the live impl) or a serialized compare-and-set (the
 * in-memory test impl) — NEVER a read-sum-then-write. A reservation that would
 * push the run over `capUsd` updates ZERO rows ⇒ `{ ok:false, OVER_CAP }`.
 */
export interface ReservationStore {
  reserve(req: ReservationRequest): Promise<ReservationResult>;
}

/**
 * Validate a reservation cost. A non-finite / negative cost is a programming
 * error, not an over-cap — reject it distinctly (fail-closed, never reserve).
 */
function validateCost(costUsd: number, capUsd: number): ReservationResult | null {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    return { ok: false, reason: "INVALID_COST", attemptedUsd: costUsd, capUsd };
  }
  return null;
}

/**
 * An in-memory `ReservationStore` that models the EXACT lock-row
 * conditional-UPDATE semantics, used by the Tier-1 concurrency test (no live
 * Postgres). Per `runId` it holds a single accumulator; `reserve` is an
 * `async` method whose compare-and-set is SERIALIZED through a per-run promise
 * chain — the JS analogue of the DB row lock the `UPDATE ... WHERE
 * reserved + cost <= cap` takes. Because the read-compare-write of the
 * accumulator runs to completion before the next queued reservation observes
 * it, two concurrent over-cap reservations can NEVER both succeed: the second
 * sees the first's increment and its guard fails (zero rows updated → OVER_CAP).
 *
 * This is deterministic and load-bearing: it is the structural proof of the
 * acceptance criterion (a concurrent over-cap run is REJECTED, not over-spent).
 */
export class InMemoryReservationStore implements ReservationStore {
  private readonly capUsd: number;
  /** Per-run cumulative reserved spend (the accumulator the UPDATE locks). */
  private readonly reserved = new Map<string, number>();
  /** Per-run serialization tail — the JS stand-in for the row lock. */
  private readonly lockTail = new Map<string, Promise<unknown>>();

  constructor(capUsd: number = RUN_COST_CAP_USD) {
    this.capUsd = capUsd;
  }

  /** Total reserved so far for a run (test/diagnostic read). */
  reservedFor(runId: string): number {
    return this.reserved.get(runId) ?? 0;
  }

  reserve(req: ReservationRequest): Promise<ReservationResult> {
    const invalid = validateCost(req.costUsd, this.capUsd);
    if (invalid) return Promise.resolve(invalid);

    const key = req.scope.runId;
    // Serialize this run's reservations through its lock tail: the critical
    // section (read accumulator → check guard → write) runs atomically w.r.t.
    // every other reservation for the same run, exactly as the DB row lock
    // serializes `UPDATE ... WHERE reserved + cost <= cap` on one row.
    const prior = this.lockTail.get(key) ?? Promise.resolve();
    const next = prior.then(() => this.criticalSection(req));
    // Keep the chain alive even if a reservation rejects (a rejection still
    // releases the lock for the next waiter — zero rows updated, no throw).
    this.lockTail.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  /** The locked read-compare-write — runs to completion before the next waiter. */
  private async criticalSection(
    req: ReservationRequest,
  ): Promise<ReservationResult> {
    const key = req.scope.runId;
    const current = this.reserved.get(key) ?? 0;
    const attempted = current + req.costUsd;
    // The conditional-UPDATE guard: `reserved_usd + cost <= cap_usd`.
    if (attempted > this.capUsd + EPSILON) {
      // Zero rows updated → REJECTED. The accumulator is UNCHANGED (no over-spend).
      return { ok: false, reason: "OVER_CAP", attemptedUsd: attempted, capUsd: this.capUsd };
    }
    this.reserved.set(key, attempted);
    return {
      ok: true,
      reservedUsd: attempted,
      remainingUsd: this.capUsd - attempted,
    };
  }
}

/**
 * The SQL the LIVE service-role store runs (documented here so the test asserts
 * the shape, and the live impl copies it verbatim). It is a lock-row conditional
 * UPDATE — the `reserved_usd + $cost <= cap_usd` predicate is the atomic guard,
 * NOT a separate sum-then-check. EVERY query carries explicit workspace_id +
 * client_id (service role bypasses RLS — the app filter IS the tenancy boundary).
 *
 * The accumulator row is upserted at run start with the run's cap; this UPDATE
 * is the per-stage reservation. A reservation that would exceed the cap matches
 * ZERO rows (RETURNING is empty) ⇒ OVER_CAP rejection.
 */
export const RESERVE_CONDITIONAL_SQL = `
UPDATE public.seo_cost_run_budget
   SET reserved_usd = reserved_usd + $1
 WHERE run_id = $2
   AND workspace_id = $3
   AND client_id = $4
   AND reserved_usd + $1 <= cap_usd
RETURNING reserved_usd, cap_usd
`.trim();

/**
 * Fail-closed live store (DR-026): the live conditional-UPDATE accumulator is
 * not wired in this build. Throws loudly rather than silently succeeding — a
 * caller that reaches the DB without an injected store fails closed. Swapped for
 * the C.021.2 service-role impl when the live ledger writer lands; injected with
 * `InMemoryReservationStore` in tests.
 */
export const NOT_WIRED_RESERVATION_STORE: ReservationStore = {
  reserve: () => {
    throw new ReservationStoreNotWiredError();
  },
};

class ReservationStoreNotWiredError extends Error {
  readonly code = "RESERVATION_STORE_NOT_WIRED" as const;
  constructor() {
    super(
      "cost reservation store is not wired: no live service-role accumulator in " +
        "this build (DR-026/DR-006). Inject a ReservationStore (the live " +
        "conditional-UPDATE impl or InMemoryReservationStore in tests).",
    );
    this.name = "ReservationStoreNotWiredError";
  }
}

export { ReservationStoreNotWiredError };
