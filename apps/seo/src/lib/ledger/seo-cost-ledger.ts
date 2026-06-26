/**
 * The SEPARATE SEO AI-Gateway cost ledger (D4) — per-stage cost/latency recorded
 * from Gateway-reported usage, and per-run reconciliation against that usage
 * (PR 020 / P1.C.3, lane worker-runtime).
 *
 * WHAT THIS OWNS.
 *   1. The pre-flight RESERVATION → record path: a stage reserves cost via the
 *      lock-row conditional UPDATE (`reserve-conditional.ts`), then — once the
 *      Gateway call returns — writes the ACTUAL usd + latency_ms + model onto a
 *      `seo_cost_ledger` row (reconciled, never estimated).
 *   2. The per-run RECONCILIATION (acceptance: per-run-reconciliation): the
 *      ledger's per-`run_id` records must reconcile against the Gateway-reported
 *      usage for that run, within tolerance; an unreconciled gap FAILS the check
 *      (a billing invariant — a missing/extra charge is a leak).
 *   3. The measured per-piece cost vs the ≤$2 editorial target (RFC §1): the
 *      SUM of actual_usd over a run, compared to RUN_COST_CAP_USD — MEASURED
 *      from ledger rows, not estimated.
 *
 * GATEWAY-ONLY (DR-013, C.022.3 done). The gate path already forces
 * `resolveGatewayModel(..., { forceGateway: true })` — every metered model call
 * routes through the Gateway, so the `actual_usd` we reconcile is the
 * Gateway-reported number. This module does NOT reintroduce a raw provider path;
 * a `model` recorded here is always a Gateway model id. Gateway-disabled ⇒ no
 * model call ⇒ no usage to record (the in-process backstop is the resolver's
 * worker-invariant refusal + the egress allowlist; this ledger never fabricates
 * a usage row for a call that did not happen).
 *
 * TENANCY (DR-026 service-role pattern, mirrors image-resolver.ts). The live
 * writer is a service-role client (service role bypasses RLS), so EVERY write
 * carries an explicit workspace_id + client_id; the ledger row's tenancy is the
 * bound `(workspaceId, clientId)`, never request input. The live writer is a
 * fail-closed NOT_WIRED stub here (DR-026); the in-memory writer below backs the
 * Tier-1 reconciliation test deterministically.
 *
 * Clean ASCII / UTF-8. No `console.*`. No `server-only` marker (imported by
 * plain-Node vitest).
 */

import { RUN_COST_CAP_USD } from "@sagemark/core";
import type { ReservationScope } from "./reserve-conditional";

/** The Gateway-reported usage for one completed model call. */
export interface GatewayUsage {
  /** The metered USD the Gateway billed this call (the authoritative actual). */
  actualUsd: number;
  /** The Gateway model id the call resolved to (always a Gateway id, DR-013). */
  model: string;
  /** Wall-clock latency of the call, ms. */
  latencyMs: number;
}

/** A persisted per-stage ledger row projection (the audit/reconcile read shape). */
export interface SeoCostLedgerRecord {
  scope: ReservationScope;
  pieceId: string | null;
  stage: string;
  /** Reserved pre-flight (the cap reservation). */
  reservedUsd: number;
  /** Gateway-reported actual (null until reconciled). */
  actualUsd: number | null;
  model: string | null;
  latencyMs: number | null;
}

/** The payload that records a completed stage's measured cost onto its row. */
export interface RecordStagePayload {
  scope: ReservationScope;
  pieceId: string | null;
  stage: string;
  /** What was reserved pre-flight for this stage. */
  reservedUsd: number;
  /** The Gateway-reported usage once the call returned. */
  usage: GatewayUsage;
}

/**
 * The ledger writer/reader seam. The live impl is a service-role client (every
 * query carries workspace_id + client_id); tests inject the in-memory impl.
 */
export interface SeoCostLedger {
  /**
   * Record a completed stage's MEASURED cost (Gateway-reported actual_usd +
   * latency_ms + model) onto its ledger row. Returns the persisted record.
   * EVERY write is scoped by the bound (workspaceId, clientId) on `scope`.
   */
  recordStage(payload: RecordStagePayload): Promise<SeoCostLedgerRecord>;
  /** All ledger records for a run (scoped by workspace_id + client_id + run_id). */
  recordsForRun(scope: ReservationScope): Promise<SeoCostLedgerRecord[]>;
}

/** Reconciliation tolerance: $0.0001 (the ledger's numeric(10,4) precision). */
export const RECONCILE_TOLERANCE_USD = 1e-4;

