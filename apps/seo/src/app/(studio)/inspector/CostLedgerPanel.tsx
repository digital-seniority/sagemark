"use client";

/**
 * CostLedgerPanel — the Inspector zone's SEO AI-Gateway cost ledger + KPI panel
 * (PR 020 / P1.C.3).
 *
 * Renders the read-only operator view of:
 *   1. the per-stage `seo_cost_ledger` rows for a run (reserved vs measured
 *      actual_usd + latency_ms + model),
 *   2. the MEASURED per-piece cost vs the >=$2 editorial target (RFC §1),
 *   3. the per-run RECONCILIATION status (ledger vs Gateway-reported usage; an
 *      unreconciled gap is surfaced as a FAIL, never hidden),
 *   4. the gate-block-by-sourcing rate (the D3 reversal trigger),
 *   5. the share-of-model citation rate (the north star), per engine.
 *
 * Pure presentation — the parent feeds already-computed projections (the
 * reconcile/rollup live in `lib/ledger` + `lib/metrics`). Colour from
 * `currentColor` + opacity (no hardcoded palette — brand tokens). Clean ASCII /
 * UTF-8. No `console.*`.
 */

import type {
  ReconcileResult,
  SeoCostLedgerRecord,
} from "@/lib/ledger/seo-cost-ledger";
import type {
  CitationRollup,
  SourcingBlockRate,
} from "@/lib/metrics/share-of-model";

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 12 };
const HEADING: React.CSSProperties = {
  ...SUBTLE,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: "0 0 6px",
};

function usd(n: number | null): string {
  return n == null ? "--" : `$${n.toFixed(4)}`;
}
function pct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

export interface CostLedgerPanelProps {
  /** Per-stage ledger rows for the run (reserved + measured actual). */
  records: SeoCostLedgerRecord[];
  /** The per-run reconciliation (ledger vs Gateway usage), or null if not run. */
  reconcile: ReconcileResult | null;
  /** The gate-block-by-sourcing rate (D3 reversal trigger), or null. */
  sourcingBlock: SourcingBlockRate | null;
  /** The per-hub share-of-model citation rollup (north star), or null. */
  citation: CitationRollup | null;
}

export function CostLedgerPanel({
  records,
  reconcile,
  sourcingBlock,
  citation,
}: CostLedgerPanelProps) {
  const measuredUsd = records.reduce((s, r) => s + (r.actualUsd ?? 0), 0);

  return (
    <div
      data-testid="cost-ledger-panel"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      {/* ── Per-stage cost ledger ─────────────────────────────────────────── */}
      <section data-testid="cost-ledger-stages" aria-label="Per-stage cost ledger">
        <p style={HEADING}>Cost ledger · per stage</p>
        {records.length === 0 ? (
          <p data-testid="cost-ledger-empty" style={{ ...SUBTLE, margin: 0 }}>
            No model calls recorded yet.
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {records.map((r, i) => (
              <li
                key={`${r.stage}-${i}`}
                data-testid="cost-ledger-row"
                data-stage={r.stage}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  border: "1px solid currentColor",
                  borderRadius: 8,
                  padding: "0.5rem 0.625rem",
                  background: "color-mix(in srgb, currentColor 8%, transparent)",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700 }}>{r.stage}</span>
                <span style={SUBTLE}>
                  reserved {usd(r.reservedUsd)} · actual{" "}
                  <span data-testid="cost-actual">{usd(r.actualUsd)}</span>
                  {r.latencyMs != null ? ` · ${r.latencyMs}ms` : ""}
                  {r.model ? ` · ${r.model}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Measured per-piece cost vs the editorial target ───────────────── */}
      <section data-testid="cost-target" aria-label="Per-piece cost vs target">
        <p style={HEADING}>Per-piece cost</p>
        <p style={{ margin: 0, fontSize: 13 }}>
          <span data-testid="cost-measured" style={{ fontWeight: 700 }}>
            {usd(measuredUsd)}
          </span>{" "}
          <span style={SUBTLE}>
            measured ·{" "}
            {reconcile ? (
              <span
                data-testid="cost-target-state"
                data-within={reconcile.withinCostTarget ? "true" : "false"}
              >
                {reconcile.withinCostTarget ? "within" : "OVER"} the{" "}
                {usd(reconcile.costTargetUsd)} target
              </span>
            ) : (
              "target not yet measured"
            )}
          </span>
        </p>
      </section>

      {/* ── Per-run reconciliation (ledger vs Gateway usage) ──────────────── */}
      <section data-testid="cost-reconcile" aria-label="Per-run reconciliation">
        <p style={HEADING}>Reconciliation</p>
        {reconcile == null ? (
          <p style={{ ...SUBTLE, margin: 0 }}>Not run yet.</p>
        ) : (
          <p
            data-testid="reconcile-state"
            data-ok={reconcile.ok ? "true" : "false"}
            style={{ margin: 0, fontSize: 13 }}
          >
            <span style={{ fontWeight: 700 }}>
              {reconcile.ok ? "RECONCILED" : "GAP"}
            </span>{" "}
            <span style={SUBTLE}>
              ledger {usd(reconcile.ledgerActualUsd)} vs Gateway{" "}
              {usd(reconcile.gatewayReportedUsd)}
              {Number.isFinite(reconcile.gapUsd)
                ? ` · gap ${usd(reconcile.gapUsd)}`
                : " · unreconciled rows"}
            </span>
          </p>
        )}
      </section>

      {/* ── Gate-block-by-sourcing rate (D3 reversal trigger) ─────────────── */}
      <section data-testid="sourcing-block" aria-label="Gate-block-by-sourcing rate">
        <p style={HEADING}>Sourcing-block rate · D3</p>
        {sourcingBlock == null || sourcingBlock.totalGated === 0 ? (
          <p style={{ ...SUBTLE, margin: 0 }}>No gated results yet.</p>
        ) : (
          <p
            data-testid="sourcing-block-rate"
            data-rate={sourcingBlock.rate.toFixed(4)}
            style={{ margin: 0, fontSize: 13 }}
          >
            <span style={{ fontWeight: 700 }}>{pct(sourcingBlock.rate)}</span>{" "}
            <span style={SUBTLE}>
              blocked by sourcing ({sourcingBlock.blockedBySourcing}/
              {sourcingBlock.totalGated}) · {sourcingBlock.unsourcedStatVetoes}{" "}
              unsourced-stat · {sourcingBlock.thinSourceFaithfulnessBlocks}{" "}
              thin-source
            </span>
          </p>
        )}
      </section>

      {/* ── Share-of-model citation rate (north star) ─────────────────────── */}
      <section data-testid="share-of-model" aria-label="Share-of-model citation rate">
        <p style={HEADING}>Share of model · citations</p>
        {citation == null || citation.total === 0 ? (
          <p style={{ ...SUBTLE, margin: 0 }}>No citation checks yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p
              data-testid="citation-rate"
              data-rate={citation.citationRate.toFixed(4)}
              style={{ margin: 0, fontSize: 13 }}
            >
              <span style={{ fontWeight: 700 }}>{pct(citation.citationRate)}</span>{" "}
              <span style={SUBTLE}>
                cited ({citation.cited}/{citation.total})
              </span>
            </p>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {Object.entries(citation.byEngine).map(([engine, e]) => (
                <li
                  key={engine}
                  data-testid="citation-engine"
                  data-engine={engine}
                  style={SUBTLE}
                >
                  {engine}: {pct(e.rate)} ({e.cited}/{e.total})
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

export default CostLedgerPanel;