/** The outcome of reconciling a run's ledger against Gateway-reported usage. */
export interface ReconcileResult {
  ok: boolean;
  /** SUM(actual_usd) over the run's reconciled ledger rows (measured spend). */
  ledgerActualUsd: number;
  /** SUM of the Gateway-reported usage for the same run. */
  gatewayReportedUsd: number;
  /** |ledger - gateway|; must be <= RECONCILE_TOLERANCE_USD to pass. */
  gapUsd: number;
  /** Whether the measured per-piece spend is within the >=$2 editorial target. */
  withinCostTarget: boolean;
  /** The per-piece cost target this run was measured against (RUN_COST_CAP_USD). */
  costTargetUsd: number;
}

/**
 * Reconcile a run's ledger records against the Gateway-reported usage for that
 * run (acceptance: per-run-reconciliation). The ledger's per-stage actual_usd
 * must sum to the Gateway-reported total within tolerance; an unreconciled gap
 * FAILS (`ok:false`). Also reports the measured per-piece cost vs the ≤$2 target
 * (RFC §1) — measured from the ledger, never estimated.
 *
 * `gatewayReported` is the source-of-truth usage the Gateway returned for the
 * run (keyed by stage); a ledger row with a null actual_usd (never reconciled)
 * is itself a gap and fails the check.
 */
export function reconcileRun(
  records: SeoCostLedgerRecord[],
  gatewayReported: GatewayUsage[],
  costTargetUsd: number = RUN_COST_CAP_USD,
): ReconcileResult {
  // A null actual on any row is an unreconciled gap → fail (treat as +Infinity
  // so the gap can never spuriously pass).
  const anyUnreconciled = records.some((r) => r.actualUsd == null);
  const ledgerActualUsd = records.reduce(
    (sum, r) => sum + (r.actualUsd ?? 0),
    0,
  );
  const gatewayReportedUsd = gatewayReported.reduce(
    (sum, u) => sum + u.actualUsd,
    0,
  );
  const gapUsd = anyUnreconciled
    ? Number.POSITIVE_INFINITY
    : Math.abs(ledgerActualUsd - gatewayReportedUsd);
  const ok = !anyUnreconciled && gapUsd <= RECONCILE_TOLERANCE_USD;
  return {
    ok,
    ledgerActualUsd,
    gatewayReportedUsd,
    gapUsd,
    // Measured per-piece spend vs the editorial target (RFC §1, ≤$2).
    withinCostTarget: ledgerActualUsd <= costTargetUsd + RECONCILE_TOLERANCE_USD,
    costTargetUsd,
  };
}

/**
 * In-memory `SeoCostLedger` backing the Tier-1 reconciliation test (no live
 * Supabase). Keyed by (workspaceId|clientId|runId) so cross-tenant rows never
 * mix — the same isolation the live service-role workspace_id + client_id filter
 * gives. Records the Gateway-reported usage verbatim (the measured actual).
 */
export class InMemoryCostLedger implements SeoCostLedger {
  private readonly rows: SeoCostLedgerRecord[] = [];

  private static key(scope: ReservationScope): string {
    return `${scope.workspaceId}|${scope.clientId}|${scope.runId}`;
  }

  recordStage(payload: RecordStagePayload): Promise<SeoCostLedgerRecord> {
    const record: SeoCostLedgerRecord = {
      scope: payload.scope,
      pieceId: payload.pieceId,
      stage: payload.stage,
      reservedUsd: payload.reservedUsd,
      // Reconciled from Gateway usage — MEASURED, not estimated.
      actualUsd: payload.usage.actualUsd,
      model: payload.usage.model,
      latencyMs: payload.usage.latencyMs,
    };
    this.rows.push(record);
    return Promise.resolve(record);
  }

  recordsForRun(scope: ReservationScope): Promise<SeoCostLedgerRecord[]> {
    const k = InMemoryCostLedger.key(scope);
    // Tenancy isolation: only rows whose (workspace, client, run) match.
    return Promise.resolve(
      this.rows.filter((r) => InMemoryCostLedger.key(r.scope) === k),
    );
  }
}

/**
 * Fail-closed live writer (DR-026): not wired in this build. Throws loudly
 * rather than silently succeeding. Swapped for the C.021.2 service-role impl
 * (`server-only`, service-role client, every query scoped by workspace_id +
 * client_id) when the live ledger writer lands; injected with InMemoryCostLedger
 * in tests.
 */
export const NOT_WIRED_COST_LEDGER: SeoCostLedger = {
  recordStage: () => {
    throw new CostLedgerNotWiredError("recordStage");
  },
  recordsForRun: () => {
    throw new CostLedgerNotWiredError("recordsForRun");
  },
};

class CostLedgerNotWiredError extends Error {
  readonly code = "COST_LEDGER_NOT_WIRED" as const;
  constructor(op: string) {
    super(
      `SEO cost ledger is not wired: '${op}' has no live service-role backend ` +
        `in this build (DR-026/DR-006). Inject a SeoCostLedger (the live impl ` +
        `or InMemoryCostLedger in tests).`,
    );
    this.name = "CostLedgerNotWiredError";
  }
}

export { CostLedgerNotWiredError };
